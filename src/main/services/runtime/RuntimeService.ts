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
    private readonly logger: Logger,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async status(): Promise<RuntimeStatus> {
    const config = this.configStore.get();
    const binary = probeOllamaBinary(this.platform);
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
      suggestedInstallCommand: recommendedInstallCommand(this.platform),
      notes
    };
  }

  async installRuntime(): Promise<RuntimeInstallResult> {
    const command = recommendedInstallCommand(this.platform);
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
      platform: this.platform,
      command
    });

    const result = await runShell(command, 20 * 60 * 1000, this.platform);
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
    if (classifyEndpointScope(config.endpoint) === 'remote') {
      return withStatusNote(before, 'Inicio automatico desabilitado: endpoint configurado aponta para host remoto.');
    }

    const host = endpointToOllamaHost(config.endpoint);

    try {
      const child = spawn(before.binaryPath ?? 'ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          ...(host ? { OLLAMA_HOST: host } : {})
        }
      });

      child.unref();
      this.logger.info('runtime.start.spawned', {
        pid: child.pid,
        endpoint: config.endpoint,
        ollamaHost: host
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

function withStatusNote(status: RuntimeStatus, note: string): RuntimeStatus {
  if (status.notes.includes(note)) {
    return status;
  }

  return {
    ...status,
    notes: [...status.notes, note]
  };
}

function probeOllamaBinary(platform: NodeJS.Platform = process.platform): BinaryProbe {
  const command = platform === 'win32' ? 'where' : 'which';
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

async function runShell(command: string, timeoutMs: number, platform: NodeJS.Platform = process.platform): Promise<ShellResult> {
  if (platform === 'win32') {
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
  let reachable = false;

  try {
    const response = await fetch(`${endpoint}/api/version`, {
      signal: controller.signal
    });
    reachable = response.ok;
  } catch {
    reachable = false;
  }

  clearTimeout(timeout);
  return reachable;
}

function classifyEndpointScope(endpoint: string): 'local' | 'remote' | 'unknown' {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    if (!host) {
      return 'unknown';
    }

    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return 'local';
    }

    return 'remote';
  } catch {
    return 'unknown';
  }
}

function recommendedInstallCommand(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'linux') {
    return 'curl -fsSL https://ollama.com/install.sh | sh';
  }

  if (platform === 'darwin') {
    return 'brew install ollama';
  }

  if (platform === 'win32') {
    return 'winget install Ollama.Ollama';
  }

  return '';
}

export function endpointToOllamaHost(endpoint: string): string | null {
  try {
    const parsed = new URL(endpoint);
    if (!parsed.hostname) {
      return null;
    }

    const hostName = parsed.hostname;

    if (parsed.port) {
      return `${hostName}:${parsed.port}`;
    }

    if (parsed.protocol === 'https:') {
      return `${hostName}:443`;
    }

    if (parsed.protocol === 'http:') {
      return `${hostName}:80`;
    }

    return parsed.host;
  } catch {
    return null;
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
