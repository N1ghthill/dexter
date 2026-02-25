import { describe, expect, it } from 'vitest';
import { tryBuildTemporalDeterministicReply } from '@main/services/agent/temporal-intelligence';

describe('temporal-intelligence', () => {
  it('responde hora atual com referencia temporal completa', () => {
    const reply = tryBuildTemporalDeterministicReply({
      input: 'Que horas sao agora?',
      now: new Date('2026-02-25T00:51:12.000Z'),
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo'
    });

    expect(reply).toContain('No momento, sao');
    expect(reply).toContain('America/Sao_Paulo');
    expect(reply).toContain('24 de fevereiro de 2026');
  });

  it('calcula dias restantes para o fim do ano sem depender da LLM', () => {
    const reply = tryBuildTemporalDeterministicReply({
      input: 'Quantos dias restam para acabar esse ano?',
      now: new Date('2026-02-24T23:52:00.000Z'),
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo'
    });

    expect(reply).toContain('faltam 310 dias');
    expect(reply).toContain('31 de dezembro de 2026');
  });

  it('retorna null quando a pergunta nao e temporal', () => {
    const reply = tryBuildTemporalDeterministicReply({
      input: 'Explique como funciona o /health'
    });

    expect(reply).toBeNull();
  });
});
