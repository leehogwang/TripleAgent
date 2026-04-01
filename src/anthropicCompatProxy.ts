import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { FunctionCallingConfigMode, GoogleGenAI, createPartFromFunctionResponse } from "@google/genai";
import { config as loadEnv } from "dotenv";
import { formatOpenAIAuthHint, resolveOpenAIAuth } from "../shared/openaiAuth.js";
import {
  openAICompatibleMessagesToResponsesInput,
  openAICompatibleToolsToResponsesTools,
  parseResponsesSseToResult,
  sliceResponsesInputToLatestToolTurn,
} from "../shared/openaiResponsesCompat.js";
import { providerLabel, providerModelCatalog } from "../shared/providerModels.js";

loadEnv({ quiet: true });

type CompatProvider = "openai" | "gemini" | "groq" | "ollama" | "copilot" | "zai";

type AnthropicMessageRequest = {
  model?: string;
  max_tokens?: number;
  stream?: boolean;
  system?: string | Array<{ type?: string; text?: string }>;
  messages?: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: {
    type?: "auto" | "any" | "none" | "tool";
    name?: string;
  };
};

type AnthropicTextBlock = {
  type: "text";
  text: string;
  citations: null;
};

type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

type AnthropicMessageResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use";
  stop_sequence: null;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    output_tokens: number;
    server_tool_use: null;
  };
};

type GeminiContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};

