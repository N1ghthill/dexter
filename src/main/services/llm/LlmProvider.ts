import type { ChatTurn, DexterConfig, LongTermMemory } from '@shared/contracts';

export interface GenerateInput {
  config: DexterConfig;
  shortContext: ChatTurn[];
  longContext: LongTermMemory;
  userInput: string;
}

export interface LlmProvider {
  generate(input: GenerateInput): Promise<string>;
}
