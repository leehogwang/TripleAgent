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
  timedOut: boolean;
};

const GEMINI_NOISE_PATTERNS = [
  /^Keychain initialization encountered an error:/,
  /^Using FileKeychain fallback for secure storage\./,
  /^Loaded cached credentials\./,
  /^\[ERROR\] \[IDEClient\] Directory mismatch\./,
  /^\[ERROR\] \[IDEClient\] Failed to connect to IDE companion extension\./,
];

const GEMINI_MODEL = "gemini-2.5-flash";
const CODEX_MODEL = "gpt-5.4";

const AUTH_FAILURE_PATTERNS = [
  /not logged in/i,
  /login required/i,
  /authentication (failed|required|expired|error)/i,
  /reauthenticate/i,
  /sign in (again|to continue|required)/i,
  /session expired/i,
  /invalid credentials/i,
  /please (log in|sign in)/i,
  /oauth[^.\n]*(expired|failed|required|missing)/i,
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
  delete env.GEMINI_CLI_IDE_SERVER_PORT;
  delete env.GEMINI_CLI_IDE_WORKSPACE_PATH;
  delete env.GEMINI_CLI_IDE_AUTH_TOKEN;
  return env;
}

function resolveClaudeCliPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../Leonxlnx-claude-code/package/cli.js");
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function formatRecentHistory(args: ProviderRunArgs, maxEntries: number, maxCharsPerEntry: number): string {
  return args.history
    .filter((entry) => entry.role !== "system")
    .slice(-maxEntries)
    .map((entry) => `${entry.role.toUpperCase()}: ${clipText(entry.text, maxCharsPerEntry)}`)
    .join("\n");
}

