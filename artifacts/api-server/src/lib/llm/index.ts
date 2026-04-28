import type { LLMProvider } from "./types.js";
import { createLLMProviderChain } from "./factory.js";
import { readProviderPriority } from "./env.js";

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (!cached) {
    cached = createLLMProviderChain(readProviderPriority());
  }
  return cached;
}

/** Test-only: reset singleton between tests */
export function resetLLMProviderForTests(): void {
  cached = null;
}

export type { LLMProvider, ChatCompletionParams, ChatMessage } from "./types.js";
export {
  readProviderId,
  type ProviderId,
} from "./env.js";
