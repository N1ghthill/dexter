import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type {
  RuntimeInstallErrorCode,
  RuntimeInstallResult,
  RuntimeInstallStrategy,
  RuntimeStatus
} from '@shared/contracts';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { Logger } from '@main/services/logging/Logger';
import { fetchInstalledModels } from '@main/services/models/ollama-http';
import { buildCommandEnvironment, resolveCommandBinary } from '@main/services/environment/command-resolution';

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

interface LinuxPrivilegedHelperStatusProbe {
  configured: boolean;
  available: boolean;
  path: string | null;
  statusProbeOk: boolean;
  pkexecAvailable: boolean;
  desktopPrivilegePromptAvailable: boolean;
  sudoAvailable: boolean;
  privilegeEscalationReady: boolean;
  capabilities: {
    systemctl: boolean;
    service: boolean;
    curl: boolean;
  } | null;
  notes: string[];
}

interface RuntimeServiceOptions {
  linuxPrivilegedHelperPath?: string | null;
}

export class RuntimeService {
  private readonly linuxPrivilegedHelperPath: string | null;

  constructor(
    private readonly configStore: ConfigStore,
    private readonly logger: Logger,
    private readonly platform: NodeJS.Platform = process.platform,
    options?: RuntimeServiceOptions
  ) {
    this.linuxPrivilegedHelperPath = normalizeOptionalPath(options?.linuxPrivilegedHelperPath);
  }

