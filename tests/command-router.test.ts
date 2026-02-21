import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandRouter } from '@main/services/commands/CommandRouter';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { HealthService } from '@main/services/health/HealthService';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CommandRouter', () => {
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
});
