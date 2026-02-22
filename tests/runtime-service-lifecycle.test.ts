import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('RuntimeService lifecycle', () => {
  it('reporta runtime alcancavel quando endpoint responde mesmo sem modelos', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/ollama\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const status = await service.status();

    expect(status.binaryFound).toBe(true);
    expect(status.binaryPath).toBe('/usr/bin/ollama');
    expect(status.ollamaReachable).toBe(true);
    expect(status.notes).toContain('Runtime ativo, mas ainda sem modelos instalados.');
  });

  it('nao tenta iniciar runtime quando ele ja esta alcancavel', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/ollama\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([
      {
        name: 'llama3.2:3b',
        sizeBytes: 123,
        modifiedAt: new Date().toISOString()
      }
    ]);

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const status = await service.startRuntime();

    expect(status.ollamaReachable).toBe(true);
    expect(setup.spawn).not.toHaveBeenCalled();
  });

  it('nao tenta iniciar runtime quando binario nao existe', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockReturnValue({
      status: 1,
      stdout: ''
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const status = await service.startRuntime();

    expect(status.binaryFound).toBe(false);
    expect(setup.spawn).not.toHaveBeenCalled();
  });

  it('usa comando where no Windows e trata endpoint offline por excecao', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockReturnValue({
      status: 1,
      stdout: ''
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger, 'win32');
    const status = await service.status();

    expect(setup.spawnSync).toHaveBeenCalledWith('where', ['ollama'], expect.anything());
    expect(status.ollamaReachable).toBe(false);
    expect(status.binaryFound).toBe(false);
    expect(status.suggestedInstallCommand).toBe('winget install Ollama.Ollama');
  });

  it('inicia runtime com OLLAMA_HOST normalizado no ambiente', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    const unref = vi.fn();

    setup.spawn.mockReturnValue({
      pid: 321,
      unref
    });
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/ollama\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);

    const promise = service.startRuntime();
    await vi.advanceTimersByTimeAsync(1700);
    await promise;

    expect(setup.spawn).toHaveBeenCalledWith(
      '/usr/bin/ollama',
      ['serve'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        env: expect.objectContaining({
          OLLAMA_HOST: '127.0.0.1:11434'
        })
      })
    );
    expect(unref).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'runtime.start.spawned',
      expect.objectContaining({
        pid: 321,
        endpoint: 'http://127.0.0.1:11434',
        ollamaHost: '127.0.0.1:11434'
      })
    );
  });

  it('executa instalacao do runtime com sucesso e captura saida', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['install ok\n'],
        stderr: ['warning line\n'],
        exitCode: 0
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const result = await service.installRuntime();

    expect(setup.spawn).toHaveBeenCalledWith('bash', ['-lc', 'curl -fsSL https://ollama.com/install.sh | sh'], expect.anything());
    expect(result.ok).toBe(true);
    expect(result.output).toContain('install ok');
    expect(logger.info).toHaveBeenCalledWith(
      'runtime.install.finish',
      expect.objectContaining({
        ok: true
      })
    );
  });

  it('usa comando de instalacao via Homebrew no macOS', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['brew ok\n'],
        exitCode: 0
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger, 'darwin');
    const result = await service.installRuntime();

    expect(setup.spawn).toHaveBeenCalledWith('bash', ['-lc', 'brew install ollama'], expect.anything());
    expect(result.ok).toBe(true);
    expect(result.command).toBe('brew install ollama');
  });

  it('retorna instrucao de fallback para plataforma sem instalador conhecido', async () => {
    const setup = await loadRuntimeServiceModule();

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger, 'freebsd');
    const result = await service.installRuntime();

    expect(result.ok).toBe(false);
    expect(result.command).toBe('');
    expect(result.errorOutput).toContain('Plataforma sem instalador automatizado');
    expect(setup.spawn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('retorna estado de nao implementado para instalacao automatica no Windows', async () => {
    const setup = await loadRuntimeServiceModule();

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger, 'win32');
    const result = await service.installRuntime();

    expect(result.ok).toBe(false);
    expect(result.command).toBe('winget install Ollama.Ollama');
    expect(result.errorOutput).toContain('Windows ainda nao implementada');
    expect(setup.spawn).not.toHaveBeenCalled();
  });

  it('retorna erro quando instalacao falha ao iniciar shell', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        emitError: 'spawn failed'
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const result = await service.installRuntime();

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.errorOutput).toContain('spawn failed');
  });

  it('reporta binario ausente quando probe retorna sucesso sem caminho valido', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const status = await service.status();

    expect(status.binaryFound).toBe(false);
    expect(status.binaryPath).toBeNull();
  });

  it('inicia runtime sem OLLAMA_HOST quando endpoint e invalido', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    const unref = vi.fn();
    setup.spawn.mockReturnValue({
      pid: 444,
      unref
    });
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/ollama\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'nao-e-url'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const pending = service.startRuntime();
    await vi.advanceTimersByTimeAsync(1700);
    await pending;

    const spawnCall = setup.spawn.mock.calls[0];
    expect(spawnCall?.[0]).toBe('/usr/bin/ollama');
    expect(spawnCall?.[2]?.env?.OLLAMA_HOST).toBeUndefined();
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('registra erro quando spawn do runtime falha ao iniciar', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    setup.spawn.mockImplementation(() => {
      throw new Error('spawn runtime failed');
    });
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/ollama\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const pending = service.startRuntime();
    await vi.advanceTimersByTimeAsync(1700);
    await pending;

    expect(logger.error).toHaveBeenCalledWith(
      'runtime.start.error',
      expect.objectContaining({
        reason: 'spawn runtime failed'
      })
    );
  });

  it('normaliza erro de spawn nao-Error ao iniciar runtime', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    setup.spawn.mockImplementation(() => {
      throw 'falha-string';
    });
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/ollama\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false
      })
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const pending = service.startRuntime();
    await vi.advanceTimersByTimeAsync(1700);
    await pending;

    expect(logger.error).toHaveBeenCalledWith(
      'runtime.start.error',
      expect.objectContaining({
        reason: 'falha-string'
      })
    );
  });

  it('usa fallback "ollama" quando status inicial nao retorna binaryPath', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    const unref = vi.fn();
    setup.spawn.mockReturnValue({
      pid: 555,
      unref
    });

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };
    const service = new setup.RuntimeService(configStore, logger);

    vi.spyOn(service, 'status')
      .mockResolvedValueOnce({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: null,
        ollamaReachable: false,
        installedModelCount: 0,
        suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
        notes: []
      })
      .mockResolvedValueOnce({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: false,
        installedModelCount: 0,
        suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
        notes: []
      });

    const pending = service.startRuntime();
    await vi.advanceTimersByTimeAsync(1700);
    await pending;

    expect(setup.spawn).toHaveBeenCalledWith(
      'ollama',
      ['serve'],
      expect.objectContaining({
        detached: true
      })
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('encerra instalacao por timeout com SIGTERM e SIGKILL', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();

    setup.spawn.mockReturnValue(child);

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const pendingResult = service.installRuntime();

    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(1500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', 1);
    await expect(pendingResult).resolves.toMatchObject({
      ok: false,
      exitCode: 1
    });
  });

  it('trata timeout do endpoint em status quando /api/version nao responde', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/ollama\n'
    });
    setup.fetchInstalledModels.mockResolvedValue([]);

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new Error('timeout'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const pending = service.status();
    await vi.advanceTimersByTimeAsync(1700);
    const status = await pending;

    expect(status.ollamaReachable).toBe(false);
    expect(status.notes).toContain('Endpoint local do Ollama nao respondeu em tempo habil.');
  });
});

async function loadRuntimeServiceModule(): Promise<{
  RuntimeService: any;
  spawn: ReturnType<typeof vi.fn>;
  spawnSync: ReturnType<typeof vi.fn>;
  fetchInstalledModels: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  const spawn = vi.fn();
  const spawnSync = vi.fn();
  const fetchInstalledModels = vi.fn();

  vi.doMock('node:child_process', () => ({
    spawn,
    spawnSync
  }));

  vi.doMock('@main/services/models/ollama-http', () => ({
    fetchInstalledModels
  }));

  const mod = await import('@main/services/runtime/RuntimeService');

  return {
    RuntimeService: mod.RuntimeService,
    spawn,
    spawnSync,
    fetchInstalledModels
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
