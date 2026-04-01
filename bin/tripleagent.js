#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ensureNode22 = path.join(ROOT, "scripts", "ensure-node22.sh");
const distEntry = path.join(ROOT, "dist", "index.js");
const srcEntry = path.join(ROOT, "src", "index.ts");
const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(ensureNode22)) {
  fail(`TripleAgent bootstrap script not found: ${ensureNode22}`);
}

const nodePath = spawnSync("bash", [ensureNode22], {
  cwd: ROOT,
  encoding: "utf8",
});

if (nodePath.status !== 0) {
  fail(nodePath.stderr || "Failed to bootstrap Node 22 runtime.");
}

const nodeBin = nodePath.stdout.trim();
if (!nodeBin) {
  fail("Node 22 bootstrap returned an empty path.");
}

const args = process.argv.slice(2);
const entryArgs = fs.existsSync(distEntry) ? [distEntry, ...args] : [tsxCli, srcEntry, ...args];
const result = spawnSync(nodeBin, entryArgs, {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
