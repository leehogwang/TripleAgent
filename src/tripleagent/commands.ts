import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_SUPPORTED = new Set([
  "clear",
  "exit",
  "fuse",
  "help",
  "init",
  "lock",
  "login",
  "logout",
  "pick",
  "plan",
  "resume",
  "status",
  "unlock",
]);

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

export function getSlashCommandSuggestions(input: string, limit = 6): string[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }

  const token = trimmed.slice(1);
  if (!token || /\s/.test(token)) {
    return [];
  }

  const query = token.toLowerCase();
  const known = getKnownCommands();
  const ranked = known
    .map((name) => {
      const lower = name.toLowerCase();
      if (lower === query) {
        return { name, score: 0 };
      }
      if (lower.startsWith(query)) {
        return { name, score: 1 };
      }
      if (lower.includes(query)) {
        return { name, score: 2 };
      }
      return null;
    })
    .filter((item): item is { name: string; score: number } => item !== null)
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name));

  return ranked.slice(0, limit).map((item) => item.name);
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
    "Shared composer: /help /status /plan /init /lock /unlock /clear /resume /pick /fuse /login /logout /exit",
    "Panel composers: provider-local prompts plus the Claude registry on the Claude panel.",
    "Use Tab to accept slash autocomplete when visible, otherwise move focus. Shift+Tab moves focus backward.",
    "Press Esc twice quickly to stop all running agents.",
  ].join("\n");
}
