interface TemporalIntelligenceInput {
  input: string;
  now?: Date;
  locale?: string;
  timeZone?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function tryBuildTemporalDeterministicReply(input: TemporalIntelligenceInput): string | null {
  const normalized = normalizeIntentInput(input.input);
  if (!normalized) {
    return null;
  }

  const now = input.now ?? new Date();
  const locale = input.locale ?? 'pt-BR';
  const timeZone = input.timeZone ?? resolveLocalTimeZone();

  if (isDaysUntilYearEndIntent(normalized)) {
    return buildDaysUntilYearEndReply(now, locale, timeZone);
  }

  if (isTimeIntent(normalized)) {
    return buildCurrentTimeReply(now, locale, timeZone);
  }

  if (isDateIntent(normalized)) {
    return buildCurrentDateReply(now, locale, timeZone);
  }

  return null;
}

function buildCurrentTimeReply(now: Date, locale: string, timeZone: string): string {
  const time = safeFormat(
    now,
    locale,
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone
    },
    '--:--:--'
  );
  const weekday = safeFormat(
    now,
    locale,
    {
      weekday: 'long',
      timeZone
    },
    '-'
  );
  const date = safeFormat(
    now,
    locale,
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone
    },
    now.toISOString().slice(0, 10)
  );

  return `No momento, sao ${time} (${timeZone}), ${weekday}, ${date}.`;
}

function buildCurrentDateReply(now: Date, locale: string, timeZone: string): string {
  const weekday = safeFormat(
    now,
    locale,
    {
      weekday: 'long',
      timeZone
    },
    '-'
  );
  const date = safeFormat(
    now,
    locale,
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone
    },
    now.toISOString().slice(0, 10)
  );

  return `Hoje e ${weekday}, ${date} (${timeZone}).`;
}

function buildDaysUntilYearEndReply(now: Date, locale: string, timeZone: string): string {
  const parts = getDatePartsInTimeZone(now, timeZone);
  if (!parts) {
    return buildDaysUntilYearEndReplyFallback(now, locale, timeZone);
  }

  const todayUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const endUtc = Date.UTC(parts.year, 11, 31);
  const remainingDays = Math.max(0, Math.round((endUtc - todayUtc) / MS_PER_DAY));
  const plural = remainingDays === 1 ? 'dia' : 'dias';
  const weekday = safeFormat(
    now,
    locale,
    {
      weekday: 'long',
      timeZone
    },
    '-'
  );
  const date = safeFormat(
    now,
    locale,
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone
    },
    `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
  );

  return `Hoje e ${weekday}, ${date} (${timeZone}), e faltam ${remainingDays} ${plural} para 31 de dezembro de ${parts.year}.`;
}

function buildDaysUntilYearEndReplyFallback(now: Date, locale: string, timeZone: string): string {
  const local = new Date(now);
  const year = local.getFullYear();
  const todayStart = new Date(year, local.getMonth(), local.getDate());
  const endOfYear = new Date(year, 11, 31);
  const remainingDays = Math.max(0, Math.round((endOfYear.getTime() - todayStart.getTime()) / MS_PER_DAY));
  const plural = remainingDays === 1 ? 'dia' : 'dias';
  const date = safeFormat(
    local,
    locale,
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone
    },
    `${year}`
  );

  return `Hoje e ${date} (${timeZone}) e faltam ${remainingDays} ${plural} para 31 de dezembro de ${year}.`;
}

function normalizeIntentInput(value: string): string {
  return removeDiacritics(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isTimeIntent(value: string): boolean {
  return /(que horas sao|qual e a hora|hora agora|horario atual|agora sao que horas|what time is it|current time)/.test(value);
}

function isDateIntent(value: string): boolean {
  return /(que dia e hoje|qual a data de hoje|data de hoje|what date is today|todays date)/.test(value);
}

function isDaysUntilYearEndIntent(value: string): boolean {
  const hasDayUnit = /\b(dia|dias|day|days)\b/.test(value);
  if (!hasDayUnit) {
    return false;
  }

  const hasRemainingVerb = /(faltam|restam|left|until)/.test(value);
  if (!hasRemainingVerb) {
    return false;
  }

  return /(fim do ano|final do ano|acabar esse ano|acabar o ano|end of year|this year)/.test(value);
}

function resolveLocalTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved || 'UTC';
  } catch {
    return 'UTC';
  }
}

function safeFormat(
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

function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parsed = formatter.formatToParts(date);

    const year = Number.parseInt(parsed.find((part) => part.type === 'year')?.value ?? '', 10);
    const month = Number.parseInt(parsed.find((part) => part.type === 'month')?.value ?? '', 10);
    const day = Number.parseInt(parsed.find((part) => part.type === 'day')?.value ?? '', 10);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }

    return { year, month, day };
  } catch {
    return null;
  }
}

function removeDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
