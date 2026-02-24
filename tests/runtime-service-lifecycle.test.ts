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

  it('inclui diagnostico de helper privilegiado Linux no status quando disponivel', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.existsSync.mockImplementation((filePath: string) => filePath === '/opt/dexter/runtime-helper.sh');
    setup.spawnSync.mockImplementation((_command: string, args: string[]) => {
      const target = args?.[0];
      if (target === 'ollama') {
        return {
          status: 0,
          stdout: '/usr/bin/ollama\n'
        };
      }
      return {
        status: 1,
        stdout: ''
      };
    });
    setup.fetchInstalledModels.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['{"helper":"dexter-runtime-helper","systemctl":true,"service":false,"curl":true}\n'],
        exitCode: 0
      })
    );

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger, 'linux', {
      linuxPrivilegedHelperPath: '/opt/dexter/runtime-helper.sh'
    });
    const status = await service.status();

    expect(setup.spawn).toHaveBeenCalledWith('bash', ['/opt/dexter/runtime-helper.sh', 'status'], expect.anything());
    expect(status.privilegedHelper).toMatchObject({
      configured: true,
      available: true,
      statusProbeOk: true,
      pkexecAvailable: false,
      sudoAvailable: false,
      privilegeEscalationReady: false,
      capabilities: {
        systemctl: true,
        service: false,
        curl: true
      }
    });
    expect(status.notes.join(' ')).toContain('Helper Linux: service manager systemctl; curl ok.');
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

  it('nao tenta iniciar runtime local quando endpoint configurado e remoto', async () => {
    const setup = await loadRuntimeServiceModule();
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
        endpoint: 'http://models.example.com:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger);
    const status = await service.startRuntime();

    expect(setup.spawn).not.toHaveBeenCalled();
    expect(status.notes).toContain('Inicio automatico desabilitado: endpoint configurado aponta para host remoto.');
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

  it('executa instalacao do runtime via pkexec no Linux quando disponivel e captura saida', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockImplementation((_command: string, args: string[]) => {
      const target = args?.[0];
      if (target === 'bash' || target === 'curl' || target === 'pkexec') {
        return {
          status: 0,
          stdout: `/usr/bin/${target}\n`
        };
      }
      return {
        status: 1,
        stdout: ''
      };
    });
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

    const previousDisplay = process.env.DISPLAY;
    process.env.DISPLAY = ':0';

    const service = new setup.RuntimeService(configStore, logger);
    const result = await service.installRuntime();
    if (typeof previousDisplay === 'string') {
      process.env.DISPLAY = previousDisplay;
    } else {
      delete process.env.DISPLAY;
    }

    expect(setup.spawn).toHaveBeenCalledWith(
      'pkexec',
      ['bash', '-lc', 'curl -fsSL https://ollama.com/install.sh | sh'],
      expect.anything()
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('install ok');
    expect(result.strategy).toBe('linux-pkexec');
    expect(logger.info).toHaveBeenCalledWith(
      'runtime.install.finish',
      expect.objectContaining({
        ok: true
      })
    );
  });

  it('prefere helper privilegiado Linux para instalar runtime quando configurado', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.existsSync.mockImplementation((filePath: string) => filePath === '/opt/dexter/runtime-helper.sh');
    setup.spawnSync.mockImplementation((_command: string, args: string[]) => {
      const target = args?.[0];
      if (target === 'bash' || target === 'curl' || target === 'pkexec') {
        return {
          status: 0,
          stdout: `/usr/bin/${target}\n`
        };
      }
      return {
        status: 1,
        stdout: ''
      };
    });
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['helper install ok\n'],
        exitCode: 0
      })
    );

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const previousDisplay = process.env.DISPLAY;
    process.env.DISPLAY = ':0';

    const service = new setup.RuntimeService(configStore, logger, 'linux', {
      linuxPrivilegedHelperPath: '/opt/dexter/runtime-helper.sh'
    });
    const result = await service.installRuntime();

    if (typeof previousDisplay === 'string') {
      process.env.DISPLAY = previousDisplay;
    } else {
      delete process.env.DISPLAY;
    }

    expect(setup.spawn).toHaveBeenCalledWith(
      'pkexec',
      ['bash', '/opt/dexter/runtime-helper.sh', 'install-ollama'],
      expect.anything()
    );
    expect(result.ok).toBe(true);
    expect(result.strategy).toBe('linux-pkexec-helper');
    expect(result.output).toContain('helper install ok');
  });

  it('retorna fluxo assistido no Linux quando nao ha prompt grafico de privilegio', async () => {
    const setup = await loadRuntimeServiceModule();
    setup.spawnSync.mockImplementation((_command: string, args: string[]) => {
      const target = args?.[0];
      if (target === 'bash' || target === 'curl') {
        return {
          status: 0,
          stdout: `/usr/bin/${target}\n`
        };
      }
      if (target === 'pkexec') {
        return {
          status: 1,
          stdout: ''
        };
      }
      return {
        status: 1,
        stdout: ''
      };
    });

    const previousDisplay = process.env.DISPLAY;
    delete process.env.DISPLAY;

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
    if (typeof previousDisplay === 'string') {
      process.env.DISPLAY = previousDisplay;
    } else {
      delete process.env.DISPLAY;
    }

    expect(result.ok).toBe(false);
    expect(result.strategy).toBe('linux-assist');
    expect(result.manualRequired).toBe(true);
    expect(result.errorCode).toBe('privilege_required');
    expect(result.nextSteps?.join(' ')).toContain('terminal');
    expect(setup.spawn).not.toHaveBeenCalled();
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

    const service = new setup.RuntimeService(configStore, logger, 'darwin');
    const result = await service.installRuntime();

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.errorOutput).toContain('spawn failed');
    expect(result.errorCode).toBe('shell_spawn_error');
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

  it('tenta helper privilegiado Linux para iniciar runtime antes do fallback local', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    setup.existsSync.mockImplementation((filePath: string) => filePath === '/opt/dexter/runtime-helper.sh');
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['service started\n'],
        exitCode: 0
      })
    );

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger, 'linux', {
      linuxPrivilegedHelperPath: '/opt/dexter/runtime-helper.sh'
    });

    vi.spyOn(service, 'status')
      .mockResolvedValueOnce({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: false,
        installedModelCount: 0,
        suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
        notes: []
      })
      .mockResolvedValueOnce({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: true,
        installedModelCount: 1,
        suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
        notes: []
      });

    const pending = service.startRuntime();
    await vi.advanceTimersByTimeAsync(1700);
    const status = await pending;

    expect(status.ollamaReachable).toBe(true);
    expect(setup.spawn).toHaveBeenCalledTimes(1);
    expect(setup.spawn).toHaveBeenCalledWith(
      'pkexec',
      ['bash', '/opt/dexter/runtime-helper.sh', 'start-ollama-service'],
      expect.anything()
    );
    expect(logger.info).toHaveBeenCalledWith(
      'runtime.start.helper.success',
      expect.objectContaining({
        strategy: 'linux-pkexec-helper'
      })
    );
  });

  it('tenta helper privilegiado Linux para reparar runtime antes de fallback', async () => {
    vi.useFakeTimers();

    const setup = await loadRuntimeServiceModule();
    setup.existsSync.mockImplementation((filePath: string) => filePath === '/opt/dexter/runtime-helper.sh');
    setup.spawn.mockReturnValue(
      createSpawnedProcess({
        stdout: ['service restarted\n'],
        exitCode: 0
      })
    );

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const configStore = {
      get: vi.fn().mockReturnValue({
        endpoint: 'http://127.0.0.1:11434'
      })
    };

    const service = new setup.RuntimeService(configStore, logger, 'linux', {
      linuxPrivilegedHelperPath: '/opt/dexter/runtime-helper.sh'
    });

    vi.spyOn(service, 'status')
      .mockResolvedValueOnce({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: false,
        installedModelCount: 0,
        suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
        notes: []
      })
      .mockResolvedValueOnce({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: true,
        installedModelCount: 1,
        suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
        notes: []
      });

    const pending = service.repairRuntime();
    await vi.advanceTimersByTimeAsync(1700);
    const status = await pending;

    expect(status.ollamaReachable).toBe(true);
    expect(setup.spawn).toHaveBeenCalledTimes(1);
    expect(setup.spawn).toHaveBeenCalledWith(
      'pkexec',
      ['bash', '/opt/dexter/runtime-helper.sh', 'restart-ollama-service'],
      expect.anything()
    );
    expect(logger.info).toHaveBeenCalledWith(
      'runtime.repair.helper.success',
      expect.objectContaining({
        strategy: 'linux-pkexec-helper'
      })
    );
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

    const service = new setup.RuntimeService(configStore, logger, 'darwin');
    const pendingResult = service.installRuntime();

    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(1500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', 1);
    await expect(pendingResult).resolves.toMatchObject({
      ok: false,
      exitCode: 1,
      timedOut: true
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
  existsSync: ReturnType<typeof vi.fn>;
  fetchInstalledModels: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  const spawn = vi.fn();
  const spawnSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(false);
  const fetchInstalledModels = vi.fn();

  vi.doMock('node:child_process', () => ({
    spawn,
    spawnSync
  }));

  vi.doMock('node:fs', () => ({
    existsSync
  }));

  vi.doMock('@main/services/models/ollama-http', () => ({
    fetchInstalledModels
  }));

  const mod = await import('@main/services/runtime/RuntimeService');

  return {
    RuntimeService: mod.RuntimeService,
    spawn,
    spawnSync,
    existsSync,
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
