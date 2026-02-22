import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

describe('ModelService', () => {
  it('lista catalogo curado marcando modelos instalados', async () => {
    const setup = await loadModelServiceModule();
    setup.fetchInstalledModels.mockResolvedValue([
      {
        name: 'qwen2.5:7b',
        sizeBytes: 10,
        modifiedAt: null
      }
    ]);

    const service = new setup.ModelService(createConfigStore(), createLogger());
    const curated = await service.listCurated();

    expect(setup.fetchInstalledModels).toHaveBeenCalledWith('http://127.0.0.1:11434');
    expect(curated.find((item: { name: string; installed: boolean }) => item.name === 'qwen2.5:7b')?.installed).toBe(true);
    expect(curated.find((item: { name: string; installed: boolean }) => item.name === 'llama3.2:3b')?.installed).toBe(false);
  });

  it('bloqueia operacao quando nome de modelo e invalido', async () => {
    const setup = await loadModelServiceModule();
    const service = new setup.ModelService(createConfigStore(), createLogger());

    const progress: Array<{ phase: string; message: string }> = [];
    const result = await service.pullModel('?', (event: { phase: string; message: string }) => {
      progress.push({
        phase: event.phase,
        message: event.message
      });
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Nome de modelo invalido');
    expect(setup.spawn).not.toHaveBeenCalled();
    expect(progress[0]).toMatchObject({
      phase: 'error'
    });
  });

  it('executa pull com progresso e finaliza com sucesso', async () => {
    const setup = await loadModelServiceModule();
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['pull 12%\n', 'pull 100%\n'],
        stderr: ['downloading layers\n'],
        exitCode: 0
      })
    );

    const logger = createLogger();
    const service = new setup.ModelService(createConfigStore(), logger);

    const progress: Array<{ phase: string; percent: number | null; message: string }> = [];
    const result = await service.pullModel('llama3.2:3b', (event: { phase: string; percent: number | null; message: string }) => {
      progress.push({
        phase: event.phase,
        percent: event.percent,
        message: event.message
      });
    });

    expect(result.ok).toBe(true);
    expect(result.model).toBe('llama3.2:3b');
    expect(setup.spawn).toHaveBeenCalledWith('ollama', ['pull', 'llama3.2:3b'], expect.anything());
    expect(progress.some((item) => item.phase === 'progress' && item.percent === 12)).toBe(true);
    expect(progress.some((item) => item.phase === 'done' && item.percent === 100)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'model.operation.finish',
      expect.objectContaining({
        operation: 'pull',
        model: 'llama3.2:3b',
        ok: true
      })
    );
  });

  it('emite progresso para linha final sem quebra ao encerrar processo', async () => {
    const setup = await loadModelServiceModule();
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['pull 42% sem quebra'],
        exitCode: 0
      })
    );

    const service = new setup.ModelService(createConfigStore(), createLogger());
    const progress: Array<{ phase: string; percent: number | null; message: string }> = [];

    const result = await service.pullModel('llama3.2:3b', (event: { phase: string; percent: number | null; message: string }) => {
      progress.push({
        phase: event.phase,
        percent: event.percent,
        message: event.message
      });
    });

    expect(result.ok).toBe(true);
    expect(progress.some((item) => item.phase === 'progress' && item.message.includes('sem quebra') && item.percent === 42)).toBe(true);
  });

  it('marca erro quando remove falha no comando ollama', async () => {
    const setup = await loadModelServiceModule();
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['removing model\n'],
        stderr: ['failed to remove\n'],
        exitCode: 1
      })
    );

    const logger = createLogger();
    const service = new setup.ModelService(createConfigStore(), logger);
    const progress: Array<{ phase: string; message: string }> = [];
    const result = await service.removeModel('llama3.2:3b', (event: { phase: string; message: string }) => {
      progress.push({
        phase: event.phase,
        message: event.message
      });
    });

    expect(result.ok).toBe(false);
    expect(result.errorOutput).toContain('failed to remove');
    expect(progress.some((item) => item.phase === 'error' && item.message.includes('falhou'))).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'model.operation.finish',
      expect.objectContaining({
        operation: 'remove',
        model: 'llama3.2:3b',
        ok: false
      })
    );
  });

  it('retorna falha quando spawn do ollama dispara erro de processo', async () => {
    const setup = await loadModelServiceModule();
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['preparando\n'],
        emitError: 'spawn failed'
      })
    );

    const logger = createLogger();
    const service = new setup.ModelService(createConfigStore(), logger);
    const result = await service.removeModel('llama3.2:3b');

    expect(result.ok).toBe(false);
    expect(result.errorOutput).toContain('spawn failed');
    expect(logger.info).toHaveBeenCalledWith(
      'model.operation.finish',
      expect.objectContaining({
        operation: 'remove',
        model: 'llama3.2:3b',
        ok: false,
        exitCode: null
      })
    );
  });

  it('encerra comando por timeout enviando SIGTERM e SIGKILL', async () => {
    const setup = await loadModelServiceModule();
    vi.useFakeTimers();

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();

    setup.spawn.mockReturnValue(child);

    const service = new setup.ModelService(createConfigStore(), createLogger());
    const pendingResult = service.pullModel('llama3.2:3b');

    await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(1500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', 0);
    await expect(pendingResult).resolves.toMatchObject({ ok: true });
  });
});

async function loadModelServiceModule(): Promise<{
  ModelService: any;
  spawn: ReturnType<typeof vi.fn>;
  fetchInstalledModels: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  const spawn = vi.fn();
  const fetchInstalledModels = vi.fn().mockResolvedValue([]);

  vi.doMock('node:child_process', () => ({
    spawn
  }));

  vi.doMock('@main/services/models/ollama-http', () => ({
    fetchInstalledModels
  }));

  const mod = await import('@main/services/models/ModelService');

  return {
    ModelService: mod.ModelService,
    spawn,
    fetchInstalledModels
  };
}

function createConfigStore() {
  return {
    get: vi.fn().mockReturnValue({
      endpoint: 'http://127.0.0.1:11434'
    })
  };
}

function createLogger() {
  return {
    info: vi.fn()
  };
}

function createSpawnedProcess(options: {
  stdout?: string[];
  stderr?: string[];
  exitCode?: number | null;
  emitError?: string;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  process.nextTick(() => {
    for (const chunk of options.stdout ?? []) {
      child.stdout.emit('data', chunk);
    }

    for (const chunk of options.stderr ?? []) {
      child.stderr.emit('data', chunk);
    }

    if (options.emitError) {
      child.emit('error', new Error(options.emitError));
      return;
    }

    child.emit('close', options.exitCode ?? 0);
  });

  return child;
}
