import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '@main/services/memory/MemoryStore';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MemoryStore', () => {
  it('mantem limite de memoria curta e persiste amostra em medio prazo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    const sessionId = 'session-a';

    for (let i = 0; i < 30; i += 1) {
      store.pushTurn(sessionId, {
        id: String(i),
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `mensagem ${i}`,
        timestamp: new Date().toISOString()
      });
    }

    expect(store.getShortContext(sessionId)).toHaveLength(24);

    const snapshot = store.snapshot();
    expect(snapshot.mediumTermSessions).toBe(1);
    expect(snapshot.shortTermTurns).toBe(24);
  });

  it('limpa sessao da memoria curta', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    const sessionId = 'session-b';

    store.pushTurn(sessionId, {
      id: 'x',
      role: 'user',
      content: 'teste',
      timestamp: new Date().toISOString()
    });

    expect(store.getShortContext(sessionId)).toHaveLength(1);
    store.clearSession(sessionId);
    expect(store.getShortContext(sessionId)).toHaveLength(0);
  });
});
