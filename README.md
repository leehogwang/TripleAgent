# Claw Dev

Claw Dev is a local multi-provider coding assistant launcher for the bundled terminal client in this repository. It gives you one entry point and lets you choose how model requests are resolved at startup:

- Anthropic account login or `ANTHROPIC_API_KEY`
- OpenAI through a local Anthropic-compatible proxy
- Google Gemini through a local Anthropic-compatible proxy
- Groq through a local Anthropic-compatible proxy
- Copilot through the GitHub Models API
- z.ai through a local Anthropic-compatible proxy
- Ollama through a local Anthropic-compatible proxy

Claw Dev is designed to feel like one tool rather than a provider-specific wrapper. The launcher, provider prompts, environment variables, and documentation are all centered around the `Claw Dev` name.

## Repository Layout

- `Leonxlnx-claude-code/`
  - bundled terminal client and platform launchers
- `src/anthropicCompatProxy.ts`
  - local Anthropic-compatible proxy used for OpenAI, Gemini, Groq, Ollama, Copilot, and z.ai
- `.env.example`
  - optional environment template for local setup
- `package.json`
  - root scripts for launching, building, and validating the workspace

## Supported Providers

### Anthropic

Use the bundled client with the normal Anthropic login flow or with `ANTHROPIC_API_KEY`.

### OpenAI

Route requests through the local compatibility proxy. By default Claw Dev uses `OPENAI_API_KEY`. As an experimental fallback, it can also reuse an existing ChatGPT/Codex login from `~/.codex/auth.json` when available.

### Gemini

Use a Google Gemini API key and route requests through the local compatibility proxy.

### Groq

Use a Groq API key and route requests through the local compatibility proxy.

### Ollama

Use a local or remote Ollama server and route requests through the local compatibility proxy.

This is the best option if you want local inference and do not want to depend on a cloud API provider.

### Copilot

Use a GitHub Models-compatible bearer token and route requests through the local compatibility proxy.

### z.ai

Use a z.ai API key and route requests through the local compatibility proxy.

## Requirements

Install the following before you begin:

- Node.js 22 or newer
- npm
- Windows users should install Git for Windows for the best terminal workflow

Provider-specific requirements:

- Anthropic
  - an Anthropic account for in-app login, or `ANTHROPIC_API_KEY`
- OpenAI
  - `OPENAI_API_KEY`
  - or `codex login` if you want to reuse your ChatGPT/Codex OAuth session from `~/.codex/auth.json` as an experimental fallback
- Gemini
  - `GEMINI_API_KEY`
- Groq
  - `GROQ_API_KEY`
- Ollama
  - a running Ollama installation
  - at least one pulled model, such as `qwen3`
- Copilot
  - `COPILOT_TOKEN` or another GitHub Models-compatible bearer token
- z.ai
  - `ZAI_API_KEY`

## System Requirements

### Minimum project requirements

These requirements apply to Claw Dev itself:

- Node.js 22+
- enough free disk space for Node dependencies and any local model assets you choose to install
- one of the following shells:
  - Windows PowerShell or Command Prompt
  - macOS Terminal, iTerm2, `bash`, or `zsh`
  - Linux terminal with `bash` or `zsh`

### Ollama platform notes

According to the official Ollama documentation:

- Ollama is available for Windows, macOS, and Linux
- the local Ollama API is served by default at `http://localhost:11434/api`
- no authentication is required for local API access on `http://localhost:11434`
- on Windows, Ollama reads standard user and system environment variables

### Ollama hardware guidance

Official Ollama documentation explains that loaded models may run fully on GPU, fully in system memory, or split across CPU and GPU, and that actual memory use depends on the model you choose. The exact hardware requirement therefore depends primarily on model size.

Practical guidance for Claw Dev users:

- For small local coding models, 16 GB system RAM is a reasonable starting point
- For smoother local work, 32 GB RAM is strongly preferred
- A dedicated GPU helps significantly, especially for larger models and faster response times
- If you do not have a capable GPU, Ollama can still run on CPU, but generation will be slower
- Larger models require substantially more RAM or VRAM and may be impractical on entry-level hardware

