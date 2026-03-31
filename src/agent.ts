import { AnthropicProvider, GeminiProvider, type LlmProvider, type ProviderName } from "./providers.js";

export type AgentTurnResult = {
  text: string;
};

export class CodingAgent {
  private readonly provider: LlmProvider;

  constructor(args: { provider: ProviderName; apiKey: string; model: string; cwd: string }) {
    if (args.provider === "gemini") {
      this.provider = new GeminiProvider({
        apiKey: args.apiKey,
        model: args.model,
        cwd: args.cwd,
      });
      return;
    }

    this.provider = new AnthropicProvider({
      apiKey: args.apiKey,
      model: args.model,
      cwd: args.cwd,
    });
  }

  clear(): void {
    this.provider.clear();
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    return this.provider.runTurn(prompt);
  }
}
