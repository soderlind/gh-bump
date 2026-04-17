/**
 * Provider-agnostic LLM wrapper using Vercel AI SDK.
 */

import { generateText, type LanguageModel, type ToolSet } from "ai";
import type { AiProvider } from "./types.js";
import * as log from "./log.js";

export interface LlmCallOptions {
  system: string;
  prompt: string;
  tools?: ToolSet;
  maxToolRoundtrips?: number;
}

export interface LlmClient {
  call(options: LlmCallOptions): Promise<string>;
}

/**
 * Create an LLM model instance for the given provider.
 */
async function createModel(
  provider: AiProvider,
  apiKey: string,
  modelName?: string
): Promise<LanguageModel> {
  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const client = createOpenAI({ apiKey });
      return client.chat(modelName ?? "gpt-4o");
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const client = createAnthropic({ apiKey });
      return client(modelName ?? "claude-sonnet-4-20250514");
    }
    case "github": {
      // GitHub Models: OpenAI-compatible endpoint using GitHub token
      const { createOpenAI } = await import("@ai-sdk/openai");
      const client = createOpenAI({
        apiKey,
        baseURL: "https://models.inference.ai.azure.com",
      });
      return client.chat(modelName ?? "gpt-4o");
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Create a provider-agnostic LLM client.
 */
export async function createLlmClient(
  provider: AiProvider,
  apiKey: string,
  modelName?: string
): Promise<LlmClient> {
  const model = await createModel(provider, apiKey, modelName);

  return {
    async call(options: LlmCallOptions): Promise<string> {
      log.debug(`LLM call: ${options.prompt.slice(0, 100)}...`);

      const result = await generateText({
        model,
        system: options.system,
        prompt: options.prompt,
        tools: options.tools,
      });

      log.debug(
        `LLM response: ${result.text.slice(0, 100)}... (${result.usage?.totalTokens ?? "?"} tokens)`
      );

      return result.text;
    },
  };
}
