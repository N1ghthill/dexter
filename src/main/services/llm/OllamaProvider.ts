import type { GenerateInput, LlmProvider } from '@main/services/llm/LlmProvider';

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaProvider implements LlmProvider {
  async generate(input: GenerateInput): Promise<string> {
    const { config, shortContext, longContext, identityContext, safetyContext, environmentContext, situationalContext, userInput } =
      input;

    const messages = [
      {
        role: 'system',
        content: [
          'Protocolo operacional obrigatorio:',
          safetyContext,
          'Identidade operacional:',
          identityContext,
          'Personalidade base:',
          config.personality,
          'Contexto do ambiente local:',
          environmentContext,
          'Contexto situacional:',
          situationalContext,
          'Contexto de longo prazo:',
          formatLongMemory(longContext)
        ].join('\n\n')
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

function formatLongMemory(input: GenerateInput['longContext']): string {
  const profile = Object.entries(input.profile)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
  const preferences = Object.entries(input.preferences)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
  const notes = input.notes.join(' | ');

  return [
    profile ? `Perfil: ${profile}` : 'Perfil: vazio',
    preferences ? `Preferencias: ${preferences}` : 'Preferencias: vazio',
    notes ? `Notas: ${notes}` : 'Notas: vazio'
  ].join('\n');
}
