import type { LongTermMemory } from '@shared/contracts';
import { readRememberedUserName } from '@main/services/agent/agent-consciousness';
import type { EnvironmentSnapshot } from '@main/services/environment/environment-context';

interface SituationalAwarenessInput {
  snapshot: EnvironmentSnapshot;
  longMemory: LongTermMemory;
  now?: Date;
  locale?: string;
  timeZone?: string;
  workingDirectory?: string;
}

export function buildSituationalAwarenessContext(input: SituationalAwarenessInput): string {
  const now = input.now ?? new Date();
  const locale = input.locale ?? 'pt-BR';
  const timeZone = input.timeZone ?? resolveLocalTimeZone();
  const userInFocus = readRememberedUserName(input.longMemory) ?? input.snapshot.username;
  const workingDirectory = input.workingDirectory ?? process.cwd();

  const localDateTime = safeFormatDateTime(
    now,
    locale,
    {
      dateStyle: 'short',
      timeStyle: 'medium',
      hour12: false,
      timeZone
    },
    now.toLocaleString()
  );
  const weekday = safeFormatDateTime(
    now,
    locale,
    {
      weekday: 'long',
      timeZone
    },
    '-'
  );

  return [
    `Agora local: ${localDateTime}`,
    `Dia da semana local: ${weekday}`,
    `Fuso horario local: ${timeZone}`,
    `Momento UTC: ${now.toISOString()}`,
    `Usuario em foco: ${userInFocus}`,
    `Usuario do sistema: ${input.snapshot.username}`,
    `Sistema: ${input.snapshot.distro} (${input.snapshot.platform} ${input.snapshot.release}, ${input.snapshot.arch})`,
    `Host: ${input.snapshot.hostname}`,
    `Diretorio de trabalho do processo: ${workingDirectory}`,
    `Snapshot do ambiente coletado em: ${input.snapshot.checkedAt}`
  ].join('\n');
}

function resolveLocalTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved || 'UTC';
  } catch {
    return 'UTC';
  }
}

function safeFormatDateTime(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  fallback: string
): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return fallback;
  }
}
