import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type {
  RuntimeInstallErrorCode,
  RuntimeInstallProgressEvent,
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
  sudoNonInteractiveAvailable: boolean;
  sudoRequiresTty: boolean;
  sudoPolicyDenied: boolean;
  privilegeEscalationReady: boolean;
  agentOperationalMode: 'pkexec' | 'sudo-noninteractive' | 'sudo-terminal' | 'none';
  agentOperationalLevel: 'automated' | 'assisted' | 'blocked';
  agentOperationalReady: boolean;
  agentOperationalReason: string;
  capabilities: {
    systemctl: boolean;
    service: boolean;
    curl: boolean;
  } | null;
  notes: string[];
}

interface LinuxSudoProbe {
  nonInteractiveAvailable: boolean;
  requiresTty: boolean;
  policyDenied: boolean;
}

interface LinuxAgentOperationalState {
  privilegeEscalationReady: boolean;
  mode: LinuxPrivilegedHelperStatusProbe['agentOperationalMode'];
  level: LinuxPrivilegedHelperStatusProbe['agentOperationalLevel'];
  ready: boolean;
  reason: string;
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

  async installRuntime(onProgress?: (event: RuntimeInstallProgressEvent) => void): Promise<RuntimeInstallResult> {
    const command = recommendedInstallCommand(this.platform);
    const startedAt = new Date().toISOString();

    emitRuntimeInstallProgress(onProgress, {
      phase: 'start',
      percent: 0,
      message: 'Iniciando instalacao do runtime local.',
      timestamp: startedAt
    });

    if (!command) {
      emitRuntimeInstallProgress(onProgress, {
        phase: 'error',
        percent: null,
        message: 'Plataforma sem instalador automatizado nesta fase.',
        timestamp: new Date().toISOString()
      });
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
      emitRuntimeInstallProgress(onProgress, {
        phase: 'error',
        percent: null,
        message: installPlan.result.errorOutput || 'Nao foi possivel iniciar instalacao assistida.',
        timestamp: new Date().toISOString()
      });
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
        ? await runPkexecHelperAction(
            this.platform,
            installPlan.helperPath ?? null,
            'install-ollama',
            20 * 60 * 1000,
            createRuntimeInstallProgressLineHandler(onProgress)
          )
        : installPlan.runner === 'pkexec'
        ? await runPkexecCommand(command, 20 * 60 * 1000, this.platform, createRuntimeInstallProgressLineHandler(onProgress))
        : installPlan.runner === 'sudo-noninteractive'
        ? await runSudoNonInteractiveCommand(
            command,
            20 * 60 * 1000,
            this.platform,
            createRuntimeInstallProgressLineHandler(onProgress)
          )
        : await runShell(command, 20 * 60 * 1000, this.platform, createRuntimeInstallProgressLineHandler(onProgress));
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

    emitRuntimeInstallProgress(onProgress, {
      phase: ok ? 'done' : 'error',
      percent: ok ? 100 : null,
      message: ok ? 'Instalacao do runtime concluida.' : 'Instalacao do runtime falhou.',
      timestamp: finishedAt
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
      manualRequired: !ok && isPrivilegeInteractiveFallbackError(errorCode),
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

    if (this.platform === 'linux' && before.privilegedHelper?.sudoAvailable && !before.privilegedHelper.sudoPolicyDenied) {
      const sudoStart = await runLinuxServiceManagerWithSudo('start', 45 * 1000, this.platform);
      if (sudoStart.result.exitCode === 0) {
        this.logger.info('runtime.start.sudo.success', {
          strategy: 'linux-sudo-noninteractive'
        });
        await waitMs(1600);
        return this.status();
      }

      if (sudoStart.attempted) {
        this.logger.warn('runtime.start.sudo.failed', {
          strategy: 'linux-sudo-noninteractive',
          exitCode: sudoStart.result.exitCode,
          timedOut: sudoStart.result.timedOut,
          errorCode: classifyRuntimeInstallFailure(sudoStart.result)
        });
      }
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

    if (this.platform === 'linux' && before.privilegedHelper?.sudoAvailable && !before.privilegedHelper.sudoPolicyDenied) {
      const sudoRestart = await runLinuxServiceManagerWithSudo('restart', 45 * 1000, this.platform);
      if (sudoRestart.result.exitCode === 0) {
        this.logger.info('runtime.repair.sudo.success', {
          strategy: 'linux-sudo-noninteractive'
        });
        await waitMs(1600);
        return this.status();
      }

      if (sudoRestart.attempted) {
        this.logger.warn('runtime.repair.sudo.failed', {
          strategy: 'linux-sudo-noninteractive',
          exitCode: sudoRestart.result.exitCode,
          timedOut: sudoRestart.result.timedOut,
          errorCode: classifyRuntimeInstallFailure(sudoRestart.result)
        });
      }
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

async function runShell(
  command: string,
  timeoutMs: number,
  platform: NodeJS.Platform = process.platform,
  onLine?: (line: string) => void
): Promise<ShellResult> {
  if (platform === 'win32') {
    return {
      exitCode: null,
      output: '',
      errorOutput: 'Instalacao automatica no Windows ainda nao implementada.',
      timedOut: false
    };
  }

  return runCommand('bash', ['-lc', command], timeoutMs, onLine);
}

async function runPkexecCommand(
  command: string,
  timeoutMs: number,
  platform: NodeJS.Platform = process.platform,
  onLine?: (line: string) => void
): Promise<ShellResult> {
  if (platform !== 'linux') {
    return runShell(command, timeoutMs, platform, onLine);
  }

  return runCommand('pkexec', ['bash', '-lc', command], timeoutMs, onLine);
}

async function runSudoNonInteractiveCommand(
  command: string,
  timeoutMs: number,
  platform: NodeJS.Platform = process.platform,
  onLine?: (line: string) => void
): Promise<ShellResult> {
  if (platform !== 'linux') {
    return runShell(command, timeoutMs, platform, onLine);
  }

  return runCommand('sudo', ['-n', 'bash', '-lc', command], timeoutMs, onLine);
}

async function runPkexecHelperAction(
  platform: NodeJS.Platform,
  helperPath: string | null,
  action: 'install-ollama' | 'start-ollama-service' | 'restart-ollama-service',
  timeoutMs: number,
  onLine?: (line: string) => void
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

  return runCommand('pkexec', ['bash', helperPath, action], timeoutMs, onLine);
}

async function runLinuxServiceManagerWithSudo(
  action: 'start' | 'restart',
  timeoutMs: number,
  platform: NodeJS.Platform = process.platform
): Promise<{ attempted: boolean; result: ShellResult }> {
  const command = buildLinuxServiceManagerCommand(action, platform);
  if (!command || !probeCommand('sudo', platform)) {
    return {
      attempted: false,
      result: {
        exitCode: null,
        output: '',
        errorOutput: 'sudo/service-manager indisponivel para este ambiente.',
        timedOut: false
      }
    };
  }

  const result = await runSudoNonInteractiveCommand(command, timeoutMs, platform);
  return {
    attempted: true,
    result
  };
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
  const sudoProbe = sudoAvailable
    ? await probeLinuxSudoPrivileges(platform)
    : {
        nonInteractiveAvailable: false,
        requiresTty: false,
        policyDenied: false
      };
  const agentState = computeLinuxAgentOperationalState({
    pkexecAvailable,
    desktopPrivilegePromptAvailable,
    sudoAvailable,
    sudoProbe
  });
  const agentNotes = buildLinuxAgentOperationalNotes(agentState, sudoProbe);
  const availability = describeLinuxPrivilegedHelperAvailability(helperPath);
  if (availability === 'none') {
    return buildLinuxPrivilegedHelperStatus({
      configured: false,
      available: false,
      path: null,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      sudoProbe,
      agentState,
      capabilities: null,
      notes: [...agentNotes]
    });
  }

  if (availability === 'configured-missing') {
    return buildLinuxPrivilegedHelperStatus({
      configured: true,
      available: false,
      path: helperPath,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      sudoProbe,
      agentState,
      capabilities: null,
      notes: ['Helper privilegiado Linux configurado, mas arquivo nao foi encontrado no host.', ...agentNotes]
    });
  }

  const result = await runCommand('bash', [helperPath ?? '', 'status'], 1200);
  if (result.exitCode !== 0 || result.timedOut) {
    return buildLinuxPrivilegedHelperStatus({
      configured: true,
      available: true,
      path: helperPath,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      sudoProbe,
      agentState,
      capabilities: null,
      notes: [
        'Helper privilegiado Linux disponivel (pkexec) para instalacao/inicio assistido.',
        'Nao foi possivel ler capacidades do helper agora.',
        ...agentNotes
      ]
    });
  }

  const parsed = parseLinuxPrivilegedHelperStatusPayload(result.output);
  if (!parsed) {
    return buildLinuxPrivilegedHelperStatus({
      configured: true,
      available: true,
      path: helperPath,
      statusProbeOk: false,
      pkexecAvailable,
      desktopPrivilegePromptAvailable,
      sudoAvailable,
      sudoProbe,
      agentState,
      capabilities: null,
      notes: [
        'Helper privilegiado Linux disponivel (pkexec) para instalacao/inicio assistido.',
        'Resposta de status do helper nao foi reconhecida.',
        ...agentNotes
      ]
    });
  }

  const capabilityNotes = buildHelperCapabilityNotes(parsed.capabilities);
  return buildLinuxPrivilegedHelperStatus({
    configured: true,
    available: true,
    path: helperPath,
    statusProbeOk: true,
    pkexecAvailable,
    desktopPrivilegePromptAvailable,
    sudoAvailable,
    sudoProbe,
    agentState,
    capabilities: parsed.capabilities,
    notes: ['Helper privilegiado Linux disponivel (pkexec) para instalacao/inicio assistido.', ...capabilityNotes, ...agentNotes]
  });
}

function buildLinuxPrivilegedHelperStatus(input: {
  configured: boolean;
  available: boolean;
  path: string | null;
  statusProbeOk: boolean;
  pkexecAvailable: boolean;
  desktopPrivilegePromptAvailable: boolean;
  sudoAvailable: boolean;
  sudoProbe: LinuxSudoProbe;
  agentState: LinuxAgentOperationalState;
  capabilities: LinuxPrivilegedHelperStatusProbe['capabilities'];
  notes: string[];
}): LinuxPrivilegedHelperStatusProbe {
  return {
    configured: input.configured,
    available: input.available,
    path: input.path,
    statusProbeOk: input.statusProbeOk,
    pkexecAvailable: input.pkexecAvailable,
    desktopPrivilegePromptAvailable: input.desktopPrivilegePromptAvailable,
    sudoAvailable: input.sudoAvailable,
    sudoNonInteractiveAvailable: input.sudoProbe.nonInteractiveAvailable,
    sudoRequiresTty: input.sudoProbe.requiresTty,
    sudoPolicyDenied: input.sudoProbe.policyDenied,
    privilegeEscalationReady: input.agentState.privilegeEscalationReady,
    agentOperationalMode: input.agentState.mode,
    agentOperationalLevel: input.agentState.level,
    agentOperationalReady: input.agentState.ready,
    agentOperationalReason: input.agentState.reason,
    capabilities: input.capabilities,
    notes: input.notes
  };
}

async function probeLinuxSudoPrivileges(platform: NodeJS.Platform = process.platform): Promise<LinuxSudoProbe> {
  if (platform !== 'linux' || !probeCommand('sudo', platform)) {
    return {
      nonInteractiveAvailable: false,
      requiresTty: false,
      policyDenied: false
    };
  }

  const result = await runCommand('sudo', ['-n', 'true'], 1200);
  if (result.exitCode === 0) {
    return {
      nonInteractiveAvailable: true,
      requiresTty: false,
      policyDenied: false
    };
  }

  const output = `${result.output}\n${result.errorOutput}`.toLowerCase();
  const policyDenied =
    output.includes('not in the sudoers') ||
    output.includes('is not allowed to run sudo') ||
    output.includes('may not run sudo');
  const requiresTty =
    !policyDenied &&
    (output.includes('a terminal is required') ||
      output.includes('no tty present') ||
      output.includes('a password is required') ||
      output.includes('askpass'));

  return {
    nonInteractiveAvailable: false,
    requiresTty,
    policyDenied
  };
}

function computeLinuxAgentOperationalState(input: {
  pkexecAvailable: boolean;
  desktopPrivilegePromptAvailable: boolean;
  sudoAvailable: boolean;
  sudoProbe: LinuxSudoProbe;
}): LinuxAgentOperationalState {
  if (input.pkexecAvailable && input.desktopPrivilegePromptAvailable) {
    return {
      privilegeEscalationReady: true,
      mode: 'pkexec',
      level: 'automated',
      ready: true,
      reason: 'Fluxo GUI via PolicyKit (pkexec) pronto para automacao privilegiada.'
    };
  }

  if (input.sudoAvailable && input.sudoProbe.nonInteractiveAvailable) {
    return {
      privilegeEscalationReady: true,
      mode: 'sudo-noninteractive',
      level: 'automated',
      ready: true,
      reason: 'Fluxo sudo nao interativo (NOPASSWD) disponivel para automacao.'
    };
  }

  if (input.sudoAvailable && !input.sudoProbe.policyDenied) {
    return {
      privilegeEscalationReady: false,
      mode: 'sudo-terminal',
      level: 'assisted',
      ready: true,
      reason: 'Fluxo sudo disponivel apenas via terminal interativo (TTY/senha).'
    };
  }

  if (input.sudoProbe.policyDenied) {
    return {
      privilegeEscalationReady: false,
      mode: 'none',
      level: 'blocked',
      ready: false,
      reason: 'Usuario local sem permissao sudo neste host.'
    };
  }

  return {
    privilegeEscalationReady: false,
    mode: 'none',
    level: 'blocked',
    ready: false,
    reason: 'Nenhum caminho de elevacao detectado (pkexec/sudo).'
  };
}

function buildLinuxAgentOperationalNotes(state: LinuxAgentOperationalState, sudoProbe: LinuxSudoProbe): string[] {
  const notes = [
    `Modo operacional Linux: ${state.mode} (${state.level}).`,
    state.reason
  ];

  if (sudoProbe.nonInteractiveAvailable) {
    notes.push('sudo -n validado: automacao privilegiada sem prompt interativo disponivel.');
  } else if (sudoProbe.policyDenied) {
    notes.push('sudo detectado, mas politica local bloqueia este usuario.');
  } else if (sudoProbe.requiresTty) {
    notes.push('sudo detectado, mas exige terminal interativo para autenticacao.');
  }

  return notes;
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

async function runCommand(
  commandName: string,
  args: string[],
  timeoutMs: number,
  onLine?: (line: string) => void
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildCommandEnvironment()
    });

    let output = '';
    let errorOutput = '';
    let timedOut = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      output += text;
      stdoutBuffer = streamLines(text, stdoutBuffer, onLine);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      errorOutput += text;
      stderrBuffer = streamLines(text, stderrBuffer, onLine);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500);
    }, timeoutMs);

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      flushLineBuffer(stdoutBuffer, onLine);
      flushLineBuffer(stderrBuffer, onLine);
      resolve({
        exitCode,
        output,
        errorOutput,
        timedOut
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      flushLineBuffer(stdoutBuffer, onLine);
      flushLineBuffer(stderrBuffer, onLine);
      resolve({
        exitCode: null,
        output,
        errorOutput: `${errorOutput}\n${error.message}`.trim(),
        timedOut
      });
    });
  });
}

function createRuntimeInstallProgressLineHandler(
  onProgress?: (event: RuntimeInstallProgressEvent) => void
): ((line: string) => void) | undefined {
  if (!onProgress) {
    return undefined;
  }

  return (line: string) => {
    emitRuntimeInstallProgress(onProgress, {
      phase: 'progress',
      percent: extractPercent(line),
      message: line,
      timestamp: new Date().toISOString()
    });
  };
}

function emitRuntimeInstallProgress(
  onProgress: ((event: RuntimeInstallProgressEvent) => void) | undefined,
  event: RuntimeInstallProgressEvent
): void {
  onProgress?.(event);
}

function streamLines(chunk: string, buffer: string, onLine?: (line: string) => void): string {
  const merged = `${buffer}${chunk.replace(/\r/g, '\n')}`;
  const parts = merged.split('\n');
  const tail = parts.pop() as string;

  if (onLine) {
    for (const part of parts) {
      const line = sanitizeProgressLine(part);
      if (line) {
        onLine(line);
      }
    }
  }

  return tail;
}

function flushLineBuffer(buffer: string, onLine?: (line: string) => void): void {
  const line = sanitizeProgressLine(buffer);
  if (line && onLine) {
    onLine(line);
  }
}

function sanitizeProgressLine(line: string): string {
  const withoutAnsi = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b/g, '');
  const withoutControl = withoutAnsi.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, '');
  return withoutControl.replace(/\s+/g, ' ').trim();
}

