import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PanelLockReason, ProviderRunArgs, ProviderRunResult } from "./types.js";

export type ProviderTurnHandle = {
  cancel: () => void;
  promise: Promise<ProviderRunResult>;
};

type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
  interrupted: boolean;
};

const GEMINI_NOISE_PATTERNS = [
  /^Keychain initialization encountered an error:/,
  /^Using FileKeychain fallback for secure storage\./,
  /^Loaded cached credentials\./,
  /^\[ERROR\] \[IDEClient\] Directory mismatch\./,
];

const AUTH_FAILURE_PATTERNS = [
  /not logged in/i,
  /login required/i,
  /authentication/i,
  /reauthenticate/i,
  /sign in/i,
  /oauth/i,
  /please run .*auth login/i,
];

const QUOTA_FAILURE_PATTERNS: Record<ProviderRunArgs["provider"], RegExp[]> = {
  codex: [
    /insufficient_quota/i,
    /quota exceeded/i,
    /usage limit/i,
    /rate limit exceeded/i,
    /billing/i,
    /hard limit/i,
    /credits/i,
  ],
  claude: [
    /usage limit/i,
    /included usage/i,
    /plan quota/i,
    /quota exceeded/i,
    /rate limit exceeded/i,
    /credit balance/i,
    /buy more/i,
    /billing/i,
    /subscription/i,
    /overage/i,
    /additional tokens/i,
  ],
  gemini: [
    /quota exceeded/i,
    /resource exhausted/i,
    /rate limit exceeded/i,
    /billing/i,
    /credits/i,
    /\b429\b/,
  ],
};

function sanitizeGeminiEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  return env;
}

function resolveClaudeCliPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../Leonxlnx-claude-code/package/cli.js");
}

function buildPrompt(args: ProviderRunArgs): string {
  const recent = args.history
    .filter((entry) => entry.role !== "system")
    .slice(-8)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
    .join("\n");

  const header = [
    `You are the ${args.provider} panel inside TripleAgent.`,
    "Work independently from the other panels.",
    args.planMode
      ? "PLAN MODE is active. Analyze, plan, and explain. Do not claim to have edited files unless you actually changed them."
      : "IMPLEMENTATION MODE is active. You may inspect and modify files in the assigned worktree when appropriate.",
  ].join("\n");

  return [
    header,
    recent ? `Recent panel history:\n${recent}` : "Recent panel history: none",
    `Latest user request:\n${args.prompt}`,
  ].join("\n\n");
}

function spawnCollectedProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): ProviderTurnHandle {
  let child: ChildProcess | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let interrupted = signal?.aborted ?? false;

  const cancel = () => {
    interrupted = true;
    if (!child || child.killed) {
      return;
    }
    try {
      child.kill("SIGINT");
    } catch {
      // Ignore kill failures and rely on process exit.
    }
    killTimer = setTimeout(() => {
      if (child && !child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore kill failures.
        }
      }
    }, 1000);
  };

  const promise = new Promise<ProcessResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (code: number) => {
      if (settled) {
        return;
      }
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve({
        code,
        stdout,
        stderr,
        interrupted,
      });
    };

    const spawned = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = spawned;

    const handleAbort = () => cancel();
    signal?.addEventListener("abort", handleAbort, { once: true });

    spawned.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    spawned.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    spawned.on("error", (error) => {
      stderr = `${stderr}\n${error.message}`.trim();
      finish(1);
    });
    spawned.on("close", (code) => {
      signal?.removeEventListener("abort", handleAbort);
      finish(code ?? 1);
    });

    if (signal?.aborted) {
      cancel();
    }
  });

  return {
    cancel,
    promise: promise.then((result) => normalizeProviderResult(command, args, result)),
  };
}

function sanitizeGeminiText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !GEMINI_NOISE_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .trim();
}

