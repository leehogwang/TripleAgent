import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_SUPPORTED = new Set(["clear", "exit", "fuse", "help", "init", "login", "logout", "pick", "plan", "resume", "status"]);

export type CommandParse =
  | { kind: "app"; name: string; args: string[] }
  | { kind: "claude-only"; name: string; args: string[] }
  | { kind: "unknown"; name: string; args: string[] };

function commandsDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../Leonxlnx-claude-code/src/commands");
}

export function getKnownCommands(): string[] {
  const names = new Set<string>();
  for (const entry of readdirSync(commandsDir(), { withFileTypes: true })) {
    const raw = entry.name.replace(/\.(js|ts|tsx)$/, "");
    if (!raw || raw === "index") {
      continue;
    }
    names.add(raw);
  }
  for (const name of APP_SUPPORTED) {
    names.add(name);
  }
  return [...names].sort();
}

export function parseSlashCommand(input: string): CommandParse | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [nameToken, ...args] = trimmed.slice(1).split(/\s+/);
  const name = (nameToken ?? "").trim();
  if (!name) {
    return null;
  }

  if (APP_SUPPORTED.has(name)) {
    return { kind: "app", name, args };
  }

  if (getKnownCommands().includes(name)) {
    return { kind: "claude-only", name, args };
  }

  return { kind: "unknown", name, args };
}

export function buildHelpText(): string {
  const known = getKnownCommands();
  const supported = [...APP_SUPPORTED].sort();
  const claudeOnly = known.filter((name) => !APP_SUPPORTED.has(name));
  return [
    "TripleAgent commands",
    `Supported in-app: ${supported.map((name) => `/${name}`).join(", ")}`,
    `Claude command registry: ${claudeOnly.map((name) => `/${name}`).join(", ")}`,
    "Shared composer: /help /status /plan /init /clear /resume /pick /fuse /login /logout /exit",
    "Panel composers: provider-local prompts plus the Claude registry on the Claude panel.",
    "Use Tab or Shift+Tab to move focus, and press Esc twice quickly to stop all running agents.",
  ].join("\n");
}
