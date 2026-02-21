import { spawn, spawnSync } from 'node:child_process';
import type { RuntimeInstallResult, RuntimeStatus } from '@shared/contracts';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { Logger } from '@main/services/logging/Logger';
import { fetchInstalledModels } from '@main/services/models/ollama-http';

interface BinaryProbe {
  found: boolean;
  path: string | null;
}

interface ShellResult {
  exitCode: number | null;
  output: string;
  errorOutput: string;
}

export class RuntimeService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly logger: Logger
  ) {}

  async status(): Promise<RuntimeStatus> {
    const config = this.configStore.get();
    const binary = probeOllamaBinary();
    const installed = await fetchInstalledModels(config.endpoint);
    const reachable = installed.length > 0 || (await isEndpointReachable(config.endpoint));

    const notes: string[] = [];
    if (!binary.found) {
      notes.push('Executavel do Ollama nao encontrado no PATH.');
    }

    if (!reachable) {
      notes.push('Endpoint local do Ollama nao respondeu em tempo habil.');
    }

    if (reachable && installed.length === 0) {
      notes.push('Runtime ativo, mas ainda sem modelos instalados.');
    }

    return {
      endpoint: config.endpoint,
      binaryFound: binary.found,
      binaryPath: binary.path,
      ollamaReachable: reachable,
      installedModelCount: installed.length,
      suggestedInstallCommand: recommendedInstallCommand(),
      notes
    };
  }

  async installRuntime(): Promise<RuntimeInstallResult> {
    const command = recommendedInstallCommand();
    const startedAt = new Date().toISOString();

    if (!command) {
      return {
        ok: false,
        command: '',
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: null,
        output: '',
        errorOutput: 'Plataforma sem instalador automatizado nesta fase.'
      };
    }

    this.logger.info('runtime.install.start', {
      platform: process.platform,
      command
    });

    const result = await runShell(command, 20 * 60 * 1000);
    const finishedAt = new Date().toISOString();
    const ok = result.exitCode === 0;

    this.logger.info('runtime.install.finish', {
      ok,
      exitCode: result.exitCode
    });

    return {
      ok,
      command,
      startedAt,
      finishedAt,
      exitCode: result.exitCode,
      output: result.output,
      errorOutput: result.errorOutput
    };
  }

  async startRuntime(): Promise<RuntimeStatus> {
    const before = await this.status();
    if (before.ollamaReachable) {
      return before;
    }

    if (!before.binaryFound) {
      return before;
    }

    const config = this.configStore.get();

    try {
      const child = spawn(before.binaryPath ?? 'ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          OLLAMA_HOST: config.endpoint
        }
      });

      child.unref();
      this.logger.info('runtime.start.spawned', {
        pid: child.pid,
        endpoint: config.endpoint
      });
    } catch (error) {
      this.logger.error('runtime.start.error', {
        reason: error instanceof Error ? error.message : String(error)
      });
    }

    await waitMs(1600);
    return this.status();
  }
}

function probeOllamaBinary(): BinaryProbe {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['ollama'], {
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    return {
      found: false,
      path: null
    };
  }

  const first = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return {
    found: Boolean(first),
    path: first ?? null
  };
}

async function runShell(command: string, timeoutMs: number): Promise<ShellResult> {
  if (process.platform === 'win32') {
    return {
      exitCode: null,
      output: '',
      errorOutput: 'Instalacao automatica no Windows ainda nao implementada.'
    };
  }

  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += String(chunk);
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500);
    }, timeoutMs);

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        output,
        errorOutput
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        output,
        errorOutput: `${errorOutput}\n${error.message}`.trim()
      });
    });
  });
}

async function isEndpointReachable(endpoint: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1600);

  try {
    const response = await fetch(`${endpoint}/api/version`, {
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function recommendedInstallCommand(): string {
  if (process.platform === 'linux') {
    return 'curl -fsSL https://ollama.com/install.sh | sh';
  }

  if (process.platform === 'darwin') {
    return 'brew install ollama';
  }

  if (process.platform === 'win32') {
    return 'winget install Ollama.Ollama';
  }

  return '';
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
