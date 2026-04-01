# TripleAgent

[한국어 README](./README.ko.md)

TripleAgent is a three-panel terminal coding assistant that runs `Codex`, `Claude`, and `Gemini` side by side inside one shared shell.

The current runtime is built around a Claude-style terminal harness:

- `Claude` runs through the vendored `claw-dev` compiled CLI
- `Codex` and `Gemini` are mounted into the same shell contract as parallel panels
- every provider uses native CLI authentication instead of API keys
- the default workflow is worktree-first, then `/pick` or `/fuse`

## What It Does

- Broadcast one prompt to `Codex`, `Claude`, and `Gemini` at the same time
- Keep a separate transcript for each panel
- Auto-create sibling git worktrees:
  - `../codex1`
  - `../claude1`
  - `../gemini1`
- Capture each panel's implementation result as a diff bundle
- Let you choose one implementation with `/pick`
- Let you merge all implementations with `/fuse`
- Dim and disable a panel when auth is missing or quota is exhausted
- Stop all running agents with `Esc` twice

## CLI UX

The UI is intentionally open rather than boxed. Panels are separated by faint vertical dividers, with shared input at the bottom.

```text
TripleAgent
Claude harness shell · Ready panels: 3/3 · Mode: PLAN · CWD: /repo
Press Esc again to stop all running agents.

Codex · running · plan      │ Claude · ready · plan       │ Gemini · locked · plan
codex> inspect src/app.ts   │ claude> /init               │ gemini> panel disabled
[10:21:14] user             │ [10:21:06] system           │ [10:20:41] system
Implement the parser...     │ Initialized on /repo/...    │ Authentication required.
[10:21:19] assistant        │ [10:21:11] assistant        │ Limited: /status /login /logout
I found two edge cases...   │ Ready for scoped work.      │
                            │                              │

shared> build the feature and add tests

Tab focus · Shift+Up/Down scroll active panel · Shared: /help /status /plan /init /clear /resume /pick /fuse · Esc Esc stops all
```

## Interaction Model

TripleAgent has two input layers.

### Shared Composer

The shared composer is the default bottom input.

- normal text broadcasts to all ready panels
- orchestration commands are handled here
- locked panels are skipped automatically

Supported shared commands:

- `/help`
- `/status`
- `/plan`
- `/init`
- `/clear`
- `/resume`
- `/pick <codex|claude|gemini>`
- `/fuse`
- `/login`
- `/logout`
- `/exit`

### Panel Composers

Each panel has its own local composer.

- send a prompt only to that panel
- inspect one provider without broadcasting
- use provider-local slash commands on the Claude panel
- locked panels cannot receive input

## Keyboard Controls

- `Tab`: move focus between `Codex`, `Claude`, `Gemini`, and `shared`
- `Shift+Tab`: move focus backward
- `Shift+Up` / `Shift+Down`: scroll the active panel transcript
- `Esc`, then `Esc` again within 600 ms: stop all running agents
- `Ctrl+C`: interrupt running agents, or exit when idle

## Worktree Workflow

When you launch TripleAgent inside a git repository, it prepares parallel worktrees automatically.

- `codex` panel writes to `../codex1`
- `claude` panel writes to `../claude1`
- `gemini` panel writes to `../gemini1`

Branches are created or reused under:

- `tripleagent/codex1`
- `tripleagent/claude1`
- `tripleagent/gemini1`

If you launch outside a git repository:

- the shell still opens
- providers can still answer prompts
- worktree-dependent flows such as `/pick` and `/fuse` are disabled

## Pick and Fuse

### `/pick`

Choose one provider's latest captured diff bundle and apply it back to the main repository worktree using `git apply --3way`.

Example:

```text
/pick claude
```

### `/fuse`

Create or reuse `../fusion1`, then run one more Codex pass to combine the latest available provider bundles into a single merged implementation.

Example:

```text
/fuse
```

## Authentication and Quota Safety

TripleAgent does not use API keys in its main runtime path.

It expects native CLI login sessions:

- `codex login`
- `claude auth login`
- Gemini OAuth personal auth via the `gemini` CLI

Panel states:

- `ready`: usable
- `running`: currently generating
- `locked`: disabled because of auth, quota, or workspace restrictions
- `error`: provider failed but is not permanently locked

Quota protection is strict:

- if auth is missing, the panel is dimmed and excluded from broadcasts
- if quota appears exhausted, the panel is locked
- Claude is locked before it can spill into paid overage behavior

Check auth state:

```bash
tripleagent auth status
```

Log in:

```bash
tripleagent auth login claude
tripleagent auth login codex
tripleagent auth login gemini
```

## Installation

### Local Development

```bash
git clone https://github.com/leehogwang/TripleAgent.git
cd TripleAgent
npm run bootstrap:node22
bash scripts/npm22.sh install
```

### Repository Launcher

```bash
npm run triple-agent
```

### Installed CLI

```bash
bash install.sh
tripleagent
```

## Validation

Type check:

```bash
npm run check
```

Build:

```bash
npm run build
```

Full auth-backed smoke test:

```bash
npm run dry-run:triple -- --cwd /path/to/TripleAgent
```

The dry run verifies:

- auth preflight
- worktree preflight
- one real response from `Codex`
- one real response from `Claude`
- one real response from `Gemini`

## Repository Layout

- `src/index.ts`
  - CLI entrypoint, auth subcommand, dry run
- `src/tripleagent/app.tsx`
  - TripleAgent Ink shell
- `src/tripleagent/providers.ts`
  - provider turn execution and interruption
- `src/tripleagent/worktree.ts`
  - git worktree setup, diff capture, bundle apply
- `src/tripleagent/auth.ts`
  - native auth status and login/logout helpers
- `src/tripleagent/commands.ts`
  - shared command parsing and help text
- `scripts/`
  - Node 22 bootstrap helpers
- `bin/tripleagent.js`
  - installed CLI launcher
- `Leonxlnx-claude-code/`
  - vendored `claw-dev` source and compiled CLI
- `reference/AgentForge/`
  - copied reference implementation used for panel and workflow ideas

## Notes

- `Claude` is the closest thing to the original harness source of truth
- `Codex` and `Gemini` are mounted into the same shell UX, but they still run through their own native CLIs
- the shell is designed for repository work, not just answering chat questions
- generated worktrees live outside the repo root and are not part of the normal commit set
