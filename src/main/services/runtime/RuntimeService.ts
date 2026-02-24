import { spawn, spawnSync } from 'node:child_process';
import type {
  RuntimeInstallErrorCode,
  RuntimeInstallResult,
  RuntimeInstallStrategy,
  RuntimeStatus
} from '@shared/contracts';
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
  timedOut: boolean;
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
        errorOutput: 'Plataforma sem instalador automatizado nesta fase.',
        strategy: 'unsupported',
        errorCode: 'unsupported_platform',
        manualRequired: true,
        nextSteps: ['Use o comando sugerido pela sua distribuicao/SO para instalar o Ollama manualmente.']
      };
    }

    const installPlan = buildRuntimeInstallPlan(this.platform, command);
    if (!installPlan.ok) {
      return {
        ...installPlan.result,
        startedAt,
        finishedAt: new Date().toISOString()
      };
    }

    this.logger.info('runtime.install.start', {
      platform: this.platform,
      command,
      strategy: installPlan.strategy
    });

    const result =
      installPlan.runner === 'pkexec'
        ? await runPkexecCommand(command, 20 * 60 * 1000, this.platform)
        : await runShell(command, 20 * 60 * 1000, this.platform);
    const finishedAt = new Date().toISOString();
    const ok = result.exitCode === 0;
    const errorCode = ok ? undefined : classifyRuntimeInstallFailure(result);
    const nextSteps = ok
      ? ['Se o runtime nao iniciar automaticamente, use "Iniciar Runtime" no painel ou rode `ollama serve` no terminal.']
      : buildRuntimeInstallNextSteps({
          platform: this.platform,
          command,
          strategy: installPlan.strategy,
          errorCode
        });

    this.logger.info('runtime.install.finish', {
      ok,
      exitCode: result.exitCode,
      strategy: installPlan.strategy,
      errorCode: errorCode ?? null,
      timedOut: result.timedOut
    });

    return {
      ok,
      command,
      startedAt,
      finishedAt,
      exitCode: result.exitCode,
      output: result.output,
      errorOutput: result.errorOutput,
      strategy: installPlan.strategy,
      errorCode,
      nextSteps,
      manualRequired: !ok && errorCode === 'privilege_required',
      timedOut: result.timedOut
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
      errorOutput: 'Instalacao automatica no Windows ainda nao implementada.',
      timedOut: false
    };
  }

  return runCommand('bash', ['-lc', command], timeoutMs);
}

async function runPkexecCommand(
  command: string,
  timeoutMs: number,
  platform: NodeJS.Platform = process.platform
): Promise<ShellResult> {
  if (platform !== 'linux') {
    return runShell(command, timeoutMs, platform);
  }

  return runCommand('pkexec', ['bash', '-lc', command], timeoutMs);
}

async function runCommand(commandName: string, args: string[], timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += String(chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500);
    }, timeoutMs);

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        output,
        errorOutput,
        timedOut
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        output,
        errorOutput: `${errorOutput}\n${error.message}`.trim(),
        timedOut
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

