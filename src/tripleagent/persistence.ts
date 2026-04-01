import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PersistedSession } from "./types.js";

const SESSION_DIR = path.join(os.homedir(), ".tripleagent");
const SESSION_FILE = path.join(SESSION_DIR, "latest-session.json");

export function loadPersistedSession(): PersistedSession | null {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf8")) as PersistedSession;
  } catch {
    return null;
  }
}

export function savePersistedSession(session: PersistedSession): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}
