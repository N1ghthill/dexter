import type { GenerateInput, LlmProvider } from '@main/services/llm/LlmProvider';
import { buildDexterSystemPrompt } from '@main/services/llm/SystemPromptBuilder';

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaProvider implements LlmProvider {
  async generate(input: GenerateInput): Promise<string> {
    const { config, shortContext, userInput } = input;
    const systemPrompt = buildDexterSystemPrompt(input);

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...shortContext.map((turn) => ({
        role: turn.role,
        content: turn.content
      })),
      {
        role: 'user',
        content: userInput
      }
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(`${config.endpoint}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          messages
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Erro ao consultar Ollama: ${response.status}`);
    }

    const json = (await response.json()) as OllamaChatResponse;
    const content = json.message?.content?.trim();

    if (!content) {
      throw new Error('Resposta vazia do Ollama.');
    }

    return content;
  }
}