function buildRuntimeInstallPlan(
  platform: NodeJS.Platform,
  command: string
):
  | { ok: true; runner: 'shell' | 'pkexec'; strategy: RuntimeInstallStrategy }
  | { ok: false; result: Omit<RuntimeInstallResult, 'startedAt' | 'finishedAt'> } {
  if (platform === 'win32') {
    return {
      ok: false,
      result: {
        ok: false,
        command,
        exitCode: null,
        output: '',
        errorOutput: 'Instalacao automatica no Windows ainda nao implementada nesta fase.',
        strategy: 'win32-manual',
        errorCode: 'not_implemented',
        manualRequired: true,
        nextSteps: [
          'Use o comando sugerido no terminal/PowerShell com permissao administrativa.',
          `Comando sugerido: ${command}`
        ],
        timedOut: false
      }
    };
  }

  if (platform === 'linux') {
    const missingTools = ['bash', 'curl'].filter((tool) => !probeCommand(tool, platform));
    if (missingTools.length > 0) {
      return {
        ok: false,
        result: {
          ok: false,
          command,
          exitCode: null,
          output: '',
          errorOutput: `Dependencias ausentes para instalacao assistida: ${missingTools.join(', ')}.`,
          strategy: 'linux-assist',
          errorCode: 'missing_dependency',
          manualRequired: true,
          nextSteps: [
            `Instale primeiro: ${missingTools.join(', ')}.`,
            `Depois execute manualmente no terminal: ${command}`
          ],
          timedOut: false
        }
      };
    }

    if (probeCommand('pkexec', platform) && hasDesktopPrivilegePrompt()) {
      return {
        ok: true,
        runner: 'pkexec',
        strategy: 'linux-pkexec'
      };
    }

    return {
      ok: false,
      result: {
        ok: false,
        command,
        exitCode: null,
        output: '',
        errorOutput:
          'Instalacao automatica do runtime no Linux requer privilegios. Nao encontrei um prompt grafico de privilegio (pkexec) disponivel para este ambiente.',
        strategy: 'linux-assist',
        errorCode: 'privilege_required',
        manualRequired: true,
        nextSteps: [
          'Abra um terminal no sistema (fora do Dexter).',
          `Execute com privilegio de administrador: ${command}`,
          'Depois volte ao Dexter e use "Iniciar Runtime" ou valide com /health.'
        ],
        timedOut: false
      }
    };
  }

  return {
    ok: true,
    runner: 'shell',
    strategy: platform === 'darwin' ? 'darwin-shell' : 'unsupported'
  };
}

function classifyRuntimeInstallFailure(result: ShellResult): RuntimeInstallErrorCode {
  if (result.timedOut) {
    return 'timeout';
  }

  const output = `${result.output}\n${result.errorOutput}`.toLowerCase();
  if (
    output.includes('permission denied') ||
    output.includes('not authorized') ||
    output.includes('authentication is needed') ||
    output.includes('polkit') ||
    output.includes('sudo:')
  ) {
    return 'privilege_required';
  }

  if (result.exitCode === null) {
    return 'shell_spawn_error';
  }

  return 'command_failed';
}

function buildRuntimeInstallNextSteps(input: {
  platform: NodeJS.Platform;
  command: string;
  strategy: RuntimeInstallStrategy;
  errorCode?: RuntimeInstallErrorCode;
}): string[] {
  const steps = new Set<string>();

  if (input.errorCode === 'privilege_required' && input.platform === 'linux') {
    steps.add('A instalacao do Ollama no Linux normalmente exige privilegios de administrador.');
    steps.add('Abra um terminal no sistema e execute o comando manualmente com privilegio.');
  }

  if (input.errorCode === 'timeout') {
    steps.add('A instalacao demorou mais que o limite esperado. Verifique conectividade de rede e tente novamente.');
  }

  if (input.errorCode === 'shell_spawn_error') {
    steps.add('Falha ao iniciar o processo de instalacao. Verifique se `bash` esta disponivel no sistema.');
  }

  if (!steps.size && input.platform === 'linux') {
    steps.add('Tente executar o comando manualmente em um terminal para ver o prompt completo do sistema.');
  }

  steps.add(`Comando sugerido: ${input.command}`);
  steps.add('Depois valide no Dexter com "Iniciar Runtime" ou /health.');

  return [...steps];
}

function probeCommand(commandName: string, platform: NodeJS.Platform = process.platform): boolean {
  const resolver = platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(resolver, [commandName], {
      encoding: 'utf-8'
    }) as { status?: number | null } | undefined;
    return result?.status === 0;
  } catch {
    return false;
  }
}

function hasDesktopPrivilegePrompt(): boolean {
  if (typeof process.env.DISPLAY === 'string' || typeof process.env.WAYLAND_DISPLAY === 'string') {
    return true;
  }

  const sessionType = process.env.XDG_SESSION_TYPE?.trim().toLowerCase();
  return sessionType === 'x11' || sessionType === 'wayland';
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
