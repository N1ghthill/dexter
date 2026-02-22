import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationContextBuilder } from '@main/services/agent/ConversationContextBuilder';
import type { EnvironmentSnapshot } from '@main/services/environment/environment-context';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ConversationContextBuilder', () => {
  it('combina memoria, ambiente e historico recente para o prompt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-context-'));
    tempDirs.push(dir);

    const memory = new MemoryStore(dir);
    const history = new ModelHistoryService(dir);
    const sessionId = 's1';

    memory.pushTurn(sessionId, {
      id: 'turn-1',
      role: 'user',
      content: 'Me ajuda com runtime',
      timestamp: new Date().toISOString()
    });

    const record = history.start('pull', 'llama3.2:3b', 'Iniciando download');
    history.finish(record.id, 'done', 'Concluido', 100);

    const builder = new ConversationContextBuilder(
      memory,
      history,
      () => fakeSnapshot({ ollama: true, systemctl: true }),
      () => ({
        model: 'llama3.2:3b',
        endpoint: 'http://127.0.0.1:11434'
      })
    );
    const context = builder.buildForSession(sessionId);

    expect(context.shortContext).toHaveLength(1);
    expect(context.environmentContext).toContain('SO:');
    expect(context.situationalContext).toContain('Contexto operacional');
    expect(context.situationalContext).toContain('endpoint local');
    expect(context.situationalContext).toContain('Operacoes recentes de modelo');
    expect(context.situationalContext).toContain('PULL llama3.2:3b');
  });

  it('gera dica contextual quando ollama nao esta disponivel', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-context-'));
    tempDirs.push(dir);

    const memory = new MemoryStore(dir);
    const history = new ModelHistoryService(dir);
    const builder = new ConversationContextBuilder(memory, history, () => fakeSnapshot({ ollama: false, systemctl: true }));

    const hint = builder.buildFailureHint();
    expect(hint).toContain('Nao encontrei o comando ollama');
  });

  it('marca endpoint remoto no contexto operacional', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-context-'));
    tempDirs.push(dir);

    const memory = new MemoryStore(dir);
    const history = new ModelHistoryService(dir);
    const builder = new ConversationContextBuilder(
      memory,
      history,
      () => fakeSnapshot({ ollama: true, systemctl: false }),
      () => ({
        model: 'qwen2.5:7b',
        endpoint: 'https://models.exemplo.dev'
      })
    );

    const context = builder.buildForSession('sess-remote');
    expect(context.situationalContext).toContain('endpoint remoto');
  });

  it('trata endpoint invalido e data invalida sem quebrar contexto', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-context-'));
    tempDirs.push(dir);

    const memory = new MemoryStore(dir);
    const fakeHistory = {
      query: () => ({
        items: [
          {
            id: 'op-1',
            operation: 'remove',
            model: 'qwen2.5:7b',
            status: 'error',
            message: 'falha',
            startedAt: 'data-invalida',
            finishedAt: null,
            durationMs: null,
            percent: null
          }
        ]
      })
    } as unknown as ModelHistoryService;

    const builder = new ConversationContextBuilder(
      memory,
      fakeHistory,
      () => fakeSnapshot({ ollama: true, systemctl: false }),
      () => ({
        model: 'qwen2.5:7b',
        endpoint: 'nao-e-url'
      })
    );

    const context = builder.buildForSession('sess-invalid');
    expect(context.situationalContext).toContain('endpoint indefinido');
    expect(context.situationalContext).toContain('erro REMOVE qwen2.5:7b');
    expect(context.situationalContext).toContain('(-)');
  });

  it('gera hint de runtime parado quando ollama e systemctl estao disponiveis', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-context-'));
    tempDirs.push(dir);

    const memory = new MemoryStore(dir);
    const history = new ModelHistoryService(dir);
    const builder = new ConversationContextBuilder(memory, history, () => fakeSnapshot({ ollama: true, systemctl: true }));

    const hint = builder.buildFailureHint();
    expect(hint).toContain('runtime pode estar parado');
    expect(hint).toContain('/health');
  });

  it('gera hint padrao quando apenas o comando ollama existe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-context-'));
    tempDirs.push(dir);

    const memory = new MemoryStore(dir);
    const history = new ModelHistoryService(dir);
    const builder = new ConversationContextBuilder(memory, history, () => fakeSnapshot({ ollama: true, systemctl: false }));

    const hint = builder.buildFailureHint();
    expect(hint).toContain('endpoint nao respondeu');
    expect(hint).toContain('ollama serve');
  });

  it('marca status em andamento e endpoint indefinido para URL sem host', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-context-'));
    tempDirs.push(dir);

    const memory = new MemoryStore(dir);
    const fakeHistory = {
      query: () => ({
        items: [
          {
            id: 'op-running',
            operation: 'pull',
            model: 'llama3.2:3b',
            status: 'running',
            message: 'baixando',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            durationMs: null,
            percent: 20
          }
        ]
      })
    } as unknown as ModelHistoryService;

    const builder = new ConversationContextBuilder(
      memory,
      fakeHistory,
      () => fakeSnapshot({ ollama: true, systemctl: false }),
      () => ({
        model: 'llama3.2:3b',
        endpoint: 'file:///tmp/socket'
      })
    );

    const context = builder.buildForSession('sess-running');
    expect(context.situationalContext).toContain('endpoint indefinido');
    expect(context.situationalContext).toContain('em andamento PULL llama3.2:3b 20%');
  });
});

function fakeSnapshot(options: { ollama: boolean; systemctl: boolean }): EnvironmentSnapshot {
  const now = new Date().toISOString();

  return {
    checkedAt: now,
    platform: 'linux',
    release: '6.8.0',
    arch: 'x64',
    distro: 'Ubuntu 24.04',
    hostname: 'devbox',
    username: 'irving',
    shell: '/bin/bash',
    uptimeSeconds: 3200,
    commands: [
      {
        command: 'ollama',
        available: options.ollama,
        path: options.ollama ? '/usr/bin/ollama' : null
      },
      {
        command: 'systemctl',
        available: options.systemctl,
        path: options.systemctl ? '/usr/bin/systemctl' : null
      },
      {
        command: 'journalctl',
        available: true,
        path: '/usr/bin/journalctl'
      },
      {
        command: 'curl',
        available: true,
        path: '/usr/bin/curl'
      },
      {
        command: 'git',
        available: true,
        path: '/usr/bin/git'
      },
      {
        command: 'bash',
        available: true,
        path: '/usr/bin/bash'
      }
    ],
    notes: []
  };
}
