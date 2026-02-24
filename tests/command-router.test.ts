import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRouter } from '@main/services/commands/CommandRouter';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { HealthService } from '@main/services/health/HealthService';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CommandRouter', () => {
  it('retorna ajuda com /help', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('/help', 's1');
    expect(reply?.content).toContain('/whoami');
    expect(reply?.content).toContain('/now');
    expect(reply?.content).toContain('/name <apelido>');
    expect(reply?.content).toContain('/health');
    expect(reply?.content).toContain('/remember');
  });

  it('executa /model e atualiza configuracao', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('/model llama3.2:1b', 's1');

    expect(reply?.content).toContain('llama3.2:1b');
    expect(config.get().model).toBe('llama3.2:1b');
  });

  it('retorna ajuda em comando desconhecido', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('/naoexiste', 's1');

    expect(reply?.content).toContain('/help');
  });

  it('ignora input sem barra', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('texto livre', 's1');

    expect(reply).toBeNull();
  });

  it('salva nota no longo prazo com /remember', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const before = memory.snapshot().longTermFacts;
    const reply = await router.tryExecute('/remember prefere respostas diretas', 's1');
    const after = memory.snapshot().longTermFacts;

    expect(reply?.content).toContain('longo prazo');
    expect(after).toBeGreaterThan(before);
  });

  it('retorna historico resumido com /history', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const record = history.start('pull', 'llama3.2:3b', 'Iniciando download.');
    history.progress(record.id, 'Download 50%', 50);
    history.finish(record.id, 'done', 'Concluido.', 100);

    const reply = await router.tryExecute('/history 3 pull done', 's1');

    expect(reply?.content).toContain('Historico de operacoes');
    expect(reply?.content).toContain('PULL llama3.2:3b');
    expect(reply?.content).toContain('CONCLUIDO');
  });

  it('retorna contexto de ambiente com /env', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('/env', 's1');

    expect(reply?.content).toContain('Ambiente local');
    expect(reply?.content).toContain('Comandos disponiveis');
  });

  it('retorna identidade operacional com /whoami', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    memory.upsertProfileFacts({ user_display_name: 'Irving' });
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('/whoami', 's1');

    expect(reply?.content).toContain('Identidade operacional');
    expect(reply?.content).toContain('Assistente: Dexter');
    expect(reply?.content).toContain('Usuario lembrado: Irving');
    expect(reply?.content).toContain('Consciencia situacional');
    expect(reply?.content).toContain('Protocolos ativos');
  });

  it('retorna referencia temporal com /now', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('/now', 's1');
    expect(reply?.content).toContain('Referencia temporal e situacional');
    expect(reply?.content).toContain('Agora local:');
    expect(reply?.content).toContain('Fuso horario local');
  });

  it('permite definir nome preferido com /name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const invalid = await router.tryExecute('/name irving 123', 's1');
    expect(invalid?.content).toContain('Nome invalido');

    const updated = await router.tryExecute('/name irving', 's1');
    expect(updated?.content).toContain('Vou te chamar de Irving');
    expect(memory.getLongMemory().profile.user_display_name).toBe('Irving');

    const duplicate = await router.tryExecute('/name Irving', 's1');
    expect(duplicate?.content).toContain('Ja estava registrado');
  });

  it('limpa memoria curta da sessao com /clear', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    memory.pushTurn('s1', {
      id: 'x',
      role: 'user',
      content: 'teste',
      timestamp: new Date().toISOString()
    });
    expect(memory.getShortContext('s1')).toHaveLength(1);

    const reply = await router.tryExecute('/clear', 's1');
    expect(reply?.content).toContain('foi limpa');
    expect(memory.getShortContext('s1')).toHaveLength(0);
  });

  it('retorna resumo de memoria com /mem', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    memory.pushTurn('s1', {
      id: 't1',
      role: 'user',
      content: 'teste',
      timestamp: new Date().toISOString()
    });

    const reply = await router.tryExecute('/mem', 's1');
    expect(reply?.content).toContain('Resumo de memoria');
    expect(reply?.content).toContain('Curto prazo');
  });

  it('retorna status de saude com /health', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2:3b' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const reply = await router.tryExecute('/health', 's1');
    expect(reply?.content).toContain('Saude geral: OK');
    expect(reply?.content).toContain('Modelo ativo: disponivel');
  });

  it('retorna detalhes de saude quando report vem com alertas', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const history = new ModelHistoryService(dir);
    const healthMock = {
      report: vi.fn().mockResolvedValue({
        ok: false,
        checkedAt: new Date().toISOString(),
        ollamaReachable: false,
        modelAvailable: false,
        memoryHealthy: true,
        loggingHealthy: false,
        details: ['Ollama offline', 'Logs indisponiveis']
      })
    };

    const router = new CommandRouter(config, memory, healthMock as never, history);
    const reply = await router.tryExecute('/health', 's1');
    expect(reply?.content).toContain('Saude geral: ATENCAO');
    expect(reply?.content).toContain('Detalhes:');
    expect(reply?.content).toContain('Ollama offline');
  });

  it('marca erro de memoria no resumo de /health', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const history = new ModelHistoryService(dir);
    const healthMock = {
      report: vi.fn().mockResolvedValue({
        ok: false,
        checkedAt: new Date().toISOString(),
        ollamaReachable: true,
        modelAvailable: true,
        memoryHealthy: false,
        loggingHealthy: true,
        details: ['Memoria indisponivel']
      })
    };

    const router = new CommandRouter(config, memory, healthMock as never, history);
    const reply = await router.tryExecute('/health', 's1');
    expect(reply?.content).toContain('Memoria: erro');
    expect(reply?.content).toContain('Logs: ok');
  });

  it('valida argumentos invalidos de /history', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const tooLarge = await router.tryExecute('/history 30', 's1');
    expect(tooLarge?.content).toContain('entre 1 e 20');

    const duplicated = await router.tryExecute('/history pull remove', 's1');
    expect(duplicated?.content).toContain('Uso: /history');
  });

  it('valida uso de /model e /remember sem argumento', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const model = await router.tryExecute('/model', 's1');
    const remember = await router.tryExecute('/remember', 's1');

    expect(model?.content).toContain('Uso: /model');
    expect(remember?.content).toContain('Uso: /remember');
  });

  it('suporta alias /linux e historico vazio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const linux = await router.tryExecute('/linux', 's1');
    const emptyHistory = await router.tryExecute('/history', 's1');

    expect(linux?.content).toContain('Ambiente local');
    expect(emptyHistory?.content).toContain('Historico vazio');
  });

  it('cobre formatos de status/data/duracao em /history', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);

    const historyMock = {
      query: vi.fn().mockReturnValue({
        items: [
          {
            id: '1',
            operation: 'pull',
            model: 'run-model',
            status: 'running',
            message: 'executando',
            startedAt: 'invalido',
            finishedAt: null,
            durationMs: null,
            percent: null
          },
          {
            id: '2',
            operation: 'remove',
            model: 'blocked-model',
            status: 'blocked',
            message: 'bloqueado',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 500,
            percent: 10
          },
          {
            id: '3',
            operation: 'pull',
            model: 'error-model',
            status: 'error',
            message: 'falhou',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 18000,
            percent: null
          },
          {
            id: '4',
            operation: 'pull',
            model: 'done-model',
            status: 'done',
            message: 'ok',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 120000,
            percent: 100
          }
        ],
        page: 1,
        pageSize: 4,
        total: 4,
        totalPages: 1
      })
    };

    const router = new CommandRouter(config, memory, health, historyMock as never);
    const reply = await router.tryExecute('/history 4', 's1');

    expect(reply?.content).toContain('[EM ANDAMENTO] PULL run-model');
    expect(reply?.content).toContain('[BLOQUEADO] REMOVE blocked-model 10%');
    expect(reply?.content).toContain('[ERRO] PULL error-model');
    expect(reply?.content).toContain('duracao <1s');
    expect(reply?.content).toContain('duracao 18s');
    expect(reply?.content).toContain('duracao 2m 0s');
    expect(reply?.content).toContain('(-)');
  });

  it('valida combinacoes invalidas adicionais de /history', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-command-'));
    tempDirs.push(dir);

    const config = new ConfigStore(dir);
    const memory = new MemoryStore(dir);
    const logger = new Logger(dir);
    const health = new HealthService(config, memory, logger);
    const history = new ModelHistoryService(dir);
    const router = new CommandRouter(config, memory, health, history);

    const duplicatedLimit = await router.tryExecute('/history 3 4', 's1');
    const duplicatedStatus = await router.tryExecute('/history done error', 's1');
    const invalidArg = await router.tryExecute('/history abc', 's1');

    expect(duplicatedLimit?.content).toContain('Uso: /history');
    expect(duplicatedStatus?.content).toContain('Uso: /history');
    expect(invalidArg?.content).toContain('Uso: /history');
  });
});