const PROVIDER = resolveProvider();
const PORT = Number(process.env.ANTHROPIC_COMPAT_PORT ?? process.env.GEMINI_PROXY_PORT ?? defaultPortFor(PROVIDER));
const ACTIVE_MODEL = resolveModel(PROVIDER);
const OLLAMA_BASE_URL = normalizeBaseUrl(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY?.trim();
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE?.trim();
const OLLAMA_NUM_CTX = parseOptionalInt(process.env.OLLAMA_NUM_CTX);
const OLLAMA_NUM_PREDICT = parseOptionalInt(process.env.OLLAMA_NUM_PREDICT);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim();
const COPILOT_TOKEN =
  process.env.COPILOT_TOKEN?.trim() ||
  process.env.GITHUB_MODELS_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim() ||
  process.env.GH_TOKEN?.trim();
const ZAI_API_KEY = process.env.ZAI_API_KEY?.trim();
const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const OPENAI_AUTH = PROVIDER === "openai" ? resolveOpenAIAuth({ env: process.env }) : null;

assertProviderConfiguration();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return sendJson(res, 200, {
        ok: true,
        provider: PROVIDER,
        model: ACTIVE_MODEL,
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      return sendJson(res, 200, buildModelsPage());
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/models/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/models/".length));
      return sendJson(res, 200, buildModelInfo(id));
    }

    if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
      const body = (await readJson(req)) as AnthropicMessageRequest;
      return sendJson(res, 200, {
        input_tokens: estimateInputTokens(body),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/messages") {
      const body = (await readJson(req)) as AnthropicMessageRequest;
      const result = await handleMessages(body);
      if (body.stream) {
        return sendMessageStream(res, result);
      }
      return sendJson(res, 200, result.message);
    }

    return sendJson(res, 404, {
      type: "error",
      error: {
        type: "not_found_error",
        message: `Unsupported endpoint: ${req.method ?? "GET"} ${url.pathname}`,
      },
    });
  } catch (error) {
    return sendJson(res, 500, {
      type: "error",
      error: {
        type: "api_error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    `Claw Dev Anthropic-compatible proxy listening on http://127.0.0.1:${PORT} (${PROVIDER}:${ACTIVE_MODEL})\n`,
  );
});

function resolveProvider(): CompatProvider {
  const raw = (
    process.env.ANTHROPIC_COMPAT_PROVIDER ??
    process.env.CLAW_PROVIDER ??
    "openai"
  )
    .trim()
    .toLowerCase();

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

  if (raw === "openai" || raw === "gemini" || raw === "groq" || raw === "ollama" || raw === "copilot" || raw === "zai") {
    return raw;
  }

  throw new Error(`Unsupported ANTHROPIC_COMPAT_PROVIDER: ${raw}`);
}

function defaultPortFor(provider: CompatProvider): string {
  switch (provider) {
    case "openai":
      return "8787";
    case "gemini":
      return "8788";
    case "groq":
      return "8789";
    case "ollama":
      return "8792";
    case "copilot":
      return "8790";
    case "zai":
      return "8791";
  }
}

function resolveModel(provider: CompatProvider): string {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
    case "gemini":
      return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    case "groq":
      return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
    case "ollama":
      return process.env.OLLAMA_MODEL?.trim() || "qwen3";
    case "copilot":
      return process.env.COPILOT_MODEL?.trim() || "openai/gpt-4.1-mini";
    case "zai":
      return process.env.ZAI_MODEL?.trim() || "glm-5";
  }
}

function assertProviderConfiguration(): void {
  if (PROVIDER === "openai") {
    const auth = OPENAI_AUTH ?? {
      status: "missing" as const,
      authType: "none" as const,
      authPath: "~/.codex/auth.json",
      reason: "auth-not-initialized",
    };
    if (auth.status !== "ok") {
      throw new Error(formatOpenAIAuthHint(auth));
    }
  }

  if (PROVIDER === "gemini" && !GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required when ANTHROPIC_COMPAT_PROVIDER=gemini");
  }

  if (PROVIDER === "groq" && !GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is required when ANTHROPIC_COMPAT_PROVIDER=groq");
  }

  if (PROVIDER === "copilot" && !COPILOT_TOKEN) {
    throw new Error("COPILOT_TOKEN or GITHUB_MODELS_TOKEN is required when ANTHROPIC_COMPAT_PROVIDER=copilot");
  }

  if (PROVIDER === "zai" && !ZAI_API_KEY) {
    throw new Error("ZAI_API_KEY is required when ANTHROPIC_COMPAT_PROVIDER=zai");
  }
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildOllamaRuntimeConfig(): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  if (OLLAMA_NUM_CTX !== undefined) {
    options.num_ctx = OLLAMA_NUM_CTX;
  }

  if (OLLAMA_NUM_PREDICT !== undefined) {
    options.num_predict = OLLAMA_NUM_PREDICT;
  }

  return {
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(OLLAMA_KEEP_ALIVE ? { keep_alive: OLLAMA_KEEP_ALIVE } : {}),
  };
}

function buildModelsPage() {
  const ids = providerModelCatalog(PROVIDER);

  return {
    data: ids.map((id) => buildModelInfo(id)),
    first_id: ids[0],
    has_more: false,
    last_id: ids.at(-1),
  };
}

function buildModelInfo(id: string) {
  return {
    type: "model",
    id,
    display_name: `${id} (${providerLabel(PROVIDER)} via Claw Dev proxy)`,
    created_at: "2026-03-31T00:00:00Z",
  };
}

function resolveRequestModel(body: AnthropicMessageRequest): string {
  const requested = body.model?.trim();
  if (!requested) {
    return ACTIVE_MODEL;
  }

  if (PROVIDER === "copilot") {
    return resolveCopilotRequestedModel(requested);
  }

  const catalog = providerModelCatalog(PROVIDER);
  if (catalog.includes(requested)) {
    return requested;
  }

  // Allow custom model ids for user-managed providers even if they are not in the default catalog.
  if (
    PROVIDER === "ollama" ||
    PROVIDER === "zai" ||
    PROVIDER === "groq" ||
    PROVIDER === "openai" ||
    PROVIDER === "gemini"
  ) {
    return requested;
  }

  return ACTIVE_MODEL;
}

function resolveCopilotRequestedModel(requested: string): string {
  const normalized = requested.trim().toLowerCase();

  if (providerModelCatalog("copilot").includes(requested)) {
    return requested;
  }

  if (normalized.includes("opus")) {
    return process.env.COPILOT_MODEL_OPUS?.trim() || "openai/gpt-4.1";
  }

  if (normalized.includes("haiku")) {
    return process.env.COPILOT_MODEL_HAIKU?.trim() || "openai/gpt-4.1-mini";
  }

  if (normalized.includes("sonnet") || normalized.startsWith("claude-")) {
    return process.env.COPILOT_MODEL_SONNET?.trim() || process.env.COPILOT_MODEL?.trim() || "openai/gpt-4.1-mini";
  }

  return requested;
}

async function handleMessages(body: AnthropicMessageRequest) {
  const requestId = `req_${randomUUID()}`;
  const providerModel = resolveRequestModel(body);
  const responseModel = body.model?.trim() || providerModel;

  let content: AnthropicContentBlock[];
  switch (PROVIDER) {
    case "openai":
      content = await runOpenAI(body, providerModel);
      break;
    case "gemini":
      content = await runGemini(body, providerModel);
      break;
    case "groq":
      content = await runGroq(body, providerModel);
      break;
    case "ollama":
      content = await runOllama(body, providerModel);
      break;
    case "copilot":
      content = await runCopilot(body, providerModel);
      break;
    case "zai":
      content = await runZai(body, providerModel);
      break;
  }

  const message: AnthropicMessageResponse = {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: responseModel,
    content,
    stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: estimateInputTokens(body),
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      output_tokens: estimateOutputTokens(content),
      server_tool_use: null,
    },
  };

  return { requestId, message };
}

async function runOpenAI(body: AnthropicMessageRequest, model: string): Promise<AnthropicContentBlock[]> {
  if (!OPENAI_AUTH || OPENAI_AUTH.status !== "ok") {
    throw new Error(
      formatOpenAIAuthHint(
        OPENAI_AUTH ?? {
          status: "missing",
          authType: "none",
          authPath: "~/.codex/auth.json",
          reason: "auth-not-initialized",
        },
      ),
    );
  }

  const toolNameById = new Map<string, string>();
  const systemInstruction = normalizeSystemPrompt(body.system);
  const rawMessages = anthropicMessagesToOpenAICompatible(
    body.messages ?? [],
    toolNameById,
    systemInstruction,
    { includeToolNameOnToolMessages: false },
  );
  const rawTools = anthropicToolsToOpenAITools(body.tools ?? []);
  const { messages, tools } = compactOpenAICompatibleRequest(systemInstruction, rawMessages, rawTools, "openai");

  if (OPENAI_AUTH.authType === "oauth") {
    const instructions = systemInstruction || "You are a helpful assistant.";
    const rawInput = sliceResponsesInputToLatestToolTurn(openAICompatibleMessagesToResponsesInput(messages));
    const responseTools = openAICompatibleToolsToResponsesTools(tools);
    const compactRequest = compactOpenAIResponsesRequest(instructions, rawInput, responseTools);
    const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${OPENAI_AUTH.bearerToken}`,
        ...(OPENAI_AUTH.accountId ? { "ChatGPT-Account-Id": OPENAI_AUTH.accountId } : {}),
        "User-Agent": "codex-cli/0.117.0",
        originator: "codex_cli_rs",
        "x-client-request-id": randomUUID(),
      },
      body: JSON.stringify({
        model,
        instructions: compactRequest.instructions,
        input: compactRequest.input,
        tools: compactRequest.tools,
        tool_choice: buildResponsesToolChoice(body.tool_choice, compactRequest.tools),
        parallel_tool_calls: true,
        reasoning: { effort: "none" },
        store: false,
        stream: true,
        include: [],
        text: {
          format: { type: "text" },
          verbosity: "medium",
        },
      }),
    });

    const sseText = await response.text();
    if (!response.ok) {
      throw new Error(sseText);
    }

    return parseResponsesSseToResult(sseText).content as AnthropicContentBlock[];
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_AUTH.bearerToken}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(tools.length > 0 ? { tool_choice: buildOpenAIToolChoice(body.tool_choice) } : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = (await response.json()) as Record<string, unknown>;
  return openAIMessageToAnthropicContent(extractOpenAIMessage(json), true);
}

async function runGemini(body: AnthropicMessageRequest, model: string): Promise<AnthropicContentBlock[]> {
  if (!geminiClient) {
    throw new Error("Gemini client is not configured");
  }

  const toolNameById = new Map<string, string>();
  const systemInstruction = normalizeSystemPrompt(body.system);
  const contents = anthropicMessagesToGemini(body.messages ?? [], toolNameById, systemInstruction, model);
  const toolDeclarations = anthropicToolsToGemini(body.tools ?? []);
  const useInlineSystemPrompt = shouldInlineSystemPrompt(model);

  const response = await geminiClient.models.generateContent({
    model,
    contents,
    config: {
      ...(!useInlineSystemPrompt && systemInstruction ? { systemInstruction } : {}),
      ...(toolDeclarations.length > 0
        ? {
            tools: [{ functionDeclarations: toolDeclarations }],
            toolConfig: {
              functionCallingConfig: buildGeminiFunctionCallingConfig(
                body.tool_choice,
                toolDeclarations.map((tool) => tool.name),
              ),
            },
          }
        : {}),
    },
  });

  const candidateParts = (response.candidates?.[0]?.content?.parts ?? []) as Array<Record<string, unknown>>;
  return geminiPartsToAnthropicContent(candidateParts);
}

async function runGroq(body: AnthropicMessageRequest, model: string): Promise<AnthropicContentBlock[]> {
  const toolNameById = new Map<string, string>();
  const systemInstruction = normalizeSystemPrompt(body.system);
  const rawMessages = anthropicMessagesToOpenAICompatible(
    body.messages ?? [],
    toolNameById,
    systemInstruction,
    { includeToolNameOnToolMessages: false },
  );
  const rawTools = anthropicToolsToOpenAITools(body.tools ?? []);
  const { messages, tools } = compactOpenAICompatibleRequest(systemInstruction, rawMessages, rawTools, "groq");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(tools.length > 0 ? { tool_choice: buildOpenAIToolChoice(body.tool_choice) } : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = (await response.json()) as Record<string, unknown>;
  return openAIMessageToAnthropicContent(extractOpenAIMessage(json), true);
}

async function runOllama(body: AnthropicMessageRequest, model: string): Promise<AnthropicContentBlock[]> {
  const toolNameById = new Map<string, string>();
  const systemInstruction = normalizeSystemPrompt(body.system);
  const messages = anthropicMessagesToOpenAICompatible(
    body.messages ?? [],
    toolNameById,
    systemInstruction,
    { includeToolNameOnToolMessages: true },
  );
  const tools = anthropicToolsToOpenAITools(body.tools ?? []);

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(OLLAMA_API_KEY ? { Authorization: `Bearer ${OLLAMA_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...buildOllamaRuntimeConfig(),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = (await response.json()) as Record<string, unknown>;
  return ollamaMessageToAnthropicContent(json.message);
}

async function runCopilot(body: AnthropicMessageRequest, model: string): Promise<AnthropicContentBlock[]> {
  const toolNameById = new Map<string, string>();
  const systemInstruction = normalizeSystemPrompt(body.system);
  const rawMessages = anthropicMessagesToOpenAICompatible(
    body.messages ?? [],
    toolNameById,
    systemInstruction,
    { includeToolNameOnToolMessages: false },
  );
  const rawTools = anthropicToolsToOpenAITools(body.tools ?? []);
  const { messages, tools } = compactOpenAICompatibleRequest(systemInstruction, rawMessages, rawTools, "copilot");

  const response = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${COPILOT_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(tools.length > 0 ? { tool_choice: buildOpenAIToolChoice(body.tool_choice) } : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = (await response.json()) as Record<string, unknown>;
  return openAIMessageToAnthropicContent(extractOpenAIMessage(json), true);
}

async function runZai(body: AnthropicMessageRequest, model: string): Promise<AnthropicContentBlock[]> {
  const toolNameById = new Map<string, string>();
  const systemInstruction = normalizeSystemPrompt(body.system);
  const rawMessages = anthropicMessagesToOpenAICompatible(
    body.messages ?? [],
    toolNameById,
    systemInstruction,
    { includeToolNameOnToolMessages: false },
  );
  const rawTools = anthropicToolsToOpenAITools(body.tools ?? []);
  const { messages, tools } = compactOpenAICompatibleRequest(systemInstruction, rawMessages, rawTools, "zai");

  const response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(tools.length > 0 ? { tool_choice: buildOpenAIToolChoice(body.tool_choice) } : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = (await response.json()) as Record<string, unknown>;
  return openAIMessageToAnthropicContent(extractOpenAIMessage(json), true);
}

function anthropicMessagesToGemini(
  messages: AnthropicMessageRequest["messages"],
  toolNameById: Map<string, string>,
  systemInstruction: string,
  modelName: string,
): GeminiContent[] {
  const contents: GeminiContent[] = [];

  if (shouldInlineSystemPrompt(modelName) && systemInstruction) {
    contents.push({
      role: "user",
      parts: [{ text: `<system>\n${systemInstruction}\n</system>` }],
    });
  }

  for (const message of messages ?? []) {
    const parts = normalizeAnthropicContent(message.content);
    const geminiParts: Array<Record<string, unknown>> = [];

    for (const part of parts) {
      const type = typeof part.type === "string" ? part.type : "";
      if (type === "text" && typeof part.text === "string") {
        geminiParts.push({ text: part.text });
        continue;
      }

      if (type === "tool_use") {
        const id = typeof part.id === "string" ? part.id : `toolu_${randomUUID()}`;
        const name = typeof part.name === "string" ? part.name : "tool";
        const input = isRecord(part.input) ? part.input : {};
        toolNameById.set(id, name);
        geminiParts.push({
          functionCall: {
            id,
            name,
            args: input,
          },
        });
        continue;
      }

      if (type === "tool_result") {
        const toolUseId = typeof part.tool_use_id === "string" ? part.tool_use_id : `toolu_${randomUUID()}`;
        const name = toolNameById.get(toolUseId) ?? "tool";
        geminiParts.push(
          createPartFromFunctionResponse(toolUseId, name, {
            content: extractToolResultText(part.content),
            is_error: Boolean(part.is_error),
          }) as Record<string, unknown>,
        );
      }
    }

    if (geminiParts.length > 0) {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: geminiParts,
      });
    }
  }

  return contents;
}

function anthropicMessagesToOpenAICompatible(
  messages: AnthropicMessageRequest["messages"],
  toolNameById: Map<string, string>,
  systemInstruction: string,
  options: { includeToolNameOnToolMessages: boolean },
) {
  const result: Array<Record<string, unknown>> = [];

  if (systemInstruction) {
    result.push({
      role: "system",
      content: systemInstruction,
    });
  }

  for (const message of messages ?? []) {
    const parts = normalizeAnthropicContent(message.content);
    const textParts: string[] = [];
    const toolMessages: Array<Record<string, unknown>> = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    for (const part of parts) {
      const type = typeof part.type === "string" ? part.type : "";

      if (type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
        continue;
      }

      if (type === "tool_use") {
        const id = typeof part.id === "string" ? part.id : `toolu_${randomUUID()}`;
        const name = typeof part.name === "string" ? part.name : "tool";
        const input = isRecord(part.input) ? part.input : {};
        toolNameById.set(id, name);
        toolCalls.push({
          id,
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(input),
          },
        });
        continue;
      }

      if (type === "tool_result") {
        const toolUseId = typeof part.tool_use_id === "string" ? part.tool_use_id : `toolu_${randomUUID()}`;
        const toolName = toolNameById.get(toolUseId) ?? "tool";
        toolMessages.push({
          role: "tool",
          tool_call_id: toolUseId,
          ...(options.includeToolNameOnToolMessages ? { tool_name: toolName } : {}),
          content: extractToolResultText(part.content),
        });
      }
    }

    if (message.role === "assistant") {
      if (textParts.length > 0 || toolCalls.length > 0) {
        result.push({
          role: "assistant",
          content: textParts.join("\n") || "",
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }
      continue;
    }

    if (textParts.length > 0) {
      result.push({
        role: "user",
        content: textParts.join("\n"),
      });
    }

    result.push(...toolMessages);
  }

  return result;
}

function anthropicToolsToGemini(tools: Array<Record<string, unknown>>) {
  return tools
    .map((tool) => {
      const name = typeof tool.name === "string" ? tool.name : null;
      if (!name) {
        return null;
      }

      return {
        name,
        description: typeof tool.description === "string" ? tool.description : "",
        parametersJsonSchema: isRecord(tool.input_schema) ? tool.input_schema : { type: "object", properties: {} },
      };
    })
    .filter((tool): tool is { name: string; description: string; parametersJsonSchema: Record<string, unknown> } => tool !== null);
}

function anthropicToolsToOpenAITools(tools: Array<Record<string, unknown>>) {
  return tools
    .map((tool) => {
      const name = typeof tool.name === "string" ? tool.name : null;
      if (!name) {
        return null;
      }

      return {
        type: "function",
        function: {
          name,
          description: typeof tool.description === "string" ? tool.description : "",
          parameters: isRecord(tool.input_schema) ? tool.input_schema : { type: "object", properties: {} },
        },
      };
    })
    .filter(
      (
        tool,
      ): tool is {
        type: "function";
        function: { name: string; description: string; parameters: Record<string, unknown> };
      } => tool !== null,
    );
}

function compactOpenAICompatibleRequest(
  systemInstruction: string,
  messages: Array<Record<string, unknown>>,
  tools: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>,
  provider: "openai" | "groq" | "copilot" | "zai",
) {
  const budget = provider === "copilot" ? 6000 : provider === "openai" ? 12000 : 20000;
  let compactMessages = trimOpenAICompatibleMessages(messages, provider);
  let compactTools = compactOpenAICompatibleTools(tools, provider, "normal");

  while (estimateOpenAICompatiblePayload(systemInstruction, compactMessages, compactTools) > budget && compactMessages.length > 4) {
    compactMessages = compactMessages.slice(1);
  }

  if (estimateOpenAICompatiblePayload(systemInstruction, compactMessages, compactTools) > budget && compactTools.length > 12) {
    compactTools = compactTools.slice(0, 12);
  }

  if (estimateOpenAICompatiblePayload(systemInstruction, compactMessages, compactTools) > budget && compactTools.length > 6) {
    compactTools = compactTools.slice(0, 6);
  }

  if (provider === "copilot" && estimateOpenAICompatiblePayload(systemInstruction, compactMessages, compactTools) > budget) {
    compactTools = compactOpenAICompatibleTools(compactTools, provider, "minimal");
  }

  while (provider === "copilot" && estimateOpenAICompatiblePayload(systemInstruction, compactMessages, compactTools) > budget && compactMessages.length > 2) {
    compactMessages = compactMessages.slice(1);
  }

  while (provider === "copilot" && estimateOpenAICompatiblePayload(systemInstruction, compactMessages, compactTools) > budget && compactTools.length > 2) {
    compactTools = compactTools.slice(0, Math.max(2, compactTools.length - 2));
  }

  return {
    messages: compactMessages,
    tools: compactTools,
  };
}

function compactOpenAIResponsesRequest(
  instructions: string,
  input: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
) {
  const budget = 12000;
  let compactInput = [...input];
  let compactTools = [...tools];

  while (estimateOpenAIResponsesPayload(instructions, compactInput, compactTools) > budget && compactInput.length > 4) {
    compactInput = compactInput.slice(1);
  }

  if (estimateOpenAIResponsesPayload(instructions, compactInput, compactTools) > budget && compactTools.length > 12) {
    compactTools = compactTools.slice(0, 12);
  }

  if (estimateOpenAIResponsesPayload(instructions, compactInput, compactTools) > budget && compactTools.length > 6) {
    compactTools = compactTools.slice(0, 6);
  }

  return {
    instructions,
    input: compactInput,
    tools: compactTools,
  };
}

function trimOpenAICompatibleMessages(
  messages: Array<Record<string, unknown>>,
  provider: "openai" | "groq" | "copilot" | "zai",
): Array<Record<string, unknown>> {
  if (provider !== "copilot") {
    return [...messages];
  }

  return messages
    .slice(-4)
    .map((message) => {
      const role = typeof message.role === "string" ? message.role : "user";
      const content = typeof message.content === "string" ? message.content : "";
      const trimmedContent =
        role === "system"
          ? content.slice(-700)
          : role === "tool"
            ? content.slice(-400)
            : content.slice(-900);

      return {
        ...message,
        ...(typeof message.content === "string" ? { content: trimmedContent } : {}),
      };
    });
}

function compactOpenAICompatibleTools(
  tools: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>,
  provider: "openai" | "groq" | "copilot" | "zai",
  mode: "normal" | "minimal",
) {
  return tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      description:
        mode === "minimal"
          ? ""
          : tool.function.description.slice(0, provider === "copilot" ? 48 : 160),
      parameters:
        provider === "copilot" && mode === "minimal"
          ? {
              type: "object",
              additionalProperties: true,
            }
          : tool.function.parameters,
    },
  }));
}

function estimateOpenAICompatiblePayload(
  systemInstruction: string,
  messages: Array<Record<string, unknown>>,
  tools: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>,
): number {
  return Math.ceil(
    JSON.stringify({
      systemInstruction,
      messages,
      tools,
    }).length / 4,
  );
}

function estimateOpenAIResponsesPayload(
  instructions: string,
  input: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
): number {
  return Math.ceil(
    JSON.stringify({
      instructions,
      input,
      tools,
    }).length / 4,
  );
}

function buildGeminiFunctionCallingConfig(
  toolChoice: AnthropicMessageRequest["tool_choice"],
  toolNames: string[],
) {
  if (!toolChoice || toolChoice.type === "auto") {
    return { mode: FunctionCallingConfigMode.AUTO };
  }
  if (toolChoice.type === "none") {
    return { mode: FunctionCallingConfigMode.NONE };
  }
  if (toolChoice.type === "tool" && toolChoice.name) {
    return {
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: [toolChoice.name],
    };
  }
  return {
    mode: FunctionCallingConfigMode.ANY,
    ...(toolNames.length > 0 ? { allowedFunctionNames: toolNames } : {}),
  };
}

function buildOpenAIToolChoice(toolChoice: AnthropicMessageRequest["tool_choice"]) {
  if (!toolChoice || toolChoice.type === "auto") {
    return "auto";
  }
  if (toolChoice.type === "none") {
    return "none";
  }
  if (toolChoice.type === "tool" && toolChoice.name) {
    return {
      type: "function",
      function: {
        name: toolChoice.name,
      },
    };
  }
  return "required";
}

function buildResponsesToolChoice(
  toolChoice: AnthropicMessageRequest["tool_choice"],
  tools: Array<Record<string, unknown>>,
) {
  if (!toolChoice || toolChoice.type === "auto") {
    return "auto";
  }

  if (toolChoice.type === "none" || tools.length === 0) {
    return "none";
  }

  if (toolChoice.type === "tool" && toolChoice.name) {
    return "required";
  }

  return "required";
}

function normalizeSystemPrompt(system: AnthropicMessageRequest["system"]): string {
  if (typeof system === "string") {
    return system;
  }
  if (!Array.isArray(system)) {
    return "";
  }

  return system
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function shouldInlineSystemPrompt(modelName: string): boolean {
  return modelName.trim().toLowerCase().startsWith("gemma");
}

function normalizeAnthropicContent(content: string | Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return Array.isArray(content) ? content : [];
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
      .filter((text) => text.length > 0)
      .join("\n");
  }

  if (isRecord(content)) {
    return JSON.stringify(content);
  }

  return "";
}

function geminiPartsToAnthropicContent(parts: Array<Record<string, unknown>>): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];

  for (const part of parts) {
    if (typeof part.text === "string" && part.text.length > 0) {
      blocks.push({
        type: "text",
        text: part.text,
        citations: null,
      });
    }

    if (isRecord(part.functionCall)) {
      const id = typeof part.functionCall.id === "string" ? part.functionCall.id : `toolu_${randomUUID()}`;
      const name = typeof part.functionCall.name === "string" ? part.functionCall.name : "tool";
      const input = isRecord(part.functionCall.args) ? part.functionCall.args : {};
      blocks.push({
        type: "tool_use",
        id,
        name,
        input,
      });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text: "", citations: null }];
}

