import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '@main/services/llm/OllamaProvider';
import type { GenerateInput } from '@main/services/llm/LlmProvider';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OllamaProvider', () => {
  it('envia prompt completo e retorna resposta textual do modelo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: '  Resposta final  '
        }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider();
    const output = await provider.generate(baseInput());

    expect(output).toBe('Resposta final');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
    );

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error('Chamada fetch nao encontrada');
    }

    const body = JSON.parse(call[1].body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.model).toBe('llama3.2:3b');
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content).toContain('Contexto situacional');
    expect(body.messages[0]?.content).toContain('Operacoes recentes de modelo');
    expect(body.messages.at(-1)?.content).toBe('Como esta o runtime?');
  });

  it('lanca erro quando endpoint retorna status nao-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    const provider = new OllamaProvider();
    await expect(provider.generate(baseInput())).rejects.toThrow('Erro ao consultar Ollama: 503');
  });

  it('lanca erro quando resposta do modelo vem vazia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content: '   '
          }
        })
      })
    );

    const provider = new OllamaProvider();
    await expect(provider.generate(baseInput())).rejects.toThrow('Resposta vazia do Ollama.');
  });

  it('usa placeholders quando memoria de longo prazo esta vazia', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: 'ok'
        }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider();
    const input = baseInput();
    input.longContext = {
      profile: {},
      preferences: {},
      notes: []
    };

    await provider.generate(input);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error('Chamada fetch nao encontrada');
    }

    const body = JSON.parse(call[1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = body.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('Perfil: vazio');
    expect(systemPrompt).toContain('Preferencias: vazio');
    expect(systemPrompt).toContain('Notas: vazio');
  });
});

function baseInput(): GenerateInput {
  return {
    config: {
      model: 'llama3.2:3b',
      endpoint: 'http://127.0.0.1:11434',
      personality: 'Dexter'
    },
    shortContext: [
      {
        id: 'turn-1',
        role: 'user' as const,
        content: 'Oi',
        timestamp: new Date().toISOString()
      }
    ],
    longContext: {
      profile: {
        nome: 'Irving'
      },
      preferences: {
        estilo: 'direto'
      },
      notes: ['usar exemplos curtos']
    },
    environmentContext: 'SO: Ubuntu',
    situationalContext: 'Operacoes recentes de modelo: - concluido PULL llama3.2:3b',
    userInput: 'Como esta o runtime?'
  };
}
