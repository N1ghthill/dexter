import { describe, expect, it } from 'vitest';
import { buildPreferencePatchFromInput } from '@main/services/agent/preference-intelligence';

describe('preference-intelligence', () => {
  it('extrai linguagem, verbosidade e tom a partir de instrucoes explicitas', () => {
    const patch = buildPreferencePatchFromInput('Quero respostas curtas e em ingles, com tom tecnico.');

    expect(patch).toEqual({
      response_language: 'en-US',
      response_verbosity: 'concise',
      response_tone: 'technical'
    });
  });

  it('prioriza a preferencia mais recente quando ha conflito no texto', () => {
    const patch = buildPreferencePatchFromInput('Responda detalhado no inicio, depois seja direto e sem enrolar.');
    expect(patch.response_verbosity).toBe('concise');
  });

  it('ignora texto sem pedido de preferencia explicito', () => {
    const patch = buildPreferencePatchFromInput('Hoje eu li uma documentacao em ingles sobre linux.');
    expect(patch).toEqual({});
  });
});