function detectAuthFailure(output: string): boolean {
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

function quotaLockMessage(provider: ProviderRunArgs["provider"]): string {
  switch (provider) {
    case "codex":
      return "Codex quota appears exhausted. This panel is disabled until the quota resets.";
    case "claude":
      return "Claude plan quota appears exhausted. This panel is locked to prevent paid overage token usage.";
    case "gemini":
      return "Gemini quota appears exhausted. This panel is disabled until the quota resets.";
  }
}

function detectLockout(
  provider: ProviderRunArgs["provider"],
  output: string,
): { lockReason?: PanelLockReason; lockMessage?: string } {
  if (detectAuthFailure(output)) {
    return {
      lockReason: "auth",
      lockMessage: "Authentication expired. This panel is now locked.",
    };
  }
  if (QUOTA_FAILURE_PATTERNS[provider].some((pattern) => pattern.test(output))) {
    return {
      lockReason: "quota",
      lockMessage: quotaLockMessage(provider),
    };
  }
  return {};
}

function parseCodexJson(output: string): string {
  let lastText = "";
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const payload = JSON.parse(trimmed) as {
        item?: { type?: string; text?: string; message?: string };
      };
      if (payload.item?.type === "agent_message" && payload.item.text) {
        lastText = payload.item.text;
      }
    } catch {
      continue;
    }
  }
  return lastText.trim();
}

function parseClaudeJson(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const payload = JSON.parse(trimmed) as { result?: string };
    return payload.result?.trim() ?? trimmed;
  } catch {
    for (const line of trimmed.split("\n").reverse()) {
      const candidate = line.trim();
      if (!candidate.startsWith("{")) {
        continue;
      }
      try {
        const payload = JSON.parse(candidate) as { result?: string };
        if (payload.result) {
          return payload.result.trim();
        }
      } catch {
        continue;
      }
    }
  }
  return trimmed;
}

function normalizeProviderResult(command: string, args: string[], result: ProcessResult): ProviderRunResult {
  const provider = inferProvider(command, args);

  if (result.interrupted) {
    return {
      ok: false,
      text: "Interrupted.",
      rawOutput: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
      interrupted: true,
      lockReason: undefined,
      lockMessage: undefined,
    };
  }

  if (provider === "claude") {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const text = parseClaudeJson(result.stdout) || output || "(empty response)";
    const lockout = detectLockout(provider, output || text);
    return {
      ok: result.code === 0 && !lockout.lockReason,
      text,
      rawOutput: output,
      interrupted: false,
      lockReason: lockout.lockReason,
      lockMessage: lockout.lockMessage,
    };
  }

  if (provider === "gemini") {
    const output = sanitizeGeminiText([result.stdout, result.stderr].filter(Boolean).join("\n"));
    const lockout = detectLockout(provider, output);
    return {
      ok: result.code === 0 && !lockout.lockReason,
      text: sanitizeGeminiText(result.stdout) || output || "(empty response)",
      rawOutput: output,
      interrupted: false,
      lockReason: lockout.lockReason,
      lockMessage: lockout.lockMessage,
    };
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const parsed = parseCodexJson(result.stdout);
  const lockout = detectLockout(provider, output);
  return {
    ok: result.code === 0 && !lockout.lockReason,
    text: parsed || output || "(empty response)",
    rawOutput: output,
    interrupted: false,
    lockReason: lockout.lockReason,
    lockMessage: lockout.lockMessage,
  };
}

function inferProvider(command: string, args: string[]): ProviderRunArgs["provider"] {
  if (command === "gemini") {
    return "gemini";
  }
  if (command === "codex") {
    return "codex";
  }
  if (args.some((value) => value.endsWith("package/cli.js"))) {
    return "claude";
  }
  return "claude";
}

export function startProviderTurn(args: ProviderRunArgs): ProviderTurnHandle {
  const bridgedPrompt = buildPrompt(args);

  if (args.provider === "claude") {
    const cliArgs = [
      resolveClaudeCliPath(),
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      args.planMode ? "plan" : "acceptEdits",
    ];
    if (args.sessionId) {
      cliArgs.push("--session-id", args.sessionId);
    }
    cliArgs.push(bridgedPrompt);
    return spawnCollectedProcess(process.execPath, cliArgs, args.cwd, process.env, args.signal);
  }

  if (args.provider === "gemini") {
    const cliArgs = ["-p", bridgedPrompt, "--output-format", "text"];
    if (args.planMode) {
      cliArgs.push("--approval-mode", "plan");
    }
    return spawnCollectedProcess("gemini", cliArgs, args.cwd, sanitizeGeminiEnv(process.env), args.signal);
  }

  const codexArgs = [
    "exec",
    "--enable",
    "multi_agent",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    args.cwd,
    bridgedPrompt,
  ];
  return spawnCollectedProcess("codex", codexArgs, args.cwd, process.env, args.signal);
}

export async function runProviderTurn(args: ProviderRunArgs): Promise<ProviderRunResult> {
  return startProviderTurn(args).promise;
}
