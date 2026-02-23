import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationContextBuilder } from '@main/services/agent/ConversationContextBuilder';
import { DexterBrain } from '@main/services/agent/DexterBrain';
import { CommandRouter } from '@main/services/commands/CommandRouter';
import { ConfigStore } from '@main/services/config/ConfigStore';
import type { EnvironmentSnapshot } from '@main/services/environment/environment-context';
import { HealthService } from '@main/services/health/HealthService';
import type { GenerateInput, LlmProvider } from '@main/services/llm/LlmProvider';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('DexterBrain', () => {
  it('retorna comando diretamente sem consultar LLM', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-brain-'));
    tempDirs.push(dir);

    const configStore = new ConfigStore(dir);
    const memoryStore = new MemoryStore(dir);
    const commandRouter = {
      tryExecute: vi.fn().mockResolvedValue({
        id: 'cmd-1',
        role: 'assistant',
        content: 'Ajuda',
        timestamp: new Date().toISOString(),
        source: 'command'
      })
    };
    const contextBuilder = {
      buildForSession: vi.fn(),
      buildFailureHint: vi.fn().mockReturnValue('hint')
    };
    const llmProvider: LlmProvider = {
      generate: vi.fn().mockResolvedValue('nao usado')
    };
    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };

    const brain = new DexterBrain(
      commandRouter as never,
      configStore,
      memoryStore,
      contextBuilder as never,
      llmProvider,
      logger as never
    );
    const reply = await brain.respond({
      sessionId: 'session-cmd',
      input: '/help'
    });

    expect(reply.source).toBe('command');
    expect(reply.content).toBe('Ajuda');
    expect(llmProvider.generate).not.toHaveBeenCalled();
    expect(contextBuilder.buildForSession).not.toHaveBeenCalled();
    expect(memoryStore.getShortContext('session-cmd')).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('command.executed', {
      sessionId: 'session-cmd',
      input: '/help'
    });
  });

  it('propaga contexto situacional para o provedor LLM', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-brain-'));
    tempDirs.push(dir);

    const configStore = new ConfigStore(dir);
    const memoryStore = new MemoryStore(dir);
    const logger = new Logger(dir);
    const healthService = new HealthService(configStore, memoryStore, logger);
    const historyService = new ModelHistoryService(dir);
    const commandRouter = new CommandRouter(configStore, memoryStore, healthService, historyService);
    const contextBuilder = new ConversationContextBuilder(
      memoryStore,
      historyService,
      () => fakeSnapshot({ ollama: true, systemctl: true }),
      () => configStore.get()
    );

    const blocked = historyService.block('pull', 'qwen2.5:7b', 'Bloqueado por politica');
    expect(blocked.status).toBe('blocked');

    let capturedInput: GenerateInput | undefined;
    const llmProvider: LlmProvider = {
      generate: async (input) => {
        capturedInput = input;
        return 'Resposta de teste';
      }
    };

    const brain = new DexterBrain(commandRouter, configStore, memoryStore, contextBuilder, llmProvider, logger);
    const reply = await brain.respond({
      sessionId: 'session-1',
      input: 'Como esta o meu runtime?'
    });

    expect(reply.source).toBe('llm');
    expect(capturedInput).toBeDefined();
    if (!capturedInput) {
      throw new Error('Esperava input enviado ao provedor LLM');
    }

    expect(capturedInput.situationalContext).toContain('Operacoes recentes de modelo');
    expect(capturedInput.situationalContext).toContain('Contexto operacional');
    expect(capturedInput.environmentContext).toContain('SO:');
    expect(capturedInput.shortContext).toHaveLength(0);
    expect(memoryStore.getShortContext('session-1')).toHaveLength(2);
  });

  it('retorna fallback com dica contextual quando o LLM falha', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-brain-'));
    tempDirs.push(dir);

    const configStore = new ConfigStore(dir);
    const memoryStore = new MemoryStore(dir);
    const logger = new Logger(dir);
    const healthService = new HealthService(configStore, memoryStore, logger);
    const historyService = new ModelHistoryService(dir);
    const commandRouter = new CommandRouter(configStore, memoryStore, healthService, historyService);
    const contextBuilder = new ConversationContextBuilder(
      memoryStore,
      historyService,
      () => fakeSnapshot({ ollama: false, systemctl: true })
    );

    const llmProvider: LlmProvider = {
      generate: async () => {
        throw new Error('llm offline');
      }
    };

    const brain = new DexterBrain(commandRouter, configStore, memoryStore, contextBuilder, llmProvider, logger);
    const reply = await brain.respond({
      sessionId: 'session-2',
      input: 'Oi'
    });

    expect(reply.source).toBe('fallback');
    expect(reply.content).toContain('Nao encontrei o comando ollama');
    expect(memoryStore.getShortContext('session-2')).toHaveLength(1);
  });

  it('registra erro textual quando excecao nao e instancia de Error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-brain-'));
    tempDirs.push(dir);

    const configStore = new ConfigStore(dir);
    const memoryStore = new MemoryStore(dir);
    const commandRouter = {
      tryExecute: vi.fn().mockResolvedValue(null)
    };
    const contextBuilder = {
      buildForSession: vi.fn().mockReturnValue({
        shortContext: [],
        longContext: {
          profile: {},
          preferences: {},
          notes: []
        },
        environmentContext: 'SO: Linux',
        situationalContext: 'sem eventos'
      }),
      buildFailureHint: vi.fn().mockReturnValue('Dica local')
    };
    const llmProvider: LlmProvider = {
      generate: vi.fn(async () => {
        throw 'falha bruta';
      })
    };
    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };

    const brain = new DexterBrain(
      commandRouter as never,
      configStore,
      memoryStore,
      contextBuilder as never,
      llmProvider,
      logger as never
    );

    const reply = await brain.respond({
      sessionId: 'session-raw-error',
      input: 'teste'
    });

    expect(reply.source).toBe('fallback');
    expect(reply.content).toContain('Dica local');
    expect(logger.error).toHaveBeenCalledWith('chat.reply_error', {
      sessionId: 'session-raw-error',
      reason: 'falha bruta'
    });
  });
});

function fakeSnapshot(options: { ollama: boolean; systemctl: boolean }): EnvironmentSnapshot {
  return {
    checkedAt: new Date().toISOString(),
    platform: 'linux',
    release: '6.8.0',
    arch: 'x64',
    distro: 'Ubuntu 24.04',
    hostname: 'devbox',
    username: 'irving',
    shell: '/bin/bash',
    uptimeSeconds: 1800,
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
