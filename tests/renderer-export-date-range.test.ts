import { describe, expect, it } from 'vitest';
import { buildExportDateRangeFromInputs, parseDateInputValue } from '../src/renderer/utils/export-date-range';

describe('renderer export date range helpers', () => {
  it('rejeita data invalida com overflow de calendario', () => {
    const result = buildExportDateRangeFromInputs('2026-02-31', '');

    expect(result).toEqual({
      ok: false,
      message: 'Data inicial invalida para exportacao.'
    });
  });

  it('aceita data valida em ano bissexto', () => {
    const parsed = parseDateInputValue('2024-02-29', 'start');

    expect(parsed.error).toBe(false);
    expect(parsed.value).toBeTypeOf('string');
    expect(Number.isFinite(Date.parse(parsed.value ?? ''))).toBe(true);
  });

  it('rejeita periodo invertido', () => {
    const result = buildExportDateRangeFromInputs('2026-03-02', '2026-03-01');

    expect(result).toEqual({
      ok: false,
      message: 'Periodo invalido: a data inicial deve ser menor ou igual a data final.'
    });
  });
});