  async status(): Promise<RuntimeStatus> {
    const config = this.configStore.get();
    const binary = probeOllamaBinary(this.platform);
    const installed = await fetchInstalledModels(config.endpoint);
    const reachable = installed.length > 0 || (await isEndpointReachable(config.endpoint));
    const helperProbe =
      this.platform === 'linux' ? await probeLinuxPrivilegedHelperStatus(this.linuxPrivilegedHelperPath, this.platform) : null;

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

    if (helperProbe) {
      notes.push(...helperProbe.notes);
    }

    return {
      endpoint: config.endpoint,
      binaryFound: binary.found,
      binaryPath: binary.path,
      ollamaReachable: reachable,
      installedModelCount: installed.length,
      suggestedInstallCommand: recommendedInstallCommand(this.platform),
      notes,
      ...(helperProbe ? { privilegedHelper: helperProbe } : {})
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

    const installPlan = buildRuntimeInstallPlan(this.platform, command, {
      linuxPrivilegedHelperPath: this.linuxPrivilegedHelperPath
    });
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
      installPlan.runner === 'pkexec-helper'
        ? await runPkexecHelperAction(this.platform, installPlan.helperPath ?? null, 'install-ollama', 20 * 60 * 1000)
        : installPlan.runner === 'pkexec'
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

    if (this.platform === 'linux' && this.canUseLinuxPrivilegedHelper()) {
      const helperStart = await runPkexecHelperAction(this.platform, this.linuxPrivilegedHelperPath, 'start-ollama-service', 90 * 1000);
      if (helperStart.exitCode === 0) {
        this.logger.info('runtime.start.helper.success', {
          strategy: 'linux-pkexec-helper',
          helperPath: this.linuxPrivilegedHelperPath
        });
        await waitMs(1600);
        return this.status();
      }

      this.logger.warn('runtime.start.helper.failed', {
        strategy: 'linux-pkexec-helper',
        helperPath: this.linuxPrivilegedHelperPath,
        exitCode: helperStart.exitCode,
        timedOut: helperStart.timedOut,
        errorCode: classifyRuntimeInstallFailure(helperStart)
      });
    }

    const host = endpointToOllamaHost(config.endpoint);

    try {
      const child = spawn(before.binaryPath ?? 'ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: buildCommandEnvironment(this.platform, {
          ...process.env,
          ...(host ? { OLLAMA_HOST: host } : {})
        })
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

  async repairRuntime(): Promise<RuntimeStatus> {
    const before = await this.status();
    const config = this.configStore.get();
    if (classifyEndpointScope(config.endpoint) === 'remote') {
      return withStatusNote(before, 'Reparo automatico desabilitado: endpoint configurado aponta para host remoto.');
    }

    if (this.platform === 'linux' && this.canUseLinuxPrivilegedHelper()) {
      const helperRestart = await runPkexecHelperAction(
        this.platform,
        this.linuxPrivilegedHelperPath,
        'restart-ollama-service',
        90 * 1000
      );

      if (helperRestart.exitCode === 0) {
        this.logger.info('runtime.repair.helper.success', {
          strategy: 'linux-pkexec-helper',
          helperPath: this.linuxPrivilegedHelperPath
        });
        await waitMs(1600);
        return this.status();
      }

      this.logger.warn('runtime.repair.helper.failed', {
        strategy: 'linux-pkexec-helper',
        helperPath: this.linuxPrivilegedHelperPath,
        exitCode: helperRestart.exitCode,
        timedOut: helperRestart.timedOut,
        errorCode: classifyRuntimeInstallFailure(helperRestart)
      });
    }

    return this.startRuntime();
  }

  private canUseLinuxPrivilegedHelper(): boolean {
    if (this.platform !== 'linux') {
      return false;
    }

    return describeLinuxPrivilegedHelperAvailability(this.linuxPrivilegedHelperPath) === 'available';
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
  const resolved = resolveCommandBinary('ollama', platform);
  return {
    found: resolved.found && Boolean(resolved.path),
    path: resolved.path
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

async function runPkexecHelperAction(
  platform: NodeJS.Platform,
  helperPath: string | null,
  action: 'install-ollama' | 'start-ollama-service' | 'restart-ollama-service',
  timeoutMs: number
): Promise<ShellResult> {
  if (platform !== 'linux') {
    return {
      exitCode: null,
      output: '',
      errorOutput: 'Helper privilegiado Linux indisponivel fora do Linux.',
      timedOut: false
    };
  }

  if (!helperPath || !existsSync(helperPath)) {
    return {
      exitCode: null,
      output: '',
      errorOutput: 'Helper privilegiado Linux nao encontrado no host.',
      timedOut: false
    };
  }

  return runCommand('pkexec', ['bash', helperPath, action], timeoutMs);
}

async function probeLinuxPrivilegedHelperStatus(
  helperPath: string | null,
  platform: NodeJS.Platform = process.platform
): Promise<LinuxPrivilegedHelperStatusProbe | null> {
  if (platform !== 'linux') {
    return null;
  }

  const pkexecAvailable = probeCommand('pkexec', platform);
  const sudoAvailable = probeCommand('sudo', platform);
  const desktopPrivilegePromptAvailable = hasDesktopPrivilegePrompt();
  const availability = describeLinuxPrivilegedHelperAvailability(helperPath);
  if (availability === 'none') {
    return {
      configured: false,
      available: false,
      path: null,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      privilegeEscalationReady: false,
      capabilities: null,
      notes: []
    };
  }

  if (availability === 'configured-missing') {
    return {
      configured: true,
      available: false,
      path: helperPath,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      privilegeEscalationReady: false,
      capabilities: null,
      notes: ['Helper privilegiado Linux configurado, mas arquivo nao foi encontrado no host.']
    };
  }

  const result = await runCommand('bash', [helperPath ?? '', 'status'], 1200);
  if (result.exitCode !== 0 || result.timedOut) {
    return {
      configured: true,
      available: true,
      path: helperPath,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      privilegeEscalationReady: pkexecAvailable && desktopPrivilegePromptAvailable,
      capabilities: null,
      notes: [
        'Helper privilegiado Linux disponivel (pkexec) para instalacao/inicio assistido.',
        'Nao foi possivel ler capacidades do helper agora.'
      ]
    };
  }

  const parsed = parseLinuxPrivilegedHelperStatusPayload(result.output);
  if (!parsed) {
    return {
      configured: true,
      available: true,
      path: helperPath,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      privilegeEscalationReady: pkexecAvailable && desktopPrivilegePromptAvailable,
      capabilities: null,
      notes: [
        'Helper privilegiado Linux disponivel (pkexec) para instalacao/inicio assistido.',
        'Resposta de status do helper nao foi reconhecida.'
      ]
    };
  }

  const capabilityNotes = buildHelperCapabilityNotes(parsed.capabilities);
  return {
    configured: true,
    available: true,
    path: helperPath,
    statusProbeOk: true,
    pkexecAvailable,
    desktopPrivilegePromptAvailable,
    sudoAvailable,
    privilegeEscalationReady: pkexecAvailable && desktopPrivilegePromptAvailable,
    capabilities: parsed.capabilities,
    notes: ['Helper privilegiado Linux disponivel (pkexec) para instalacao/inicio assistido.', ...capabilityNotes]
  };
}

function parseLinuxPrivilegedHelperStatusPayload(
  output: string
): { helperName: string; capabilities: { systemctl: boolean; service: boolean; curl: boolean } } | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      helper?: unknown;
      systemctl?: unknown;
      service?: unknown;
      curl?: unknown;
    };

    if (
      typeof parsed.helper !== 'string' ||
      typeof parsed.systemctl !== 'boolean' ||
      typeof parsed.service !== 'boolean' ||
      typeof parsed.curl !== 'boolean'
    ) {
      return null;
    }

    return {
      helperName: parsed.helper,
      capabilities: {
        systemctl: parsed.systemctl,
        service: parsed.service,
        curl: parsed.curl
      }
    };
  } catch {
    return null;
  }
}

function buildHelperCapabilityNotes(capabilities: {
  systemctl: boolean;
  service: boolean;
  curl: boolean;
}): string[] {
  const serviceManager = capabilities.systemctl ? 'systemctl' : capabilities.service ? 'service' : 'nenhum';
  return [
    `Helper Linux: service manager ${serviceManager}; curl ${capabilities.curl ? 'ok' : 'ausente'}.`
  ];
}

async function runCommand(commandName: string, args: string[], timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildCommandEnvironment()
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
  command: string,
  options?: { linuxPrivilegedHelperPath?: string | null }
):
  | { ok: true; runner: 'shell' | 'pkexec' | 'pkexec-helper'; strategy: RuntimeInstallStrategy; helperPath?: string }
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

    const helperPath = normalizeOptionalPath(options?.linuxPrivilegedHelperPath);
    const helperAvailable = describeLinuxPrivilegedHelperAvailability(helperPath) === 'available';

    if (helperAvailable && probeCommand('pkexec', platform) && hasDesktopPrivilegePrompt()) {
      return {
        ok: true,
        runner: 'pkexec-helper',
        strategy: 'linux-pkexec-helper',
        helperPath: helperPath ?? undefined
      };
    }

    if (probeCommand('pkexec', platform) && hasDesktopPrivilegePrompt()) {
      return {
        ok: true,
        runner: 'pkexec',
        strategy: 'linux-pkexec'
      };
    }

    const privilegedCommand = buildLinuxPrivilegedInstallCommand(command, platform);

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
          ...(privilegedCommand ? [`Exemplo com sudo: ${privilegedCommand}`] : []),
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
    const privilegedCommand = buildLinuxPrivilegedInstallCommand(input.command, input.platform);
    if (privilegedCommand) {
      steps.add(`Exemplo com sudo: ${privilegedCommand}`);
    }
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
  return resolveCommandBinary(commandName, platform).found;
}

function normalizeOptionalPath(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function describeLinuxPrivilegedHelperAvailability(
  helperPath: string | null
): 'none' | 'available' | 'configured-missing' {
  if (!helperPath) {
    return 'none';
  }

  return existsSync(helperPath) ? 'available' : 'configured-missing';
}

function buildLinuxPrivilegedInstallCommand(
  command: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform !== 'linux' || !command.trim()) {
    return null;
  }

  if (!probeCommand('sudo', platform)) {
    return null;
  }

  if (command === 'curl -fsSL https://ollama.com/install.sh | sh') {
    return 'curl -fsSL https://ollama.com/install.sh | sudo sh';
  }

  return `sudo bash -lc '${command.replace(/'/g, "'\\''")}'`;
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
