export function openAICompatibleMessagesToResponsesInput(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>>;

export function findLatestResponsesContinuation(
  messages: Array<Record<string, unknown>>,
  responseIdByCallId: Map<string, string>,
): {
  previousResponseId: string | null;
  messages: Array<Record<string, unknown>>;
};

export function sliceResponsesInputToLatestToolTurn(
  input: Array<Record<string, unknown>>,
): Array<Record<string, unknown>>;

export function openAICompatibleToolsToResponsesTools(
  tools: Array<Record<string, unknown>>,
): Array<Record<string, unknown>>;

export function parseResponsesSseToAnthropicContent(sseText: string): Array<Record<string, unknown>>;

export function parseResponsesSseToResult(sseText: string): {
  responseId: string | null;
  toolCallIds: string[];
  content: Array<Record<string, unknown>>;
};