function extractPercent(text: string): number | null {
  const match = text
    .replace(',', '.')
    .match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]!);
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
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
  | {
      ok: true;
      runner: 'shell' | 'pkexec' | 'pkexec-helper' | 'sudo-noninteractive';
      strategy: RuntimeInstallStrategy;
      helperPath?: string;
    }
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

    if (probeCommand('sudo', platform)) {
      return {
        ok: true,
        runner: 'sudo-noninteractive',
        strategy: 'linux-sudo-noninteractive'
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
    output.includes('not in the sudoers') ||
    output.includes('is not allowed to run sudo') ||
    output.includes('may not run sudo')
  ) {
    return 'sudo_policy_denied';
  }

  if (
    output.includes('a terminal is required') ||
    output.includes('no tty present') ||
    output.includes('a password is required') ||
    output.includes('askpass')
  ) {
    return 'sudo_tty_required';
  }

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

  if (input.errorCode === 'sudo_tty_required' && input.platform === 'linux') {
    steps.add('O sudo deste ambiente exige terminal interativo (TTY/senha).');
    steps.add('Abra um terminal no host local e execute o comando com privilegio manualmente.');
    const privilegedCommand = buildLinuxPrivilegedInstallCommand(input.command, input.platform);
    if (privilegedCommand) {
      steps.add(`Exemplo no terminal: ${privilegedCommand}`);
    }
  }

  if (input.errorCode === 'sudo_policy_denied' && input.platform === 'linux') {
    steps.add('Usuario local sem permissao sudo para concluir esta instalacao.');
    steps.add('Use uma conta administrativa, ajuste sudoers/polkit ou execute o setup com suporte do administrador do host.');
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

function isPrivilegeInteractiveFallbackError(errorCode: RuntimeInstallErrorCode | undefined): boolean {
  return errorCode === 'privilege_required' || errorCode === 'sudo_tty_required' || errorCode === 'sudo_policy_denied';
}

function probeCommand(commandName: string, platform: NodeJS.Platform = process.platform): boolean {
  const resolved = resolveCommandBinary(commandName, platform);
  if (!resolved.found || !resolved.path) {
    return false;
  }

  return binaryPathMatchesCommand(resolved.path, commandName, platform);
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

function buildLinuxServiceManagerCommand(
  action: 'start' | 'restart',
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform !== 'linux') {
    return null;
  }

  if (probeCommand('systemctl', platform)) {
    return `systemctl ${action} ollama`;
  }

  if (probeCommand('service', platform)) {
    return `service ollama ${action}`;
  }

  return null;
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

function binaryPathMatchesCommand(binaryPath: string, commandName: string, platform: NodeJS.Platform): boolean {
  const normalizedName = commandName.trim().toLowerCase();
  if (!normalizedName) {
    return false;
  }

  const fileName = binaryPath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (!fileName) {
    return false;
  }

  if (platform === 'win32') {
    const withoutExt = fileName.replace(/\.(exe|cmd|bat|ps1)$/i, '');
    return withoutExt === normalizedName;
  }

  return fileName === normalizedName;
}
