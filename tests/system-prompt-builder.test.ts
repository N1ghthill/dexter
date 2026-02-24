import { describe, expect, it } from 'vitest';
import { buildDexterSystemPrompt, DEXTER_PERSONA_VERSION, formatLongMemory } from '@main/services/llm/SystemPromptBuilder';
import type { GenerateInput } from '@main/services/llm/LlmProvider';

describe('SystemPromptBuilder', () => {
  it('monta Persona v1 com prioridades, contrato e contextos operacionais', () => {
    const prompt = buildDexterSystemPrompt(baseInput());

    expect(prompt).toContain(`Persona: ${DEXTER_PERSONA_VERSION}`);
    expect(prompt).toContain('Prioridades obrigatorias (ordem):');
    expect(prompt).toContain('Contrato operacional de resposta:');
    expect(prompt).toContain('Protocolo operacional obrigatorio:');
    expect(prompt).toContain('Identidade operacional:');
    expect(prompt).toContain('Contexto do ambiente local:');
    expect(prompt).toContain('Contexto situacional:');
    expect(prompt).toContain('Perfil customizado ativo:');
  });

  it('usa fallback de personalidade quando configuracao vem vazia', () => {
    const input = baseInput();
    input.config.personality = '   ';

    const prompt = buildDexterSystemPrompt(input);
    expect(prompt).toContain('assistente local prestativo, obediente e consciente do ambiente');
  });

  it('formata memoria longa com placeholders quando vazia', () => {
    const formatted = formatLongMemory({
      profile: {},
      preferences: {},
      notes: []
    });

    expect(formatted).toContain('Perfil: vazio');
    expect(formatted).toContain('Preferencias: vazio');
    expect(formatted).toContain('Notas: vazio');
  });
});

function baseInput(): GenerateInput {
  return {
    config: {
      model: 'qwen2.5:0.5b',
      endpoint: 'http://127.0.0.1:11434',
      personality: 'Seja sagaz, pragmatico e objetivo.'
    },
    shortContext: [],
    longContext: {
      profile: {
        user_display_name: 'Irving'
      },
      preferences: {
        estilo: 'direto'
      },
      notes: ['prefere respostas tecnicas curtas']
    },
    identityContext: 'Assistente: Dexter\nUsuario local detectado: irving',
    safetyContext: 'Nao alegue que executou comandos sem execucao real.',
    environmentContext: 'SO: Ubuntu 24.04',
    situationalContext: 'Operacoes recentes de modelo: nenhuma operacao registrada.',
    userInput: 'Como esta meu ambiente?'
  };
}