Conservative model guidance:

- `qwen3` or similar 8B-class models are the easiest place to start on consumer hardware
- mid-size models usually benefit from 16 GB to 24 GB of available VRAM, or enough combined GPU and system memory for mixed CPU/GPU loading
- very large models are generally not a practical default for local coding workflows unless you already have a high-memory workstation

This guidance is an implementation recommendation based on Ollama's documented runtime behavior and common model sizes. It is not an official Ollama sizing table.

## Installation

From the repository root on Windows:

```powershell
cd E:\myclaudecode
npm install
copy .env.example .env
```

From the repository root on macOS or Linux:

```bash
cd /path/to/myclaudecode
npm install
cp .env.example .env
```

Editing `.env` is optional. Claw Dev can prompt for missing values interactively when it starts.

## Quick Start

Start Claw Dev from the repository root on any platform:

```bash
npm run claw-dev
```

Or launch it directly from the bundled client directory on Windows:

```powershell
cd E:\myclaudecode\Leonxlnx-claude-code
.\claw-dev.cmd
```

Or launch it directly from the bundled client directory on macOS or Linux:

```bash
cd /path/to/myclaudecode/Leonxlnx-claude-code
chmod +x ./claw-dev.sh
./claw-dev.sh
```

When Claw Dev starts, it shows a provider selector:

1. Anthropic
2. OpenAI
3. Gemini
4. Groq
5. Copilot
6. z.ai
7. Ollama

If a required API key is missing, Claw Dev prompts for it.

After you choose a provider, Claw Dev also lets you enter any model id you want for that session. You can press Enter to keep the suggested default, or type a custom model id such as:

- `gpt-4.1`
- `gpt-4o-mini`
- `gemini-2.5-pro`
- `openai/gpt-oss-120b`
- `openai/o4-mini`
- `qwen2.5-coder:14b`

Claw Dev also narrows the bundled in-app `/model` picker to the provider-relevant model set for the current session where possible. Some labels may still reflect provider-specific naming, and any custom model id is still allowed through `--model`.

## Additional Cloud Provider Setup

### Copilot

Recommended `.env` values:

```env
COPILOT_TOKEN=your_github_models_token_here
COPILOT_MODEL=openai/gpt-4.1-mini
COPILOT_MODEL_SONNET=openai/gpt-4.1-mini
COPILOT_MODEL_OPUS=openai/gpt-4.1
COPILOT_MODEL_HAIKU=openai/gpt-4.1-mini
```

### z.ai

Recommended `.env` values:

```env
ZAI_API_KEY=your_zai_api_key_here
ZAI_MODEL=glm-5
```

### OpenAI

Recommended `.env` values:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4
```

If `~/.codex/auth.json` exists, Claw Dev can reuse that ChatGPT/Codex login as an experimental fallback. Example placeholder values such as `your_openai_api_key_here` are ignored. The in-app `/model` picker is filtered toward the active provider where possible, but provider-specific labels may still appear. Keyring-backed Codex auth is not supported yet.

## How To Use Ollama With Claw Dev

### 1. Install Ollama

Install Ollama from the official download page:

- [Ollama Downloads](https://ollama.com/download)

After installation, make sure the Ollama application or service is running.

### 2. Pull a local model

For a lightweight starting point:

```powershell
ollama pull qwen3
```

You can verify that the model is available with:

```powershell
ollama list
```

### 3. Start the Ollama server

If Ollama is not already running in the background, start it with:

```powershell
ollama serve
```

The default local API base URL is:

```text
http://127.0.0.1:11434
```

### 4. Start Claw Dev and choose Ollama

```powershell
cd E:\myclaudecode
npm run claw-dev
```

Then choose:

```text
4. Ollama
```

Claw Dev will point the bundled client at the local compatibility proxy, and the proxy will forward requests to your Ollama server.

### 5. Optional environment configuration

You can preconfigure Ollama mode in `.env`:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3
OLLAMA_API_KEY=
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_PREDICT=128
```

Notes:

