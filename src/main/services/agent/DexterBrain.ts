import type { ChatReply, ChatRequest, ChatTurn } from '@shared/contracts';
import { ConversationContextBuilder } from '@main/services/agent/ConversationContextBuilder';
import { CommandRouter } from '@main/services/commands/CommandRouter';
import { ConfigStore } from '@main/services/config/ConfigStore';
import type { LlmProvider } from '@main/services/llm/LlmProvider';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';

export class DexterBrain {
  constructor(
    private readonly commandRouter: CommandRouter,
    private readonly configStore: ConfigStore,
    private readonly memoryStore: MemoryStore,
    private readonly contextBuilder: ConversationContextBuilder,
    private readonly llmProvider: LlmProvider,
    private readonly logger: Logger
  ) {}

  async respond(request: ChatRequest): Promise<ChatReply> {
    const { sessionId, input } = request;

    const commandReply = await this.commandRouter.tryExecute(input, sessionId);
    if (commandReply) {
      this.logger.info('command.executed', { sessionId, input });
      return commandReply;
    }

    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };
    this.memoryStore.pushTurn(sessionId, userTurn);

    try {
      const promptContext = this.contextBuilder.buildForSession(sessionId, input);
      const shortContext = promptContext.shortContext.filter((turn) => turn.id !== userTurn.id);
      const replyText = await this.llmProvider.generate({
        config: this.configStore.get(),
        shortContext,
        longContext: promptContext.longContext,
        identityContext: promptContext.identityContext,
        safetyContext: promptContext.safetyContext,
        awarenessContext: promptContext.awarenessContext,
        environmentContext: promptContext.environmentContext,
        situationalContext: promptContext.situationalContext,
        userInput: input
      });

      const reply: ChatReply = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: replyText,
        timestamp: new Date().toISOString(),
        source: 'llm'
      };

      this.memoryStore.pushTurn(sessionId, {
        id: reply.id,
        role: 'assistant',
        content: reply.content,
        timestamp: reply.timestamp
      });

      this.logger.info('chat.reply', {
        sessionId,
        source: 'llm',
        inputLength: input.length,
        outputLength: reply.content.length
      });

      return reply;
    } catch (error) {
      this.logger.error('chat.reply_error', {
        sessionId,
        reason: error instanceof Error ? error.message : String(error)
      });

      return {
        id: crypto.randomUUID(),
        role: 'assistant',
        timestamp: new Date().toISOString(),
        source: 'fallback',
        content: `Nao consegui falar com o modelo local agora. ${this.contextBuilder.buildFailureHint()}`
      };
    }
  }
}
