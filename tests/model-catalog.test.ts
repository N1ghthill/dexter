import { describe, expect, it } from 'vitest';
import { buildCuratedCatalog } from '@main/services/models/ModelCatalog';

describe('ModelCatalog', () => {
  it('marca modelos instalados corretamente', () => {
    const catalog = buildCuratedCatalog(new Set(['qwen2.5:7b']));
    const qwen = catalog.find((item) => item.name === 'qwen2.5:7b');
    const llama = catalog.find((item) => item.name === 'llama3.2:3b');

    expect(qwen?.installed).toBe(true);
    expect(llama?.installed).toBe(false);
  });

  it('mantem ao menos um modelo recomendado', () => {
    const catalog = buildCuratedCatalog(new Set());
    expect(catalog.some((item) => item.recommended)).toBe(true);
  });
});
