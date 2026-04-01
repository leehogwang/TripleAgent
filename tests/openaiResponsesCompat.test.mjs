import test from "node:test";
import assert from "node:assert/strict";

import {
  findLatestResponsesContinuation,
  openAICompatibleMessagesToResponsesInput,
  openAICompatibleToolsToResponsesTools,
  parseResponsesSseToAnthropicContent,
  parseResponsesSseToResult,
  sliceResponsesInputToLatestToolTurn,
} from "../shared/openaiResponsesCompat.js";

test("openAICompatibleMessagesToResponsesInput converts assistant tool history", () => {
  const input = openAICompatibleMessagesToResponsesInput([
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: "calling tool",
      tool_calls: [{ id: "call-1", function: { name: "weather", arguments: "{\"city\":\"Seoul\"}" } }],
    },
    { role: "tool", tool_call_id: "call-1", content: "sunny" },
  ]);

  assert.deepEqual(input, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "calling tool" }] },
    { type: "function_call", call_id: "call-1", name: "weather", arguments: "{\"city\":\"Seoul\"}" },
    { type: "function_call_output", call_id: "call-1", output: [{ type: "input_text", text: "sunny" }] },
  ]);
});

test("openAICompatibleToolsToResponsesTools flattens function tools", () => {
  const tools = openAICompatibleToolsToResponsesTools([
    {
      type: "function",
      function: {
        name: "weather",
        description: "Get weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    },
  ]);

  assert.deepEqual(tools, [
    {
      type: "function",
      name: "weather",
      description: "Get weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
      strict: false,
    },
  ]);
});

test("parseResponsesSseToAnthropicContent extracts text and tool calls", () => {
  const sse = [
    "event: response.output_item.done",
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"msg-1","content":[{"type":"output_text","text":"Hello"}]}}',
    "",
    "event: response.output_item.done",
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-1","name":"weather","arguments":"{\\"city\\":\\"Seoul\\"}"}}',
    "",
    "event: response.completed",
    'data: {"type":"response.completed","response":{"id":"resp-1"}}',
    "",
  ].join("\n");

  assert.deepEqual(parseResponsesSseToAnthropicContent(sse), [
    { type: "text", text: "Hello", citations: null },
    { type: "tool_use", id: "call-1", name: "weather", input: { city: "Seoul" } },
  ]);
});

test("parseResponsesSseToResult preserves response id and tool call ids", () => {
  const sse = [
    "event: response.output_item.done",
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-1","name":"weather","arguments":"{\\"city\\":\\"Seoul\\"}"}}',
    "",
    "event: response.output_item.done",
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-2","name":"time","arguments":"{}"}}',
    "",
    "event: response.completed",
    'data: {"type":"response.completed","response":{"id":"resp-1"}}',
    "",
  ].join("\n");

  assert.deepEqual(parseResponsesSseToResult(sse), {
    responseId: "resp-1",
    toolCallIds: ["call-1", "call-2"],
    content: [
      { type: "tool_use", id: "call-1", name: "weather", input: { city: "Seoul" } },
      { type: "tool_use", id: "call-2", name: "time", input: {} },
    ],
  });
});

test("findLatestResponsesContinuation returns previous response id for latest tool result turn", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Find the weather" }] },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "call-old", name: "search", input: { query: "weather" } },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call-old", content: "sunny" }],
    },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "call-new", name: "time", input: { city: "Seoul" } }],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call-new", content: "13:00" },
        { type: "text", text: "Continue" },
      ],
    },
  ];

  assert.deepEqual(
    findLatestResponsesContinuation(messages, new Map([["call-new", "resp-new"], ["call-old", "resp-old"]])),
    {
      previousResponseId: "resp-new",
      messages: [messages.at(-1)],
    },
  );
});

test("sliceResponsesInputToLatestToolTurn keeps the latest tool loop intact", () => {
  const input = [
    { type: "message", role: "user", content: [{ type: "input_text", text: "Old question" }] },
    { type: "function_call", call_id: "call-old", name: "search", arguments: "{\"q\":\"old\"}" },
    { type: "function_call_output", call_id: "call-old", output: [{ type: "input_text", text: "old result" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "New question" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Calling weather" }] },
    { type: "function_call", call_id: "call-new", name: "weather", arguments: "{\"city\":\"Seoul\"}" },
    { type: "function_call_output", call_id: "call-new", output: [{ type: "input_text", text: "Sunny, 19C" }] },
  ];

  assert.deepEqual(sliceResponsesInputToLatestToolTurn(input), [
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Calling weather" }] },
    { type: "function_call", call_id: "call-new", name: "weather", arguments: "{\"city\":\"Seoul\"}" },
    { type: "function_call_output", call_id: "call-new", output: [{ type: "input_text", text: "Sunny, 19C" }] },
  ]);
});
