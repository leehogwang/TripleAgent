import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { ProviderAuth, ProviderId } from "./types.js";

const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const GEMINI_SETTINGS_PATH = path.join(os.homedir(), ".gemini", "settings.json");
const GEMINI_OAUTH_PATH = path.join(os.homedir(), ".gemini", "oauth_creds.json");

type ClaudeAuthJson = {
  loggedIn?: boolean;
  authMethod?: string;
  subscriptionType?: string;
  email?: string;
};

type CodexAuthJson = {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
};

type GeminiSettingsJson = {
  security?: {
    auth?: {
      selectedType?: string;
    };
  };
};

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function resolveClaudeCliPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../Leonxlnx-claude-code/package/cli.js");
}

export function getCodexAuth(): ProviderAuth {
  const payload = readJsonFile<CodexAuthJson>(CODEX_AUTH_PATH);
  const hasToken = Boolean(payload?.tokens?.access_token);
  return {
    provider: "codex",
    state: hasToken ? "ready" : "auth_required",
    summary: hasToken ? "ChatGPT auth ready" : "Codex login required",
    detail: hasToken
      ? `${payload?.auth_mode ?? "unknown"} · ${payload?.tokens?.account_id ?? "unknown account"}`
      : `Run: npm run triple-agent -- auth login codex`,
  };
}

export function getClaudeAuth(): ProviderAuth {
  const result = spawnSync(process.execPath, [resolveClaudeCliPath(), "auth", "status", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return {
      provider: "claude",
      state: "auth_required",
      summary: "Claude login required",
      detail: `Run: npm run triple-agent -- auth login claude`,
    };
  }

  const payload = JSON.parse(result.stdout) as ClaudeAuthJson;
  const loggedIn = Boolean(payload.loggedIn);
  return {
    provider: "claude",
    state: loggedIn ? "ready" : "auth_required",
    summary: loggedIn ? "Claude auth ready" : "Claude login required",
    detail: loggedIn
      ? `${payload.authMethod ?? "unknown"} · ${payload.subscriptionType ?? "unknown plan"} · ${payload.email ?? "unknown user"}`
      : `Run: npm run triple-agent -- auth login claude`,
  };
}

export function getGeminiAuth(): ProviderAuth {
  const settings = readJsonFile<GeminiSettingsJson>(GEMINI_SETTINGS_PATH);
  const selectedType = settings?.security?.auth?.selectedType;
  const hasOauth = existsSync(GEMINI_OAUTH_PATH);
  const ok = selectedType === "oauth-personal" && hasOauth;
  return {
    provider: "gemini",
    state: ok ? "ready" : "auth_required",
    summary: ok ? "Gemini auth ready" : "Gemini login required",
    detail: ok
      ? `${selectedType} · oauth session detected`
      : `Run: npm run triple-agent -- auth login gemini`,
  };
}

export function getAuthStatuses(): Record<ProviderId, ProviderAuth> {
  return {
    codex: getCodexAuth(),
    claude: getClaudeAuth(),
    gemini: getGeminiAuth(),
  };
}

export function printAuthStatus(): number {
  const statuses = getAuthStatuses();
  for (const provider of ["codex", "claude", "gemini"] as const) {
    const status = statuses[provider];
    process.stdout.write(`${provider}: ${status.summary}\n`);
    process.stdout.write(`  ${status.detail}\n`);
  }
  return 0;
}

function runInteractive(command: string, args: string[], env?: NodeJS.ProcessEnv): number {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });
  return result.status ?? 1;
}

function sanitizeGeminiEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GEMINI_CLI_IDE_SERVER_PORT;
  delete env.GEMINI_CLI_IDE_WORKSPACE_PATH;
  delete env.GEMINI_CLI_IDE_AUTH_TOKEN;
  return env;
}

function loginGemini(): number {
  process.stdout.write(
    "Gemini interactive login will open now. Complete Google sign-in, then exit Gemini when it reaches the main prompt.\n",
  );
  return runInteractive("gemini", [], sanitizeGeminiEnv(process.env));
}

function logoutGemini(): number {
  rmSync(GEMINI_OAUTH_PATH, { force: true });
  const settings = readJsonFile<GeminiSettingsJson>(GEMINI_SETTINGS_PATH);
  if (settings?.security?.auth?.selectedType) {
    delete settings.security.auth.selectedType;
    writeFileSync(GEMINI_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
  process.stdout.write("Gemini OAuth session cleared.\n");
  return 0;
}

function loginProvider(provider: ProviderId): number {
  switch (provider) {
    case "codex":
      return runInteractive("codex", ["login"]);
    case "claude":
      return runInteractive(process.execPath, [resolveClaudeCliPath(), "auth", "login"]);
    case "gemini":
      return loginGemini();
  }
}

function logoutProvider(provider: ProviderId): number {
  switch (provider) {
    case "codex":
      return runInteractive("codex", ["logout"]);
    case "claude":
      return runInteractive(process.execPath, [resolveClaudeCliPath(), "auth", "logout"]);
    case "gemini":
      return logoutGemini();
  }
}

export function runAuthCommand(args: string[]): number {
  const action = args[0] ?? "status";
  const target = (args[1] ?? "all") as ProviderId | "all";
  if (action === "status") {
    return printAuthStatus();
  }

  const providers = target === "all" ? (["codex", "claude", "gemini"] as ProviderId[]) : [target];
  for (const provider of providers) {
    if (!["codex", "claude", "gemini"].includes(provider)) {
      process.stderr.write(`Unknown provider: ${provider}\n`);
      return 1;
    }
    const exitCode = action === "login" ? loginProvider(provider) : logoutProvider(provider);
    if (exitCode !== 0) {
      return exitCode;
    }
  }
  return 0;
}
