import type { LongTermMemory } from '@shared/contracts';
import type { EnvironmentSnapshot } from '@main/services/environment/environment-context';

export const DEXTER_ASSISTANT_NAME = 'Dexter';

const PROFILE_KEY_ASSISTANT = 'assistant_name';
const PROFILE_KEY_LOCAL_USER = 'local_username';
const PROFILE_KEY_LOCAL_HOST = 'local_hostname';
const PROFILE_KEY_USER_NAME = 'user_display_name';
const PROFILE_KEY_INSTALL_MODE = 'install_mode';
const PROFILE_KEY_EXEC_PATH = 'app_exec_path';
const PROFILE_KEY_RESOURCES_PATH = 'app_resources_path';

const NAME_PATTERNS = [
  /\bmeu nome\s*e\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{0,60})/i,
  /\bmeu nome\s*é\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{0,60})/i,
  /\bme chamo\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{0,60})/i,
  /\bpode me chamar de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{0,60})/i,
  /\bmy name is\s+([A-Za-z][A-Za-z' -]{0,60})/i,
  /\bcall me\s+([A-Za-z][A-Za-z' -]{0,60})/i
];

export function buildIdentityProfilePatch(snapshot: EnvironmentSnapshot, userInput: string): Record<string, string> {
  const patch: Record<string, string> = {
    [PROFILE_KEY_ASSISTANT]: DEXTER_ASSISTANT_NAME
  };

  if (snapshot.username && snapshot.username !== 'desconhecido') {
    patch[PROFILE_KEY_LOCAL_USER] = snapshot.username;
  }

  if (snapshot.hostname) {
    patch[PROFILE_KEY_LOCAL_HOST] = snapshot.hostname;
  }

  patch[PROFILE_KEY_INSTALL_MODE] = snapshot.installMode;
  patch[PROFILE_KEY_EXEC_PATH] = snapshot.execPath;

  if (snapshot.resourcesPath) {
    patch[PROFILE_KEY_RESOURCES_PATH] = snapshot.resourcesPath;
  }

  const preferredName = extractPreferredUserName(userInput);
  if (preferredName) {
    patch[PROFILE_KEY_USER_NAME] = preferredName;
  }

  return patch;
}

export function buildIdentityContext(snapshot: EnvironmentSnapshot, longMemory: LongTermMemory): string {
  const rememberedUserName = readRememberedUserName(longMemory) ?? 'nao definido';
  const installMode = formatInstallMode(snapshot.installMode);

  return [
    `Assistente: ${DEXTER_ASSISTANT_NAME}`,
    `Usuario local detectado: ${snapshot.username}`,
    `Usuario lembrado: ${rememberedUserName}`,
    `Host local: ${snapshot.hostname}`,
    `Modo de instalacao: ${installMode}`,
    `Executavel: ${snapshot.execPath}`,
    `Recursos: ${snapshot.resourcesPath ?? 'n/d'}`
  ].join('\n');
}

export function buildSafetyProtocolContext(): string {
  return [
    '1) Nao alegue que executou comandos, alterou arquivos ou aplicou configuracoes se isso nao ocorreu.',
    '2) Trate leitura e diagnostico como escopo padrao; escrita/exclusao/sobrescrita exigem pedido explicito.',
    '3) Para acoes sensiveis, descreva risco, confirme intencao e respeite as politicas de permissao do Dexter.',
    '4) Se faltar contexto ou permissao, responda com limites claros e proximo passo seguro.'
  ].join('\n');
}

export function readRememberedUserName(longMemory: LongTermMemory): string | null {
  const preferred = normalizeName(longMemory.profile[PROFILE_KEY_USER_NAME] ?? '');
  if (preferred) {
    return preferred;
  }

  const localUsername = normalizeName(longMemory.profile[PROFILE_KEY_LOCAL_USER] ?? '');
  if (localUsername) {
    return localUsername;
  }

  return null;
}

export function extractPreferredUserName(input: string): string | null {
  const normalizedInput = input.trim();
  if (!normalizedInput) {
    return null;
  }

  for (const pattern of NAME_PATTERNS) {
    const match = normalizedInput.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const normalized = normalizeName(match[1]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function buildPreferredUserNamePatch(input: string): Record<string, string> | null {
  const normalized = normalizeName(input);
  if (!normalized) {
    return null;
  }

  return {
    [PROFILE_KEY_USER_NAME]: normalized
  };
}

function normalizeName(raw: string): string | null {
  const cleaned = raw
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 60) {
    return null;
  }

  if (/\d/.test(cleaned)) {
    return null;
  }

  const words = cleaned.split(' ');
  if (words.length > 4) {
    return null;
  }

  return words.map(capitalize).join(' ');
}

function capitalize(word: string): string {
  if (!word) {
    return word;
  }

  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

function formatInstallMode(mode: EnvironmentSnapshot['installMode']): string {
  if (mode === 'packaged') {
    return 'empacotado';
  }

  if (mode === 'development') {
    return 'desenvolvimento';
  }

  return 'desconhecido';
}