function buildProviderPrompt(args: ProviderRunArgs): string {
  const accessHint = args.accessDirs.length
    ? `Accessible absolute paths: ${args.accessDirs.join(", ")}`
    : "Accessible absolute paths: current working directory only";

  if (args.provider === "claude") {
    const recent = formatRecentHistory(args, 6, 1400);
    const header = [
      "You are the Claude panel inside TripleAgent.",
      "Answer directly and do not mention TripleAgent internals unless the user asks.",
      args.planMode
        ? "PLAN MODE is active. Analyze, plan, and explain. Do not claim to have edited files unless you actually changed them."
        : "IMPLEMENTATION MODE is active. You may inspect and modify files in the assigned worktree when appropriate.",
      accessHint,
    ].join("\n");

    return [
      header,
      recent ? `Recent panel history:\n${recent}` : "Recent panel history: none",
      `Latest user request:\n${args.prompt}`,
    ].join("\n\n");
  }

  if (args.provider === "codex") {
    const recent = formatRecentHistory(args, 3, 800);
    return [
      "You are the Codex panel inside TripleAgent.",
      "Use Codex-native behavior and respond concisely.",
      args.planMode
        ? "PLAN MODE is active. Analyze first, propose concrete fixes, and avoid claiming file edits unless you actually changed files."
        : "IMPLEMENTATION MODE is active. You may inspect and modify files in the working tree when needed.",
      accessHint,
      recent ? `Recent conversation summary:\n${recent}` : undefined,
      `Current request:\n${clipText(args.prompt, 12000)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const recent = formatRecentHistory(args, 2, 700);
  return [
    "You are the Gemini panel inside TripleAgent.",
    "Respond directly, stay concise, and focus on the latest request.",
    args.planMode
      ? "PLAN MODE is active. Analyze and explain before proposing execution."
      : "IMPLEMENTATION MODE is active. You may inspect files in the working tree when needed.",
    accessHint,
    recent ? `Recent conversation summary:\n${recent}` : undefined,
    `Current request:\n${clipText(args.prompt, 10000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function sanitizeClaudeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.CLAUDE_CODE_ENTRYPOINT_CWD;
  delete env.CLAUDE_CODE_CWD;
  delete env.NODE_OPTIONS;
  delete env.PWD;
  for (const key of Object.keys(env)) {
    if (key.startsWith("TSX_") || key.startsWith("ESBK_")) {
      delete env[key];
    }
  }
  return env;
}

function buildAdditionalAccessDirs(args: ProviderRunArgs): string[] {
  const current = path.resolve(args.cwd);
  return [...new Set(args.accessDirs.map((value) => path.resolve(value)).filter((value) => value !== current))];
}

function spawnCollectedProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  timeoutMs?: number,
  stdinText?: string,
): ProviderTurnHandle {
  let child: ChildProcess | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let processTimer: NodeJS.Timeout | undefined;
  let interrupted = signal?.aborted ?? false;
  let timedOut = false;

  const terminate = (mode: "interrupt" | "timeout") => {
    if (mode === "interrupt") {
      interrupted = true;
    } else {
      timedOut = true;
    }
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

  const cancel = () => {
    terminate("interrupt");
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
      if (processTimer) {
        clearTimeout(processTimer);
      }
      resolve({
        code,
        stdout,
        stderr,
        interrupted,
        timedOut,
      });
    };

    const spawned = spawn(command, args, {
      cwd,
      env,
      stdio: [stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    child = spawned;
    spawned.stdin?.on("error", () => {
      // A fast exit can close stdin before the prompt is fully written.
      // The caller only cares about process completion, not write acknowledgements.
    });

    const handleAbort = () => cancel();
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (timeoutMs && timeoutMs > 0) {
      processTimer = setTimeout(() => {
        terminate("timeout");
      }, timeoutMs);
    }

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

    if (stdinText !== undefined) {
      spawned.stdin?.end(stdinText);
    }

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
  exitCode: number,
): { lockReason?: PanelLockReason; lockMessage?: string } {
  if (exitCode !== 0 && detectAuthFailure(output)) {
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

function parseGeminiJson(output: string): string {
  const trimmed = sanitizeGeminiText(output);
  if (!trimmed) {
    return "";
  }

  for (const line of trimmed.split("\n").reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      const payload = JSON.parse(candidate) as { response?: string };
      if (payload.response) {
        return payload.response.trim();
      }
    } catch {
      continue;
    }
  }

  try {
    const payload = JSON.parse(trimmed) as { response?: string };
    return payload.response?.trim() ?? trimmed;
  } catch {
    return trimmed;
  }
}

function normalizeProviderResult(command: string, args: string[], result: ProcessResult): ProviderRunResult {
  const provider = inferProvider(command, args);

  if (result.timedOut) {
    return {
      ok: false,
      text: `${panelName(provider)} timed out while waiting for a response.`,
      rawOutput: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
      interrupted: false,
      lockReason: undefined,
      lockMessage: undefined,
    };
  }

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
    const lockout = detectLockout(provider, output || text, result.code);
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
    const lockout = detectLockout(provider, output, result.code);
    return {
      ok: result.code === 0 && !lockout.lockReason,
      text: parseGeminiJson(result.stdout) || output || "(empty response)",
      rawOutput: output,
      interrupted: false,
      lockReason: lockout.lockReason,
      lockMessage: lockout.lockMessage,
    };
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const parsed = parseCodexJson(result.stdout);
  const lockout = detectLockout(provider, output, result.code);
  return {
    ok: result.code === 0 && !lockout.lockReason,
    text: parsed || output || "(empty response)",
    rawOutput: output,
    interrupted: false,
    lockReason: lockout.lockReason,
    lockMessage: lockout.lockMessage,
  };
}

function panelName(provider: ProviderRunArgs["provider"]): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
  }
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
  const bridgedPrompt = buildProviderPrompt(args);
  const additionalAccessDirs = buildAdditionalAccessDirs(args);

  if (args.provider === "claude") {
    const cliArgs = [
      resolveClaudeCliPath(),
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      args.planMode ? "plan" : "acceptEdits",
    ];
    if (additionalAccessDirs.length > 0) {
      for (const directory of additionalAccessDirs) {
        cliArgs.push("--add-dir", directory);
      }
    }
    return spawnCollectedProcess(
      process.execPath,
      cliArgs,
      args.cwd,
      sanitizeClaudeEnv(process.env),
      args.signal,
      undefined,
      bridgedPrompt,
    );
  }

  if (args.provider === "gemini") {
    const cliArgs = ["-p", bridgedPrompt, "--model", GEMINI_MODEL, "--output-format", "json"];
    if (args.planMode) {
      cliArgs.push("--approval-mode", "plan");
    }
    return spawnCollectedProcess("gemini", cliArgs, args.cwd, sanitizeGeminiEnv(process.env), args.signal, 180000);
  }

  const codexArgs = [
    "exec",
    "--enable",
    "multi_agent",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-m",
    CODEX_MODEL,
    "-c",
    "model_reasoning_effort=xhigh",
    "-c",
    "plan_mode_reasoning_effort=xhigh",
    "-c",
    "service_tier=fast",
    "--cd",
    args.cwd,
  ];
  for (const directory of additionalAccessDirs) {
    codexArgs.push("--add-dir", directory);
  }
  codexArgs.push("-");
  return spawnCollectedProcess("codex", codexArgs, args.cwd, process.env, args.signal, undefined, bridgedPrompt);
}

export async function runProviderTurn(args: ProviderRunArgs): Promise<ProviderRunResult> {
  return startProviderTurn(args).promise;
}
