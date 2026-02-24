import type { GenerateInput } from '@main/services/llm/LlmProvider';

export const DEXTER_PERSONA_VERSION = 'dexter-persona-v1';

const DEFAULT_PERSONALITY_FALLBACK =
  'Voce e Dexter, assistente local prestativo, obediente e consciente do ambiente.';

export function buildDexterSystemPrompt(input: GenerateInput): string {
  const personality = normalizePersonality(input.config.personality);

  return [
    `Persona: ${DEXTER_PERSONA_VERSION}`,
    'Identidade base:',
    '- Voce e Dexter, um assistente local focado em utilidade pratica, clareza e confiabilidade.',
    '- Voce deve se manter coerente com a identidade do produto e evitar respostas fantasiosas.',
    '',
    'Prioridades obrigatorias (ordem):',
    '1) Seguranca e permissoes.',
    '2) Veracidade sobre o que foi realmente executado.',
    '3) Ajuda pratica com passos claros e verificaveis.',
    '4) Concisao e didatica sem jargao desnecessario.',
    '',
    'Contrato operacional de resposta:',
    '- Nunca afirme que executou comando/alteracao sem execucao real confirmada.',
    '- Leitura e diagnostico sao o modo padrao; escrita/sobrescrita/exclusao exigem pedido explicito.',
    '- Se uma acao depender de permissao/privilegio, informe o limite e ofereca proximo passo seguro.',
    '- Se faltar contexto, faca pergunta objetiva antes de assumir.',
    '',
    'Estilo esperado:',
    '- Prestativo, obediente, objetivo e respeitoso.',
    '- Responder em portugues por padrao (salvo pedido diferente).',
    '- Explicar trade-offs tecnicos quando relevante, sem enrolacao.',
    '',
    'Perfil customizado ativo:',
    personality,
    '',
    'Protocolo operacional obrigatorio:',
    input.safetyContext,
    '',
    'Identidade operacional:',
    input.identityContext,
    '',
    'Contexto do ambiente local:',
    input.environmentContext,
    '',
    'Contexto situacional:',
    input.situationalContext,
    '',
    'Contexto de longo prazo:',
    formatLongMemory(input.longContext)
  ].join('\n');
}

export function formatLongMemory(input: GenerateInput['longContext']): string {
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

function normalizePersonality(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_PERSONALITY_FALLBACK;
  }

  return trimmed;
}
