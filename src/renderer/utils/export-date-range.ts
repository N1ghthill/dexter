import type { ExportDateRange } from '@shared/contracts';

export function buildExportDateRangeFromInputs(
  dateFromInput: string,
  dateToInput: string
): { ok: true; value: ExportDateRange } | { ok: false; message: string } {
  const from = parseDateInputValue(dateFromInput, 'start');
  const to = parseDateInputValue(dateToInput, 'end');

  if (from.error) {
    return {
      ok: false,
      message: 'Data inicial invalida para exportacao.'
    };
  }

  if (to.error) {
    return {
      ok: false,
      message: 'Data final invalida para exportacao.'
    };
  }

  if (from.value && to.value && Date.parse(from.value) > Date.parse(to.value)) {
    return {
      ok: false,
      message: 'Periodo invalido: a data inicial deve ser menor ou igual a data final.'
    };
  }

  return {
    ok: true,
    value: {
      dateFrom: from.value,
      dateTo: to.value
    }
  };
}

export function parseDateInputValue(
  value: string,
  boundary: 'start' | 'end'
): { value: string | undefined; error: boolean } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: undefined, error: false };
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { value: undefined, error: true };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { value: undefined, error: true };
  }

  const date =
    boundary === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);

  if (Number.isNaN(date.getTime())) {
    return { value: undefined, error: true };
  }

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { value: undefined, error: true };
  }

  return {
    value: date.toISOString(),
    error: false
  };
}
