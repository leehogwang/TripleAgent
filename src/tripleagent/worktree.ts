import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { ProviderId, ResultBundle, WorktreeSetup } from "./types.js";

const PANEL_WORKTREE_NAMES: Record<ProviderId, string> = {
  codex: "codex1",
  claude: "claude1",
  gemini: "gemini1",
};

const PANEL_BRANCH_NAMES: Record<ProviderId, string> = {
  codex: "tripleagent/codex1",
  claude: "tripleagent/claude1",
  gemini: "tripleagent/gemini1",
};

const FUSION_WORKTREE_NAME = "fusion1";
const FUSION_BRANCH_NAME = "tripleagent/fusion1";

type GitResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type ApplyResult = {
  ok: boolean;
  message: string;
};

function runGit(args: string[], cwd: string, input?: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
  });
  return {
    ok: (result.status ?? 1) === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function ensureWorktree(gitRoot: string, worktreePath: string, branchName: string, baseSha: string): string | undefined {
  if (existsSync(worktreePath)) {
    const existing = runGit(["rev-parse", "--show-toplevel"], worktreePath);
    if (!existing.ok) {
      return `${worktreePath} already exists and is not a git worktree.`;
    }
    return undefined;
  }

  const branchExists = runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], gitRoot).ok;
  const args = branchExists
    ? ["worktree", "add", worktreePath, branchName]
    : ["worktree", "add", "-b", branchName, worktreePath, baseSha];
  const added = runGit(args, gitRoot);
  return added.ok ? undefined : added.stderr || `Failed to create worktree ${worktreePath}.`;
}

export function ensurePanelWorktrees(startCwd: string): WorktreeSetup {
  const gitRootResult = runGit(["rev-parse", "--show-toplevel"], startCwd);
  if (!gitRootResult.ok) {
    return {
      enabled: false,
      gitRoot: undefined,
      targetRoot: undefined,
      baseSha: undefined,
      panelWorktrees: {},
      fusionWorktreePath: undefined,
      error: "TripleAgent worktree mode requires launching inside a git repository.",
    };
  }

  const gitRoot = gitRootResult.stdout;
  const baseShaResult = runGit(["rev-parse", "HEAD"], gitRoot);
  if (!baseShaResult.ok) {
    return {
      enabled: false,
      gitRoot,
      targetRoot: undefined,
      baseSha: undefined,
      panelWorktrees: {},
      fusionWorktreePath: undefined,
      error: baseShaResult.stderr || "Failed to resolve the current git base revision.",
    };
  }

  const targetRoot = path.dirname(gitRoot);
  const panelWorktrees: Partial<Record<ProviderId, string>> = {};
  for (const provider of ["codex", "claude", "gemini"] as const) {
    const worktreePath = path.join(targetRoot, PANEL_WORKTREE_NAMES[provider]);
    const error = ensureWorktree(gitRoot, worktreePath, PANEL_BRANCH_NAMES[provider], baseShaResult.stdout);
    if (error) {
      return {
        enabled: false,
        gitRoot,
        targetRoot,
        baseSha: baseShaResult.stdout,
        panelWorktrees,
        fusionWorktreePath: path.join(targetRoot, FUSION_WORKTREE_NAME),
        error,
      };
    }
    panelWorktrees[provider] = worktreePath;
  }

  return {
    enabled: true,
    gitRoot,
    targetRoot,
    baseSha: baseShaResult.stdout,
    panelWorktrees,
    fusionWorktreePath: path.join(targetRoot, FUSION_WORKTREE_NAME),
    error: undefined,
  };
}

export function ensureFusionWorktree(setup: WorktreeSetup): { ok: boolean; path: string | undefined; message: string | undefined } {
  if (!setup.enabled || !setup.gitRoot || !setup.targetRoot || !setup.baseSha || !setup.fusionWorktreePath) {
    return {
      ok: false,
      path: undefined,
      message: setup.error ?? "Fusion worktree is unavailable outside a git repository.",
    };
  }

  const error = ensureWorktree(setup.gitRoot, setup.fusionWorktreePath, FUSION_BRANCH_NAME, setup.baseSha);
  if (error) {
    return {
      ok: false,
      path: undefined,
      message: error,
    };
  }

  return {
    ok: true,
    path: setup.fusionWorktreePath,
    message: undefined,
  };
}

export function captureResultBundle(setup: WorktreeSetup, provider: ProviderId, summary: string): ResultBundle | undefined {
  const worktreePath = setup.panelWorktrees[provider];
  if (!setup.enabled || !setup.baseSha || !worktreePath) {
    return undefined;
  }

  runGit(["add", "-N", "."], worktreePath);
  const patchResult = runGit(["diff", "--binary", setup.baseSha, "--", "."], worktreePath);
  const statResult = runGit(["diff", "--stat", setup.baseSha, "--", "."], worktreePath);
  if (!patchResult.ok) {
    return undefined;
  }

  return {
    provider,
    baseSha: setup.baseSha,
    patch: patchResult.stdout,
    summary: statResult.stdout || summary,
    worktreePath,
    capturedAt: new Date().toISOString(),
  };
}

export function captureFusionBundle(fusionPath: string, baseSha: string, summary: string): ResultBundle {
  runGit(["add", "-N", "."], fusionPath);
  const patchResult = runGit(["diff", "--binary", baseSha, "--", "."], fusionPath);
  const statResult = runGit(["diff", "--stat", baseSha, "--", "."], fusionPath);
  return {
    provider: "codex",
    baseSha,
    patch: patchResult.stdout,
    summary: statResult.stdout || summary,
    worktreePath: fusionPath,
    capturedAt: new Date().toISOString(),
  };
}

export function applyResultBundle(targetRoot: string, bundle: ResultBundle): ApplyResult {
  if (!bundle.patch.trim()) {
    return {
      ok: true,
      message: `${bundle.provider} has no file diff to apply.`,
    };
  }

  const applied = runGit(["apply", "--3way", "--binary"], targetRoot, bundle.patch);
  return {
    ok: applied.ok,
    message: applied.ok
      ? `${bundle.provider} bundle applied to ${targetRoot}.`
      : applied.stderr || `Failed to apply ${bundle.provider} bundle.`,
  };
}
