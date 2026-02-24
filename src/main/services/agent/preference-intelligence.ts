const DIRECTIVE_HINT_PATTERN =
  /\b(prefiro|prefere|quero|gostaria|responda|fale|escreva|seja|mantenha|adote)\b/;

const LANGUAGE_RULES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\b(?:em|in)\s+portugues(?:\s+brasileiro)?\b/, value: 'pt-BR' },
  { pattern: /\b(?:em|in)\s+ingles\b/, value: 'en-US' },
  { pattern: /\b(?:em|in)\s+english\b/, value: 'en-US' },
  { pattern: /\b(?:em|in)\s+espanhol\b/, value: 'es-ES' },
  { pattern: /\b(?:em|in)\s+spanish\b/, value: 'es-ES' }
];

const CONCISE_HINTS = ['respostas curtas', 'resposta curta', 'objetivo', 'direto', 'sem enrolar', 'resuma'];
const DETAILED_HINTS = [
  'detalhado',
  'detalhada',
  'detalhadas',
  'com detalhes',
  'aprofundado',
  'aprofundada',
  'passo a passo',
  'mais completo'
];

const TONE_HINTS: Array<{ hints: string[]; tone: string }> = [
  {
    hints: ['tecnico', 'tecnica', 'tecnicas'],
    tone: 'technical'
  },
  {
    hints: ['didatico', 'didatica', 'didaticas'],
    tone: 'didactic'
  },
  {
    hints: ['casual', 'informal'],
    tone: 'casual'
  }
];

export function buildPreferencePatchFromInput(input: string): Record<string, string> {
  const normalized = normalizeForMatch(input);
  if (!normalized || !DIRECTIVE_HINT_PATTERN.test(normalized)) {
    return {};
  }

  const patch: Record<string, string> = {};

  const language = resolveLanguage(normalized);
  if (language) {
    patch.response_language = language;
  }

  const verbosity = resolveVerbosity(normalized);
  if (verbosity) {
    patch.response_verbosity = verbosity;
  }

  const tone = resolveTone(normalized);
  if (tone) {
    patch.response_tone = tone;
  }

  return patch;
}

function resolveLanguage(normalized: string): string | null {
  for (const rule of LANGUAGE_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.value;
    }
  }

  return null;
}

function resolveVerbosity(normalized: string): string | null {
  const conciseIndex = findLastMentionIndex(normalized, CONCISE_HINTS);
  const detailedIndex = findLastMentionIndex(normalized, DETAILED_HINTS);

  if (conciseIndex === -1 && detailedIndex === -1) {
    return null;
  }

  return detailedIndex > conciseIndex ? 'detailed' : 'concise';
}

function resolveTone(normalized: string): string | null {
  let winner: string | null = null;
  let winnerIndex = -1;

  for (const entry of TONE_HINTS) {
    const index = findLastMentionIndex(normalized, entry.hints);
    if (index > winnerIndex) {
      winnerIndex = index;
      winner = entry.tone;
    }
  }

  return winner;
}

function findLastMentionIndex(input: string, hints: string[]): number {
  let winner = -1;

  for (const hint of hints) {
    const index = input.lastIndexOf(hint);
    if (index > winner) {
      winner = index;
    }
  }

  return winner;
}

function normalizeForMatch(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