- `OLLAMA_BASE_URL` should point to your Ollama server
- `OLLAMA_MODEL` is the model name Claw Dev will request
- `OLLAMA_API_KEY` is not required for local Ollama on `localhost`
- `OLLAMA_API_KEY` is only relevant if you are targeting an authenticated remote Ollama endpoint or the hosted Ollama API
- `OLLAMA_KEEP_ALIVE` keeps the model loaded between turns, which reduces repeated warm-up time
- `OLLAMA_NUM_CTX` controls prompt context size
- `OLLAMA_NUM_PREDICT` limits output length and can reduce latency

### 6. Check that Ollama is really being used

Useful checks:

```powershell
ollama ps
```

This shows which models are currently loaded and whether they are using CPU, GPU, or both.

You can also confirm that the Claw Dev proxy is healthy:

```powershell
npm run proxy:compat
```

Then open:

```text
http://127.0.0.1:8789/health
```

When Ollama mode is configured, you should see a JSON response with the active provider and model.

### 7. Ollama performance tuning

If Ollama feels slow, start with the following assumptions:

- larger context windows are slower
- longer outputs are slower
- first-token latency is usually worst on the first request after model load
- CPU-only inference is much slower than GPU-backed inference

Recommended starting values for a responsive local setup:

```env
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_PREDICT=128
```

If you need more quality and longer context, increase `OLLAMA_NUM_CTX` gradually to `4096` or higher. If you want faster responses, keep it smaller.

If you need shorter answers and lower latency, reduce `OLLAMA_NUM_PREDICT` further.

## Recommended Environment Variables

### Anthropic

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

### OpenAI

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4
```

If you already ran `codex login`, you can leave `OPENAI_API_KEY` unset and Claw Dev will reuse `~/.codex/auth.json` as an experimental fallback. Example placeholder values are treated as unset.

### Gemini

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### Groq

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-20b
```

