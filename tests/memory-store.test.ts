import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('limpa sessao da memoria curta e medio prazo', () => {
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

    expect(store.snapshot().mediumTermSessions).toBe(1);
    expect(store.getShortContext(sessionId)).toHaveLength(1);
    store.clearSession(sessionId);
    expect(store.getShortContext(sessionId)).toHaveLength(0);
    expect(store.snapshot().mediumTermSessions).toBe(0);
  });

  it('recupera arquivos de memoria corrompidos', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    const mediumPath = path.join(dir, 'memory', 'medium-memory.json');
    const longPath = path.join(dir, 'memory', 'long-memory.json');

    fs.writeFileSync(mediumPath, '{quebrado', 'utf-8');
    fs.writeFileSync(longPath, '[]', 'utf-8');

    expect(() => store.snapshot()).not.toThrow();
    expect(store.isHealthy()).toBe(true);
    expect(store.getLongMemory().notes).toEqual([]);
  });

  it('retorna copia defensiva da memoria longa e normaliza notas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    store.addLongNote('  primeira nota  ');
    store.addLongNote('primeira nota');
    store.addLongNote('   ');

    const first = store.getLongMemory();
    expect(first.notes).toEqual(['primeira nota']);

    first.notes.push('mutacao externa');
    first.profile.usuario = 'externo';

    const second = store.getLongMemory();
    expect(second.notes).toEqual(['primeira nota']);
    expect(second.profile.usuario).toBeUndefined();
  });

  it('aplica truncamento da amostra em medio prazo e limpa sessao ausente sem erro', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    const sessionId = 'session-long';

    store.pushTurn(sessionId, {
      id: 'turn-1',
      role: 'user',
      content: 'x'.repeat(300),
      timestamp: new Date().toISOString()
    });

    const mediumPath = path.join(dir, 'memory', 'medium-memory.json');
    const medium = JSON.parse(fs.readFileSync(mediumPath, 'utf-8')) as {
      sessions: Record<string, { sample: string[] }>;
    };
    const sample = medium.sessions[sessionId]?.sample[0] ?? '';
    expect(sample.endsWith('...')).toBe(true);
    expect(sample.length).toBeLessThanOrEqual(130);

    expect(() => store.clearSession('sessao-inexistente')).not.toThrow();
  });

  it('saneia estruturas invalidas de medio/longo prazo e pode reportar unhealthy em falha de escrita', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    const mediumPath = path.join(dir, 'memory', 'medium-memory.json');
    const longPath = path.join(dir, 'memory', 'long-memory.json');

    fs.writeFileSync(
      mediumPath,
      JSON.stringify(
        {
          sessions: {
            ok: {
              sessionId: 'ok',
              updatedAt: new Date().toISOString(),
              sample: ['linha valida', 123, 'outra linha']
            },
            semData: {
              sessionId: 'semData',
              updatedAt: 'invalido',
              sample: ['x']
            },
            bruto: 42
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    fs.writeFileSync(
      longPath,
      JSON.stringify(
        {
          data: {
            profile: {
              nome: 'Irving',
              idade: 30
            },
            preferences: {
              estilo: 'direto',
              verbose: true
            },
            notes: ['  nota valida  ', '', null, 'nota valida', 123]
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    const snapshot = store.snapshot();
    expect(snapshot.mediumTermSessions).toBe(1);
    expect(store.getLongMemory()).toMatchObject({
      profile: {
        nome: 'Irving'
      },
      preferences: {
        estilo: 'direto'
      },
      notes: ['nota valida']
    });

    fs.writeFileSync(mediumPath, '{json quebrado', 'utf-8');
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('sem espaco');
    });

    expect(store.isHealthy()).toBe(false);
    writeSpy.mockRestore();
  });

  it('limita notas de longo prazo em 400 entradas ao inserir notas unicas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    for (let i = 0; i < 430; i += 1) {
      store.addLongNote(`nota-${i}`);
    }

    const longMemory = store.getLongMemory();
    expect(longMemory.notes).toHaveLength(400);
    expect(longMemory.notes[0]).toBe('nota-30');
    expect(longMemory.notes[399]).toBe('nota-429');
  });

  it('recupera long-memory quebrado e saneia payload com tipos invalidos', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const store = new MemoryStore(dir);
    const mediumPath = path.join(dir, 'memory', 'medium-memory.json');
    const longPath = path.join(dir, 'memory', 'long-memory.json');

    fs.writeFileSync(
      mediumPath,
      JSON.stringify(
        {
          sessions: null
        },
        null,
        2
      ),
      'utf-8'
    );

    fs.writeFileSync(
      longPath,
      JSON.stringify(
        {
          data: {
            profile: null,
            preferences: undefined,
            notes: {
              valor: 'invalido'
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    const snapshot = store.snapshot();
    expect(snapshot.mediumTermSessions).toBe(0);
    expect(store.getLongMemory()).toEqual({
      profile: {},
      preferences: {},
      notes: []
    });

    fs.writeFileSync(longPath, '{json quebrado', 'utf-8');
    expect(store.getLongMemory()).toEqual({
      profile: {},
      preferences: {},
      notes: []
    });
  });

  it('saneia arquivo persistido com mais de 400 notas mantendo apenas as mais recentes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-memory-'));
    tempDirs.push(dir);

    const longPath = path.join(dir, 'memory', 'long-memory.json');
    fs.mkdirSync(path.dirname(longPath), { recursive: true });
    fs.writeFileSync(
      longPath,
      JSON.stringify(
        {
          data: {
            profile: {},
            preferences: {},
            notes: Array.from({ length: 450 }, (_item, index) => `nota-${index}`)
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    const store = new MemoryStore(dir);
    const notes = store.getLongMemory().notes;
    expect(notes).toHaveLength(400);
    expect(notes[0]).toBe('nota-50');
    expect(notes[399]).toBe('nota-449');
  });
});