function openAIMessageToAnthropicContent(message: Record<string, unknown> | null, parseJsonArguments: boolean): AnthropicContentBlock[] {
  if (!message) {
    return [{ type: "text", text: "", citations: null }];
  }

  const blocks: AnthropicContentBlock[] = [];
  const content = typeof message.content === "string" ? message.content : "";
  if (content.length > 0) {
    blocks.push({
      type: "text",
      text: content,
      citations: null,
    });
  }

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const rawToolCall of rawToolCalls) {
    if (!isRecord(rawToolCall)) {
      continue;
    }

    const id = typeof rawToolCall.id === "string" ? rawToolCall.id : `toolu_${randomUUID()}`;
    const fn = isRecord(rawToolCall.function) ? rawToolCall.function : {};
    const name = typeof fn.name === "string" ? fn.name : "tool";
    let input: Record<string, unknown> = {};
    if (parseJsonArguments && typeof fn.arguments === "string" && fn.arguments.trim().length > 0) {
      try {
        const parsed = JSON.parse(fn.arguments);
        input = isRecord(parsed) ? parsed : {};
      } catch {
        input = {};
      }
    }

    blocks.push({
      type: "tool_use",
      id,
      name,
      input,
    });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text: "", citations: null }];
}

function extractOpenAIMessage(payload: Record<string, unknown>): Record<string, unknown> | null {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!isRecord(first)) {
    return null;
  }
  return isRecord(first.message) ? first.message : null;
}