### Ollama

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3
OLLAMA_API_KEY=
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_PREDICT=128
```

### Copilot

```env
COPILOT_TOKEN=your_github_models_token_here
COPILOT_MODEL=openai/gpt-4.1-mini
COPILOT_MODEL_SONNET=openai/gpt-4.1-mini
COPILOT_MODEL_OPUS=openai/gpt-4.1
COPILOT_MODEL_HAIKU=openai/gpt-4.1-mini
```

### z.ai

```env
ZAI_API_KEY=your_zai_api_key_here
ZAI_MODEL=glm-5
```

## Useful Commands

Check the installed launcher version:

```powershell
cd E:\myclaudecode\Leonxlnx-claude-code
.\claw-dev.cmd --version
```

Check the installed launcher version on macOS or Linux:

```bash
cd /path/to/myclaudecode/Leonxlnx-claude-code
chmod +x ./claw-dev.sh
./claw-dev.sh --version
```

Skip the provider menu and force a specific provider:

```powershell
.\claw-dev.cmd --provider anthropic
.\\claw-dev.cmd --provider openai
.\claw-dev.cmd --provider gemini
.\claw-dev.cmd --provider groq
.\claw-dev.cmd --provider copilot
.\claw-dev.cmd --provider zai
.\claw-dev.cmd --provider ollama
```

You can also skip the default model prompt and force any model id directly:

```powershell
.\claw-dev.cmd --provider openai --model gpt-4.1
.\claw-dev.cmd --provider gemini --model gemini-2.5-pro
.\claw-dev.cmd --provider groq --model openai/gpt-oss-120b
.\claw-dev.cmd --provider copilot --model openai/o4-mini
.\claw-dev.cmd --provider zai --model glm-4.5
.\claw-dev.cmd --provider ollama --model qwen2.5-coder:14b
```

Equivalent macOS or Linux examples:

```bash
./claw-dev.sh --provider openai --model gpt-4.1
./claw-dev.sh --provider ollama --model qwen2.5-coder:14b
```

If you want extra suggestions to appear in the proxy model catalog, you can define optional comma-separated model lists:

```env
OPENAI_MODELS=gpt-4.1-mini,gpt-4.1,gpt-4o-mini,gpt-4o,o4-mini
GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-pro,gemma-3-27b-it
GROQ_MODELS=openai/gpt-oss-20b,openai/gpt-oss-120b,qwen/qwen3-32b
COPILOT_MODELS=openai/gpt-4.1-mini,openai/gpt-4.1,openai/gpt-4o,openai/o4-mini
ZAI_MODELS=glm-5,glm-4.5,glm-4.5-air
OLLAMA_MODELS=qwen3,qwen2.5-coder:7b,qwen2.5-coder:14b,deepseek-r1:8b
```

Important note:

- the startup model override accepts any model id
- the bundled `/model` command inside the client is still based on the bundled UI, so its labels may not match your provider exactly
- Claw Dev uses your startup model choice as the real backend model for the session

Legacy aliases are still accepted:

```powershell
.\claw-dev.cmd --provider claude
.\claw-dev.cmd --provider grok
```

Run a one-shot prompt:

```powershell
echo "Summarize this repository" | .\claw-dev.cmd --bare -p
```

## Git Privacy Before Publishing

Before creating public commits, verify that your local Git identity is safe to publish.

Recommended settings for this repository:

```powershell
git config user.name "Leonxlnx"
git config user.email "219127460+Leonxlnx@users.noreply.github.com"
```

You can verify the active values with:

```powershell
git config user.name
git config user.email
```

Important notes:

- `.env` is ignored by `.gitignore`
- `node_modules` is ignored
- `dist` is ignored
- `*.log` files are ignored
- always review `git status` before staging
- always review `git diff --cached` before pushing

Useful checks:

```powershell
git status --short
git diff --cached
```

## Architecture Overview

Claw Dev works in two modes:

- Anthropic mode
  - the bundled client talks to Anthropic directly
- Compatibility mode
  - the bundled client talks to the local proxy
  - the local proxy translates Anthropic-style `/v1/messages` requests into OpenAI, Gemini, Groq, Ollama, Copilot, or z.ai API calls

This keeps the terminal experience consistent while allowing different model backends.

## Troubleshooting

### Ollama does not answer

Check the following:

- Ollama is installed
- the Ollama service or background app is running
- `ollama serve` is active if needed
- the selected model was pulled successfully
- `OLLAMA_BASE_URL` points to the correct server

### Ollama answers slowly

Common causes:

- the model is running on CPU instead of GPU
- the selected model is too large for your hardware
- the model is partly swapping between GPU and system memory
- the context window is too large for your use case
- the requested answer is longer than necessary

Use:

```powershell
ollama ps
```

to inspect how the model is loaded.

If `PROCESSOR` shows `100% CPU`, slow generation is expected.

Recommended fixes:

- keep `OLLAMA_NUM_CTX` at `2048` first
- keep `OLLAMA_NUM_PREDICT` low for short answers
- leave `OLLAMA_KEEP_ALIVE=30m` or longer so the model stays warm
- try a smaller model if local responsiveness matters more than maximum quality

### Cloud providers work, but Ollama does not

That usually means Claw Dev is working correctly, but the local Ollama server is not reachable or does not have the requested model.

## Sharing With Another User

If you hand this repository to someone else, the shortest setup path is:

1. Install Node.js 22 or newer
2. Run `npm install`
3. Start `npm run claw-dev`
4. Choose a provider
5. Supply credentials or run Ollama locally

They do not need a separate global installation of the bundled client in order to use this repository.

## Verification

Useful checks:

```powershell
npm run check
npm run build
npm run claw-dev -- --version
```

## References

Official documentation used for this setup:

- [Ollama Documentation](https://docs.ollama.com/)
- [Ollama API Introduction](https://docs.ollama.com/api/introduction)
- [Ollama API Authentication](https://docs.ollama.com/api/authentication)
- [Ollama FAQ](https://docs.ollama.com/faq)
- [Anthropic Claude Code Quickstart](https://code.claude.com/docs/en/quickstart)
- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create)
- [Groq Docs](https://console.groq.com/docs)
- [GitHub Models API announcement](https://github.blog/changelog/2025-05-15-github-models-api-now-available)
