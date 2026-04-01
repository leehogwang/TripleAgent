const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline/promises");

const repoRoot = __dirname;
const workspaceRoot = path.dirname(repoRoot);

// Load .env from the workspace root so all env vars are available to the launcher
require("dotenv").config({ path: path.join(workspaceRoot, ".env") });
const cliPath = path.join(repoRoot, "package", "cli.js");
const brandingPatchPath = path.join(repoRoot, "patch-branding.js");
const defaultPorts = {
  openai: "8787",
  gemini: "8788",
  groq: "8789",
  copilot: "8790",
  zai: "8791",
  ollama: "8792",
};

let exiting = false;
let proxyProcess = null;
let ownsProxyProcess = false;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  cleanupAndExit(1);
});

async function main() {
  applyBrandingPatch();

  const { providerArg, modelArg, forwardArgs } = parseLauncherArgs(process.argv.slice(2));
  const infoOnly = isInfoOnlyInvocation(forwardArgs);

  if (infoOnly) {
    return launchBundledClient({ ...process.env }, forwardArgs);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const provider = await resolveProvider(rl, providerArg, forwardArgs);
    const env = { ...process.env };

    if (provider === "anthropic") {
      if (!infoOnly) {
        await configureAnthropic(env, rl);
      }
      return launchBundledClient(env, forwardArgs);
    }

    await configureCompatProvider(provider, env, rl, modelArg);
    await ensureCompatProxy(provider, env);
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${env.ANTHROPIC_COMPAT_PORT}`;
    env.ANTHROPIC_AUTH_TOKEN = "claw-dev-proxy";
    delete env.ANTHROPIC_API_KEY;
    return launchBundledClient(env, forwardArgs);
  } finally {
    rl.close();
  }
}

function parseLauncherArgs(args) {
  const forwardArgs = [];
  let providerArg = null;
  let modelArg = null;

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === "--provider") {
      providerArg = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (value === "--model") {
      modelArg = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    forwardArgs.push(value);
  }

  return { providerArg, modelArg, forwardArgs };
}

function applyBrandingPatch() {
  if (!fs.existsSync(brandingPatchPath)) {
    return;
  }

  require(brandingPatchPath);
}

async function resolveProvider(rl, providerArg, forwardArgs) {
  const preset = normalizeProviderName((providerArg ?? process.env.CLAW_PROVIDER ?? "").trim().toLowerCase());
  if (["anthropic", "openai", "gemini", "groq", "copilot", "zai", "ollama"].includes(preset)) {
    return preset;
  }

  if (isInfoOnlyInvocation(forwardArgs)) {
    return "anthropic";
  }

  process.stdout.write("\nClaw Dev provider setup\n");
  process.stdout.write("1. Anthropic account or ANTHROPIC_API_KEY\n");
  process.stdout.write("2. OpenAI API\n");
  process.stdout.write("3. Gemini API\n");
  process.stdout.write("4. Groq API\n");
  process.stdout.write("5. Copilot (GitHub Models API)\n");
  process.stdout.write("6. z.ai API\n");
  process.stdout.write("7. Ollama (local)\n\n");

  const answer = (await rl.question("Choose a provider [1]: ")).trim();
  switch (answer || "1") {
    case "1":
      return "anthropic";
    case "2":
      return "openai";
    case "3":
      return "gemini";
    case "4":
      return "groq";
    case "5":
      return "copilot";
    case "6":
      return "zai";
    case "7":
      return "ollama";
    default:
      throw new Error(`Unknown provider option: ${answer}`);
  }
}

function normalizeProviderName(raw) {
  if (raw === "claude") {
    return "anthropic";
  }
  if (raw === "grok") {
    return "groq";
  }
  if (raw === "github" || raw === "github-models") {
    return "copilot";
  }
  if (raw === "z.ai") {
    return "zai";
  }
  if (raw === "chatgpt") {
    return "openai";
  }
  return raw;
}

function isInfoOnlyInvocation(forwardArgs) {
  return (
    forwardArgs.includes("--version") ||
    forwardArgs.includes("-v") ||
    forwardArgs.includes("--help") ||
    forwardArgs.includes("-h")
  );
}

async function configureAnthropic(env, rl) {
  process.stdout.write("\nLaunching Anthropic-backed mode.\n");

  if (env.ANTHROPIC_API_KEY?.trim()) {
    process.stdout.write("Using ANTHROPIC_API_KEY from the current environment.\n");
    process.stdout.write("The bundled terminal client may ask you to confirm the detected custom API key on startup.\n");
    return;
  }

  const answer = (await rl.question(
    "No ANTHROPIC_API_KEY found. Use the normal Anthropic login flow in the app? [Y/n]: ",
  ))
    .trim()
    .toLowerCase();

  if (answer === "n" || answer === "no") {
    const key = (await rl.question("Enter ANTHROPIC_API_KEY (input is visible): ")).trim();
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY was not provided.");
    }
    env.ANTHROPIC_API_KEY = key;
    process.stdout.write("Using the provided ANTHROPIC_API_KEY for this session.\n");
    process.stdout.write("The bundled terminal client may ask you to confirm the detected custom API key on startup.\n");
    return;
  }

  process.stdout.write("You can log in with an Anthropic account or Anthropic Console inside the app.\n");
}

async function configureCompatProvider(provider, env, rl, modelArg) {
  env.ANTHROPIC_COMPAT_PROVIDER = provider;
  env.ANTHROPIC_COMPAT_PORT = env.ANTHROPIC_COMPAT_PORT || defaultPorts[provider];

  switch (provider) {
    case "openai": {
      if (!env.OPENAI_API_KEY?.trim()) {
        const key = (await rl.question("Enter OPENAI_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("OPENAI_API_KEY is required for OpenAI mode.");
        }
        env.OPENAI_API_KEY = key;
      }
      env.OPENAI_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "OPENAI_MODEL",
        defaultModel: "gpt-4.1-mini",
        suggestions: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o", "o4-mini"],
      });
      process.stdout.write(`\nLaunching OpenAI mode with model ${env.OPENAI_MODEL}.\n`);
      break;
    }
    case "gemini": {
      if (!env.GEMINI_API_KEY?.trim()) {
        const key = (await rl.question("Enter GEMINI_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("GEMINI_API_KEY is required for Gemini mode.");
        }
        env.GEMINI_API_KEY = key;
      }
      env.GEMINI_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "GEMINI_MODEL",
        defaultModel: "gemini-2.5-flash",
        suggestions: ["gemini-2.5-flash", "gemini-2.5-pro", "gemma-3-27b-it"],
      });
      process.stdout.write(`\nLaunching Gemini mode with model ${env.GEMINI_MODEL}.\n`);
      break;
    }
    case "groq": {
      if (!env.GROQ_API_KEY?.trim()) {
        const key = (await rl.question("Enter GROQ_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("GROQ_API_KEY is required for Groq mode.");
        }
        env.GROQ_API_KEY = key;
      }
      env.GROQ_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "GROQ_MODEL",
        defaultModel: "openai/gpt-oss-20b",
        suggestions: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3-32b", "llama-3.3-70b-versatile"],
      });
      process.stdout.write(`\nLaunching Groq mode with model ${env.GROQ_MODEL}.\n`);
      break;
    }
    case "ollama": {
      env.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
      env.OLLAMA_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "OLLAMA_MODEL",
        defaultModel: "qwen3",
        suggestions: ["qwen3", "qwen2.5-coder:7b", "qwen2.5-coder:14b", "deepseek-r1:8b"],
      });
      env.OLLAMA_KEEP_ALIVE = env.OLLAMA_KEEP_ALIVE?.trim() || "30m";
      process.stdout.write(`\nLaunching Ollama mode against ${env.OLLAMA_BASE_URL} with model ${env.OLLAMA_MODEL}.\n`);
      process.stdout.write(`Ollama keep-alive is set to ${env.OLLAMA_KEEP_ALIVE} for faster follow-up turns.\n`);
      process.stdout.write("Make sure Ollama is running and the model is already pulled.\n");
      break;
    }
    case "copilot": {
      if (!env.COPILOT_TOKEN?.trim()) {
        const key = (await rl.question("Enter COPILOT_TOKEN or GitHub Models PAT (input is visible): ")).trim();
        if (!key) {
          throw new Error("COPILOT_TOKEN is required for Copilot mode.");
        }
        env.COPILOT_TOKEN = key;
      }
      env.COPILOT_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "COPILOT_MODEL",
        defaultModel: "openai/gpt-4.1-mini",
        suggestions: ["openai/gpt-4.1-mini", "openai/gpt-4.1", "openai/gpt-4o", "openai/o4-mini"],
      });
      process.stdout.write(`\nLaunching Copilot mode with model ${env.COPILOT_MODEL}.\n`);
      break;
    }
    case "zai": {
      if (!env.ZAI_API_KEY?.trim()) {
        const key = (await rl.question("Enter ZAI_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("ZAI_API_KEY is required for z.ai mode.");
        }
        env.ZAI_API_KEY = key;
      }
      env.ZAI_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "ZAI_MODEL",
        defaultModel: "glm-5",
        suggestions: ["glm-5", "glm-4.5", "glm-4.5-air"],
      });
      process.stdout.write(`\nLaunching z.ai mode with model ${env.ZAI_MODEL}.\n`);
      break;
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function resolveModelSelection({ rl, env, provider, modelArg, envKey, defaultModel, suggestions }) {
  const existing = env[envKey]?.trim() || defaultModel;
  const override = modelArg?.trim();
  if (override) {
    env[envKey] = override;
    return override;
  }

  process.stdout.write(`Suggested ${provider} models: ${suggestions.join(", ")}\n`);
  const answer = (
    await rl.question(`Model for ${provider} [${existing}] (any model id is allowed): `)
  ).trim();

  // Warn if the input looks like a menu number instead of a model name.
  // Only applies to single/double digit numbers — real model IDs like
  // "qwen2.5-coder:7b" contain non-digit characters and won't match.
  if (answer && /^\d{1,2}$/.test(answer) && suggestions.length > 0) {
    process.stdout.write(
      `\n⚠  "${answer}" looks like a menu number, not a model name.\n` +
      `   Did you mean one of: ${suggestions.join(", ")}?\n` +
      `   Using default model: ${existing}\n\n`
    );
    env[envKey] = existing;
    return env[envKey];
  }

  env[envKey] = answer || existing;
  return env[envKey];
}

async function ensureCompatProxy(provider, env) {
  const proxyPort = await resolveCompatPort(provider, env);
  env.ANTHROPIC_COMPAT_PORT = proxyPort;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  if (await isHealthyProxy(proxyUrl, provider, modelForProvider(provider, env))) {
    return;
  }

  proxyProcess =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", "npm run proxy:compat"], {
          cwd: workspaceRoot,
          stdio: "ignore",
          windowsHide: true,
          env,
        })
      : spawn("npm", ["run", "proxy:compat"], {
          cwd: workspaceRoot,
          stdio: "ignore",
          env,
        });

  ownsProxyProcess = true;

  proxyProcess.on("exit", (code) => {
    if (!exiting && code && code !== 0) {
      console.error(`Compatibility proxy exited early with code ${code}.`);
      cleanupAndExit(code);
    }
  });

  await waitForProxy(proxyUrl, provider, modelForProvider(provider, env));
}

async function resolveCompatPort(provider, env) {
  const preferredPort = String(env.ANTHROPIC_COMPAT_PORT || defaultPorts[provider]);
  const preferredUrl = `http://127.0.0.1:${preferredPort}`;
  const model = modelForProvider(provider, env);

  if (await isHealthyProxy(preferredUrl, provider, model)) {
    return preferredPort;
  }

  if (await canListenOnPort(preferredPort)) {
    return preferredPort;
  }

  let candidate = Number.parseInt(preferredPort, 10) + 1;
  for (let attempts = 0; attempts < 25; attempts += 1, candidate += 1) {
    const candidatePort = String(candidate);
    const candidateUrl = `http://127.0.0.1:${candidatePort}`;

    if (await isHealthyProxy(candidateUrl, provider, model)) {
      return candidatePort;
    }

    if (await canListenOnPort(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(`Could not find a free compatibility proxy port starting from ${preferredPort}.`);
}

function modelForProvider(provider, env) {
  switch (provider) {
    case "openai":
      return env.OPENAI_MODEL;
    case "gemini":
      return env.GEMINI_MODEL;
    case "groq":
      return env.GROQ_MODEL;
    case "ollama":
      return env.OLLAMA_MODEL;
    case "copilot":
      return env.COPILOT_MODEL;
    case "zai":
      return env.ZAI_MODEL;
    default:
      return "";
  }
}

function waitForProxy(proxyUrl, provider, model) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 50;

    const tryOnce = async () => {
      attempts += 1;
      if (await isHealthyProxy(proxyUrl, provider, model)) {
        resolve();
        return;
      }

      if (attempts >= maxAttempts) {
        reject(new Error(`Compatibility proxy did not start on ${proxyUrl} for ${provider}:${model}.`));
        return;
      }

      setTimeout(tryOnce, 250);
    };

    void tryOnce();
  });
}

function isHealthyProxy(proxyUrl, provider, model) {
  return new Promise((resolve) => {
    const req = http.get(`${proxyUrl}/health`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve(false);
          return;
        }

        resolve(body.includes(`"provider":"${provider}"`) && body.includes(`"model":"${model}"`));
      });
    });

    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", () => {
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(Number(port), "127.0.0.1");
  });
}

function launchBundledClient(env, forwardArgs) {
  process.on("SIGINT", () => cleanupAndExit(130));
  process.on("SIGTERM", () => cleanupAndExit(143));
  process.on("exit", () => {
    if (ownsProxyProcess && proxyProcess && !proxyProcess.killed) {
      proxyProcess.kill();
    }
  });

  const child = spawn(process.execPath, [cliPath, ...forwardArgs], {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      cleanupAndExit(1);
      return;
    }
    cleanupAndExit(code ?? 0);
  });
}

function cleanupAndExit(code) {
  if (exiting) {
    return;
  }
  exiting = true;
  if (ownsProxyProcess && proxyProcess && !proxyProcess.killed) {
    proxyProcess.kill();
  }
  process.exit(code);
}
