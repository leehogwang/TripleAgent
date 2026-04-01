# Repository Guidelines

## Project Structure & Module Organization
`agentforge` is the core Python entrypoint and contains the interactive CLI, agent loop, TUI, persistence, and tool orchestration. `bin/agentforge.js` is the npm launcher that handles first-run setup and forwards to the Python script. `scripts/postinstall.js` supports npm installation, and `install.sh` installs the script directly into `~/.local/bin`. Documentation lives in `README.md`, `README.ko.md`, and `FEATURES.ko.md`. There is no dedicated `src/` or `tests/` directory in the current layout.

## Build, Test, and Development Commands
Use `python3 -m py_compile agentforge` for a fast syntax check before committing. Run `python3 agentforge --help` to confirm the CLI boots without entering interactive mode. Use `python3 agentforge -d /path/to/project` to test the local CLI against a target workspace. For install flows, use `bash install.sh` from a git clone or `npm install -g .` to validate the npm package locally. `npm pack --dry-run` is the safest way to verify published package contents.

## Coding Style & Naming Conventions
Follow the existing style in the single-file Python CLI: 4-space indentation, `snake_case` for functions, `UPPER_CASE` for constants, and short helper functions for repeated logic. Keep user-facing terminal text consistent with the current Korean-first CLI. In the Node launcher, preserve the existing defensive setup checks and clear inline comments. No formatter or linter is configured, so match surrounding style exactly and avoid broad reformatting.

## Testing Guidelines
There is no automated test suite yet, so rely on focused smoke checks. At minimum, verify `python3 -m py_compile agentforge`, `python3 agentforge --help`, and the specific runtime path you changed, such as startup, reconnect, or install behavior. If you add tests later, prefer behavior-based names such as `test_resume_session.py` and keep them scoped to one CLI feature.

## Commit & Pull Request Guidelines
Recent history uses short imperative subjects and occasional prefixes such as `fix:`. Prefer concise, behavior-focused commit titles, for example `fix: restore per-workdir reconnect`. Pull requests should include the problem being solved, the commands used for manual verification, and any platform notes for Linux, Windows, SSH, or tmux. Include screenshots or terminal captures when changing the TUI or installer experience.

## Security & Configuration Tips
Never commit local auth tokens, session files, or logs from `~/.codex` or `~/.agentforge`. When adding new config paths or environment variables, document them in `README.md` and keep defaults safe for local development.
