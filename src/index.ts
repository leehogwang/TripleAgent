import path from "node:path";
import { randomUUID } from "node:crypto";

import { getAuthStatuses, printAuthStatus, runAuthCommand } from "./tripleagent/auth.js";
import { startTripleAgentApp } from "./tripleagent/app.js";
import { runProviderTurn } from "./tripleagent/providers.js";
import { ensurePanelWorktrees } from "./tripleagent/worktree.js";

type ParsedArgs = {
  cwd: string;
  subcommand?: "auth" | "dry-run";
  rest: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  let cwd = process.cwd();
  const rest: string[] = [];
  let subcommand: ParsedArgs["subcommand"];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--cwd") {
      cwd = path.resolve(argv[i + 1] ?? cwd);
      i += 1;
      continue;
    }
    if (!subcommand && (arg === "auth" || arg === "dry-run")) {
      subcommand = arg;
      continue;
    }
    rest.push(arg);
  }

  return {
    cwd,
    ...(subcommand ? { subcommand } : {}),
    rest,
  };
}

async function runDryRun(cwd: string): Promise<number> {
  const statuses = getAuthStatuses();
  printAuthStatus();
  for (const provider of ["codex", "claude", "gemini"] as const) {
    if (statuses[provider].state !== "ready") {
      process.stderr.write(`Dry run blocked: ${provider} is not authenticated.\n`);
      return 1;
    }
  }

  const prompt = "Reply with exactly one line that starts with READY:";
  const worktreeSetup = ensurePanelWorktrees(cwd);
  if (!worktreeSetup.enabled) {
    process.stderr.write(`${worktreeSetup.error ?? "Worktree setup failed."}\n`);
    return 1;
  }

  const accessDirs = [...new Set([cwd, path.dirname(cwd)].map((value) => path.resolve(value)))];

  for (const provider of ["codex", "claude", "gemini"] as const) {
    const result = await runProviderTurn({
      provider,
      prompt,
      cwd: worktreeSetup.panelWorktrees[provider] ?? cwd,
      accessDirs,
      planMode: true,
      history: [],
      sessionId: randomUUID(),
    });
    process.stdout.write(`\n[${provider}] ${result.ok ? "ok" : "error"}\n`);
    process.stdout.write(`${result.text}\n`);
    if (result.lockReason) {
      process.stderr.write(`${result.lockMessage ?? `${provider} locked.`}\n`);
      return 1;
    }
    if (!result.ok) {
      return 1;
    }
  }

  process.stdout.write("\nDry run succeeded.\n");
  return 0;
}

async function main(): Promise<void> {
  const { cwd, subcommand, rest } = parseArgs(process.argv.slice(2));
  if (subcommand === "auth") {
    process.exitCode = runAuthCommand(rest);
    return;
  }

  if (subcommand === "dry-run") {
    process.exitCode = await runDryRun(cwd);
    return;
  }

  await startTripleAgentApp(cwd);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
