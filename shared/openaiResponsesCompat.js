import { randomUUID } from "node:crypto";

export function openAICompatibleMessagesToResponsesInput(messages) {
  const input = [];

  for (const message of messages ?? []) {
    if (!isRecord(message)) {
      continue;
    }

    const role = typeof message.role === "string" ? message.role : "user";
    const content = typeof message.content === "string" ? message.content : "";

    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: typeof message.tool_call_id === "string" ? message.tool_call_id : `call_${randomUUID()}`,
        output: [{ type: "input_text", text: content }],
      });
      continue;
    }

    if (role === "assistant" && content.length > 0) {
      input.push({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: content }],
      });
    } else if ((role === "user" || role === "developer") && content.length > 0) {
      input.push({
        type: "message",
        role,
        content: [{ type: "input_text", text: content }],
      });
    }

    if (role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (!isRecord(toolCall)) {
          continue;
        }

        const fn = isRecord(toolCall.function) ? toolCall.function : {};
        input.push({
          type: "function_call",
          call_id: typeof toolCall.id === "string" ? toolCall.id : `call_${randomUUID()}`,
          name: typeof fn.name === "string" ? fn.name : "tool",
          arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
        });
      }
    }
  }

  return input;
}

export function findLatestResponsesContinuation(messages, responseIdByCallId) {
  const sourceMessages = Array.isArray(messages) ? messages : [];

  for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
    const message = sourceMessages[index];
    if (!isRecord(message) || !Array.isArray(message.content)) {
      continue;
    }

    const toolResultIds = message.content
      .filter((part) => isRecord(part) && part.type === "tool_result" && typeof part.tool_use_id === "string")
      .map((part) => part.tool_use_id);

    if (toolResultIds.length === 0) {
      continue;
    }

    const previousResponseId = toolResultIds
      .map((toolResultId) => responseIdByCallId.get(toolResultId))
      .find((responseId) => typeof responseId === "string" && responseId.length > 0);

    if (!previousResponseId) {
      return {
        previousResponseId: null,
        messages: sourceMessages,
      };
    }

    return {
      previousResponseId,
      messages: sourceMessages.slice(index),
    };
  }

  return {
    previousResponseId: null,
    messages: sourceMessages,
  };
}

export function sliceResponsesInputToLatestToolTurn(input) {
  const items = Array.isArray(input) ? input : [];
  let trailingOutputStart = -1;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isRecord(item) && item.type === "function_call_output" && typeof item.call_id === "string") {
      trailingOutputStart = index;
      continue;
    }

    if (trailingOutputStart !== -1) {
      break;
    }
  }

  if (trailingOutputStart === -1) {
    return items;
  }

  const trailingCallIds = new Set(
    items
      .slice(trailingOutputStart)
      .filter((item) => isRecord(item) && item.type === "function_call_output" && typeof item.call_id === "string")
      .map((item) => item.call_id),
  );

  let startIndex = trailingOutputStart;
  for (let index = trailingOutputStart - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "function_call" && typeof item.call_id === "string" && trailingCallIds.has(item.call_id)) {
      startIndex = index;
      continue;
    }

    if (item.type === "message") {
      startIndex = index;
      break;
    }
  }

  return items.slice(startIndex);
}

export function openAICompatibleToolsToResponsesTools(tools) {
  return (tools ?? [])
    .map((tool) => {
      if (!isRecord(tool) || tool.type !== "function" || !isRecord(tool.function)) {
        return null;
      }

      return {
        type: "function",
        name: typeof tool.function.name === "string" ? tool.function.name : "tool",
        description: typeof tool.function.description === "string" ? tool.function.description : "",
        parameters: isRecord(tool.function.parameters) ? tool.function.parameters : { type: "object", properties: {} },
        strict: false,
      };
    })
    .filter((tool) => tool !== null);
}

export function parseResponsesSseToAnthropicContent(sseText) {
  return parseResponsesSseToResult(sseText).content;
}

export function parseResponsesSseToResult(sseText) {
  const blocks = [];
  const toolCallIds = [];
  const textByMessageId = new Map();
  let responseId = null;

  for (const event of parseSseJsonEvents(sseText)) {
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "response.output_text.delta") {
      const itemId = typeof event.item_id === "string" ? event.item_id : `msg_${randomUUID()}`;
      const delta = typeof event.delta === "string" ? event.delta : "";
      textByMessageId.set(itemId, (textByMessageId.get(itemId) ?? "") + delta);
      continue;
    }

    if (type === "response.completed" && isRecord(event.response) && typeof event.response.id === "string") {
      responseId = event.response.id;
      continue;
    }

    if (type !== "response.output_item.done" || !isRecord(event.item)) {
      continue;
    }

    const item = event.item;
    const itemType = typeof item.type === "string" ? item.type : "";

    if (itemType === "message" && item.role === "assistant") {
      const content = Array.isArray(item.content) ? item.content : [];
      const text = content
        .map((part) =>
          isRecord(part) && part.type === "output_text" && typeof part.text === "string" ? part.text : "",
        )
        .filter(Boolean)
        .join("");
      const fallbackText =
        text.length > 0 ? text : typeof item.id === "string" ? (textByMessageId.get(item.id) ?? "") : "";

      if (fallbackText.length > 0) {
        blocks.push({
          type: "text",
          text: fallbackText,
          citations: null,
        });
      }
      continue;
    }

    if (itemType === "function_call") {
      let input = {};
      if (typeof item.arguments === "string" && item.arguments.trim().length > 0) {
        try {
          const parsed = JSON.parse(item.arguments);
          input = isRecord(parsed) ? parsed : {};
        } catch {
          input = {};
        }
      }

      blocks.push({
        type: "tool_use",
        id: typeof item.call_id === "string" ? item.call_id : `toolu_${randomUUID()}`,
        name: typeof item.name === "string" ? item.name : "tool",
        input,
      });
      if (typeof item.call_id === "string") {
        toolCallIds.push(item.call_id);
      }
      continue;
    }

  }

  return {
    responseId,
    toolCallIds,
    content: blocks.length > 0 ? blocks : [{ type: "text", text: "", citations: null }],
  };
}

function parseSseJsonEvents(sseText) {
  return (sseText ?? "")
    .split(/\n\n+/)
    .map((chunk) => {
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      if (dataLines.length === 0) {
        return null;
      }

      try {
        return JSON.parse(dataLines.join("\n"));
      } catch {
        return null;
      }
    })
    .filter((event) => event !== null);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