function ollamaMessageToAnthropicContent(message: unknown): AnthropicContentBlock[] {
  if (!isRecord(message)) {
    return [{ type: "text", text: "", citations: null }];
  }

  const blocks: AnthropicContentBlock[] = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    blocks.push({
      type: "text",
      text: message.content,
      citations: null,
    });
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const rawCall of toolCalls) {
    if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
      continue;
    }

    const name = typeof rawCall.function.name === "string" ? rawCall.function.name : "tool";
    const input = isRecord(rawCall.function.arguments) ? rawCall.function.arguments : {};
    blocks.push({
      type: "tool_use",
      id: `toolu_${randomUUID()}`,
      name,
      input,
    });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text: "", citations: null }];
}

function estimateInputTokens(body: AnthropicMessageRequest): number {
  const raw = JSON.stringify(body.messages ?? []).length + normalizeSystemPrompt(body.system).length;
  return Math.max(1, Math.ceil(raw / 4));
}

function estimateOutputTokens(content: AnthropicContentBlock[]): number {
  const raw = content
    .map((block) => (block.type === "text" ? block.text : JSON.stringify(block.input)))
    .join("\n").length;
  return Math.max(1, Math.ceil(raw / 4));
}

function sendMessageStream(
  res: ServerResponse,
  payload: { requestId: string; message: AnthropicMessageResponse },
) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("request-id", payload.requestId);

  const startMessage: AnthropicMessageResponse = {
    ...payload.message,
    content: [],
    stop_reason: null as never,
    stop_sequence: null,
    usage: {
      ...payload.message.usage,
      output_tokens: 0,
    },
  };

  writeSse(res, "message_start", {
    type: "message_start",
    message: startMessage,
  });

  payload.message.content.forEach((block, index) => {
    if (block.type === "text") {
      writeSse(res, "content_block_start", {
        type: "content_block_start",
        index,
        content_block: {
          type: "text",
          text: "",
          citations: null,
        },
      });
      writeSse(res, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: {
          type: "text_delta",
          text: block.text,
        },
      });
      writeSse(res, "content_block_stop", {
        type: "content_block_stop",
        index,
      });
      return;
    }

    writeSse(res, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: {},
      },
    });
    writeSse(res, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(block.input),
      },
    });
    writeSse(res, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
  });

  writeSse(res, "message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: payload.message.stop_reason,
      stop_sequence: null,
    },
    usage: {
      input_tokens: payload.message.usage.input_tokens,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      output_tokens: payload.message.usage.output_tokens,
      server_tool_use: null,
    },
  });

  writeSse(res, "message_stop", {
    type: "message_stop",
  });
  res.end();
}

function writeSse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? JSON.parse(text) : null;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
