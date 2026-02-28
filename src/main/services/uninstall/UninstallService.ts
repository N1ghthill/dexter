import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  UNINSTALL_CONFIRMATION_TOKEN,
  type UninstallErrorCode,
  type UninstallPackageMode,
  type UninstallRequest,
  type UninstallResult,
  type UninstallStrategy
} from '@shared/contracts';
import { Logger } from '@main/services/logging/Logger';
import { buildCommandEnvironment, resolveCommandBinary } from '@main/services/environment/command-resolution';

interface ShellResult {
  exitCode: number | null;
  output: string;
  errorOutput: string;
  timedOut: boolean;
}

type HelperAction = 'uninstall-dexter-remove' | 'uninstall-dexter-purge' | 'uninstall-ollama-system';
type PrivilegedRunner = 'pkexec-helper' | 'pkexec' | 'sudo-noninteractive';

type RunCommandFn = (commandName: string, args: string[], timeoutMs: number) => Promise<ShellResult>;
type ProbeCommandFn = (commandName: string, platform: NodeJS.Platform) => boolean;

type NormalizedUninstallRequest = {
  packageMode: UninstallPackageMode;
  removeUserData: boolean;
  removeRuntimeSystem: boolean;
  removeRuntimeUserData: boolean;
  confirmationToken: string;
};

interface PrivilegedActionPlan {
  helperAction: HelperAction;
  shellCommand: string;
}

interface UninstallPlanSuccess {
  ok: true;
  strategy: UninstallStrategy;
  runner: PrivilegedRunner;
  helperPath?: string;
}

interface UninstallPlanFailure {
  ok: false;
  strategy: UninstallStrategy;
  errorCode: UninstallErrorCode;
  errorOutput: string;
  nextSteps: string[];
  manualRequired: boolean;
}

interface UninstallServiceOptions {
  linuxPrivilegedHelperPath?: string | null;
  userHomeDir?: string;
  userDataPaths?: string[];
  runCommand?: RunCommandFn;
  probeCommand?: ProbeCommandFn;
  pathExists?: (targetPath: string) => boolean;
  removePathRecursively?: (targetPath: string) => void;
  hasDesktopPrivilegePrompt?: () => boolean;
}

export class UninstallService {
  private readonly linuxPrivilegedHelperPath: string | null;
  private readonly userHomeDir: string;
  private readonly configuredUserDataPaths: string[];
  private readonly runCommandFn: RunCommandFn;
  private readonly probeCommandFn: ProbeCommandFn;
  private readonly pathExistsFn: (targetPath: string) => boolean;
  private readonly removePathRecursivelyFn: (targetPath: string) => void;
  private readonly hasDesktopPrivilegePromptFn: () => boolean;

  constructor(
    private readonly logger: Logger,
    private readonly platform: NodeJS.Platform = process.platform,
    options?: UninstallServiceOptions
  ) {
    this.linuxPrivilegedHelperPath = normalizeOptionalPath(options?.linuxPrivilegedHelperPath);
    this.userHomeDir = normalizeOptionalPath(options?.userHomeDir) ?? os.homedir();
    this.configuredUserDataPaths = normalizePathList(options?.userDataPaths ?? []);
    this.runCommandFn = options?.runCommand ?? runCommand;
    this.probeCommandFn =
      options?.probeCommand ??
      ((commandName: string, platform: NodeJS.Platform) => {
        const resolved = resolveCommandBinary(commandName, platform);
        return resolved.found && typeof resolved.path === 'string' && resolved.path.trim().length > 0;
      });
    this.pathExistsFn = options?.pathExists ?? fs.existsSync;
    this.removePathRecursivelyFn =
      options?.removePathRecursively ??
      ((targetPath: string) => {
        fs.rmSync(targetPath, {
          recursive: true,
          force: true,
          maxRetries: 2,
          retryDelay: 80
        });
      });
    this.hasDesktopPrivilegePromptFn = options?.hasDesktopPrivilegePrompt ?? hasDesktopPrivilegePrompt;
  }

  async uninstall(request: UninstallRequest): Promise<UninstallResult> {
    const startedAt = new Date().toISOString();
    const normalized = normalizeRequest(request);
    const performed = buildPerformedSummary(normalized);

    if (normalized.confirmationToken !== UNINSTALL_CONFIRMATION_TOKEN) {
      return {
        ok: false,
        command: '',
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: null,
        output: '',
        errorOutput: 'Token de confirmacao invalido para desinstalacao.',
        strategy: this.platform === 'linux' ? 'linux-assist' : 'unsupported',
        errorCode: 'invalid_confirmation',
        manualRequired: false,
        nextSteps: [
          `Digite exatamente o token de confirmacao: ${UNINSTALL_CONFIRMATION_TOKEN}.`,
          'Revise os escopos selecionados antes de confirmar novamente.'
        ],
        performed
      };
    }

    if (this.platform !== 'linux') {
      return {
        ok: false,
        command: '',
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: null,
        output: '',
        errorOutput: 'Fluxo de uninstall automatizado disponivel apenas em Linux nesta fase.',
        strategy: 'unsupported',
        errorCode: 'unsupported_platform',
        manualRequired: true,
        nextSteps: buildManualUninstallSteps(normalized),
        performed
      };
    }

    const privilegedActions = buildPrivilegedActionPlan(normalized);
    const plan = this.buildUninstallPlan(privilegedActions);
    const command = describeUninstallCommand(
      privilegedActions,
      normalized,
      plan.ok && plan.runner === 'pkexec-helper' ? this.linuxPrivilegedHelperPath : null
    );
    if (!plan.ok) {
      return {
        ok: false,
        command,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: null,
        output: '',
        errorOutput: plan.errorOutput,
        strategy: plan.strategy,
        errorCode: plan.errorCode,
        manualRequired: plan.manualRequired,
        nextSteps: plan.nextSteps,
        performed
      };
    }

    this.logger.warn('app.uninstall.start', {
      strategy: plan.strategy,
      packageMode: normalized.packageMode,
      removeRuntimeSystem: normalized.removeRuntimeSystem,
      removeRuntimeUserData: normalized.removeRuntimeUserData,
      removeUserData: normalized.removeUserData
    });

    const privilegedResult = await this.runPrivilegedActions(plan, privilegedActions);
    if (privilegedResult.exitCode !== 0 || privilegedResult.timedOut) {
      const errorCode = classifyUninstallFailure(privilegedResult);
      const finishedAt = new Date().toISOString();
      this.logger.error('app.uninstall.failed', {
        strategy: plan.strategy,
        errorCode,
        exitCode: privilegedResult.exitCode,
        timedOut: privilegedResult.timedOut
      });

      return {
        ok: false,
        command,
        startedAt,
        finishedAt,
        exitCode: privilegedResult.exitCode,
        output: privilegedResult.output,
        errorOutput: privilegedResult.errorOutput,
        strategy: plan.strategy,
        errorCode,
        manualRequired: isPrivilegeInteractiveFallbackError(errorCode),
        timedOut: privilegedResult.timedOut,
        nextSteps: buildUninstallNextSteps(normalized, errorCode),
        performed
      };
    }

    const warnings = this.runOptionalLocalCleanup(normalized);
    const finishedAt = new Date().toISOString();

    this.logger.warn('app.uninstall.finish', {
      strategy: plan.strategy,
      warnings: warnings.length,
      packageMode: normalized.packageMode,
      removeRuntimeSystem: normalized.removeRuntimeSystem,
      removeRuntimeUserData: normalized.removeRuntimeUserData,
      removeUserData: normalized.removeUserData
    });

    const nextSteps = warnings.length > 0 ? buildUninstallWarningNextSteps(warnings) : undefined;

    return {
      ok: true,
      command,
      startedAt,
      finishedAt,
      exitCode: privilegedResult.exitCode,
      output: privilegedResult.output,
      errorOutput: privilegedResult.errorOutput,
      strategy: plan.strategy,
      manualRequired: false,
      timedOut: false,
      nextSteps,
      warnings: warnings.length > 0 ? warnings : undefined,
      performed
    };
  }

  private buildUninstallPlan(privilegedActions: PrivilegedActionPlan[]): UninstallPlanSuccess | UninstallPlanFailure {
    if (privilegedActions.length === 0) {
      return {
        ok: true,
        strategy: 'linux-assist',
        runner: 'sudo-noninteractive'
      };
    }

    const helperPath = this.linuxPrivilegedHelperPath;
    const helperAvailable = Boolean(helperPath && this.pathExistsFn(helperPath));
    const pkexecAvailable = this.probeCommandFn('pkexec', this.platform);

    if (helperAvailable && pkexecAvailable && this.hasDesktopPrivilegePromptFn()) {
      return {
        ok: true,
        strategy: 'linux-pkexec-helper',
        runner: 'pkexec-helper',
        helperPath: helperPath ?? undefined
      };
    }

    if (pkexecAvailable && this.hasDesktopPrivilegePromptFn()) {
      if (!this.probeCommandFn('apt-get', this.platform)) {
        return {
          ok: false,
          strategy: 'linux-assist',
          errorCode: 'missing_dependency',
          errorOutput: 'Dependencia ausente: apt-get nao encontrado no host Linux.',
          manualRequired: true,
          nextSteps: buildUninstallNextSteps(
            {
              packageMode: 'remove',
              removeRuntimeSystem: true,
              removeRuntimeUserData: true,
              removeUserData: true
            },
            'missing_dependency'
          )
        };
      }

      return {
        ok: true,
        strategy: 'linux-pkexec',
        runner: 'pkexec'
      };
    }

    if (this.probeCommandFn('sudo', this.platform)) {
      if (!this.probeCommandFn('apt-get', this.platform)) {
        return {
          ok: false,
          strategy: 'linux-assist',
          errorCode: 'missing_dependency',
          errorOutput: 'Dependencia ausente: apt-get nao encontrado no host Linux.',
          manualRequired: true,
          nextSteps: buildUninstallNextSteps(
            {
              packageMode: 'remove',
              removeRuntimeSystem: true,
              removeRuntimeUserData: true,
              removeUserData: true
            },
            'missing_dependency'
          )
        };
      }

      return {
        ok: true,
        strategy: 'linux-sudo-noninteractive',
        runner: 'sudo-noninteractive'
      };
    }

    return {
      ok: false,
      strategy: 'linux-assist',
      errorCode: 'privilege_required',
      errorOutput: 'Sem caminho automatizado de privilegio detectado (pkexec/sudo).',
      manualRequired: true,
      nextSteps: buildUninstallNextSteps(
        {
          packageMode: 'remove',
          removeRuntimeSystem: true,
          removeRuntimeUserData: true,
          removeUserData: true
        },
        'privilege_required'
      )
    };
  }

  private async runPrivilegedActions(plan: UninstallPlanSuccess, actions: PrivilegedActionPlan[]): Promise<ShellResult> {
    if (actions.length === 0) {
      return {
        exitCode: 0,
        output: '',
        errorOutput: '',
        timedOut: false
      };
    }

    const outputParts: string[] = [];
    const errorParts: string[] = [];

    for (const action of actions) {
      const result =
        plan.runner === 'pkexec-helper'
          ? await runPkexecHelperAction(this.runCommandFn, plan.helperPath ?? null, action.helperAction)
          : plan.runner === 'pkexec'
            ? await this.runCommandFn('pkexec', ['bash', '-lc', action.shellCommand], 10 * 60 * 1000)
            : await this.runCommandFn('sudo', ['-n', 'bash', '-lc', action.shellCommand], 10 * 60 * 1000);

      if (result.output.trim()) {
        outputParts.push(result.output.trim());
      }
      if (result.errorOutput.trim()) {
        errorParts.push(result.errorOutput.trim());
      }

      if (result.exitCode !== 0 || result.timedOut) {
        return {
          exitCode: result.exitCode,
          output: outputParts.join('\n'),
          errorOutput: errorParts.join('\n'),
          timedOut: result.timedOut
        };
      }
    }

    return {
      exitCode: 0,
      output: outputParts.join('\n'),
      errorOutput: errorParts.join('\n'),
      timedOut: false
    };
  }

  private runOptionalLocalCleanup(request: NormalizedUninstallRequest): string[] {
    const warnings: string[] = [];

    if (request.removeUserData) {
      for (const targetPath of this.collectUserDataPaths()) {
        this.removePathWithWarnings(targetPath, warnings, 'userdata');
      }
    }

    if (request.removeRuntimeUserData) {
      const ollamaPath = path.join(this.userHomeDir, '.ollama');
      this.removePathWithWarnings(ollamaPath, warnings, 'runtime-userdata');
    }

    return warnings;
  }

  private removePathWithWarnings(targetPath: string, warnings: string[], scope: 'userdata' | 'runtime-userdata'): void {
    const resolved = path.resolve(targetPath);
    if (!isSafeCleanupPath(resolved, this.userHomeDir)) {
      warnings.push(`Escopo ${scope}: caminho ignorado por seguranca (${resolved}).`);
      return;
    }

    if (!this.pathExistsFn(resolved)) {
      return;
    }

    try {
      this.removePathRecursivelyFn(resolved);
    } catch (error) {
      warnings.push(
        `Escopo ${scope}: falha ao remover ${resolved} (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  private collectUserDataPaths(): string[] {
    const defaults = [
      path.join(this.userHomeDir, '.config', 'dexter'),
      path.join(this.userHomeDir, '.cache', 'dexter'),
      path.join(this.userHomeDir, '.cache', 'Dexter'),
      path.join(this.userHomeDir, '.local', 'share', 'dexter'),
      path.join(this.userHomeDir, '.local', 'share', 'Dexter')
    ];

    return normalizePathList([...this.configuredUserDataPaths, ...defaults]);
  }
}

async function runPkexecHelperAction(
  runCommandFn: RunCommandFn,
  helperPath: string | null,
  action: HelperAction
): Promise<ShellResult> {
  if (!helperPath) {
    return {
      exitCode: null,
      output: '',
      errorOutput: 'Helper privilegiado Linux nao encontrado no host.',
      timedOut: false
    };
  }

  return runCommandFn('pkexec', ['bash', helperPath, action], 10 * 60 * 1000);
}

function normalizeRequest(input: UninstallRequest): NormalizedUninstallRequest {
  return {
    packageMode: input?.packageMode === 'purge' ? 'purge' : 'remove',
    removeUserData: input?.removeUserData === true,
    removeRuntimeSystem: input?.removeRuntimeSystem === true,
    removeRuntimeUserData: input?.removeRuntimeUserData === true,
    confirmationToken: typeof input?.confirmationToken === 'string' ? input.confirmationToken.trim() : ''
  };
}

function buildPerformedSummary(input: NormalizedUninstallRequest): UninstallResult['performed'] {
  return {
    packageMode: input.packageMode,
    runtimeSystem: input.removeRuntimeSystem,
    userData: input.removeUserData,
    runtimeUserData: input.removeRuntimeUserData
  };
}

function describeUninstallCommand(
  actions: PrivilegedActionPlan[],
  request: NormalizedUninstallRequest,
  helperPath: string | null
): string {
  const segments: string[] = [];

  if (actions.length > 0) {
    if (helperPath) {
      const helperActions = actions.map((item) => item.helperAction).join(' + ');
      segments.push(`pkexec bash ${helperPath} <${helperActions}>`);
    } else {
      segments.push(actions.map((item) => item.shellCommand).join(' && '));
    }
  }

  if (request.removeUserData) {
    segments.push('rm -rf ~/.config/dexter ~/.cache/dexter ~/.local/share/dexter');
  }

  if (request.removeRuntimeUserData) {
    segments.push('rm -rf ~/.ollama');
  }

  return segments.join(' ; ');
}

function buildPrivilegedActionPlan(request: NormalizedUninstallRequest): PrivilegedActionPlan[] {
  const actions: PrivilegedActionPlan[] = [];

  if (request.packageMode === 'purge') {
    actions.push({
      helperAction: 'uninstall-dexter-purge',
      shellCommand: 'DEBIAN_FRONTEND=noninteractive apt-get purge -y dexter && DEBIAN_FRONTEND=noninteractive apt-get autoremove -y'
    });
  } else {
    actions.push({
      helperAction: 'uninstall-dexter-remove',
      shellCommand: 'DEBIAN_FRONTEND=noninteractive apt-get remove -y dexter'
    });
  }

  if (request.removeRuntimeSystem) {
    actions.push({
      helperAction: 'uninstall-ollama-system',
      shellCommand: [
        'if command -v systemctl >/dev/null 2>&1; then',
        '  systemctl stop ollama 2>/dev/null || true;',
        '  systemctl disable ollama 2>/dev/null || true;',
        'fi;',
        'if command -v service >/dev/null 2>&1; then',
        '  service ollama stop 2>/dev/null || true;',
        'fi;',
        'rm -rf /usr/share/ollama /var/lib/ollama /etc/ollama /opt/ollama /usr/bin/ollama /usr/local/bin/ollama;',
        'if id ollama >/dev/null 2>&1; then userdel -r ollama 2>/dev/null || true; fi;',
        'if getent group ollama >/dev/null 2>&1; then groupdel ollama 2>/dev/null || true; fi'
      ].join(' ')
    });
  }

  return actions;
}

function buildUninstallWarningNextSteps(warnings: string[]): string[] {
  const steps = ['Uninstall principal concluido, mas houve avisos na limpeza opcional.'];

  for (const warning of warnings.slice(0, 4)) {
    steps.push(warning);
  }

  steps.push('Revise os caminhos acima e remova manualmente os residuos se necessario.');
  return steps;
}

function classifyUninstallFailure(result: ShellResult): UninstallErrorCode {
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

function buildUninstallNextSteps(
  request: Pick<
    NormalizedUninstallRequest,
    'packageMode' | 'removeRuntimeSystem' | 'removeRuntimeUserData' | 'removeUserData'
  >,
  errorCode: UninstallErrorCode
): string[] {
  const steps = new Set<string>();

  if (errorCode === 'missing_dependency') {
    steps.add('Host Linux sem apt-get disponivel para o fluxo automatizado desta build.');
  }

  if (errorCode === 'privilege_required') {
    steps.add('Sem privilegio automatizado suficiente para concluir o uninstall nesta sessao.');
  }

  if (errorCode === 'sudo_tty_required') {
    steps.add('O sudo deste host exige terminal interativo (TTY/senha).');
  }

  if (errorCode === 'sudo_policy_denied') {
    steps.add('Usuario local sem permissao sudo para concluir o uninstall.');
  }

  if (errorCode === 'timeout') {
    steps.add('A operacao excedeu o tempo limite; valide lock do apt e conectividade do host.');
  }

  steps.add('Execute manualmente no terminal do host:');
  for (const command of buildManualCommands(request)) {
    steps.add(command);
  }

  return [...steps];
}

function buildManualUninstallSteps(
  request: Pick<
    NormalizedUninstallRequest,
    'packageMode' | 'removeRuntimeSystem' | 'removeRuntimeUserData' | 'removeUserData'
  >
): string[] {
  return ['Use o terminal do host para concluir o uninstall.', ...buildManualCommands(request)];
}

function buildManualCommands(
  request: Pick<
    NormalizedUninstallRequest,
    'packageMode' | 'removeRuntimeSystem' | 'removeRuntimeUserData' | 'removeUserData'
  >
): string[] {
  const commands: string[] = [];

  commands.push(
    request.packageMode === 'purge'
      ? 'sudo apt-get purge -y dexter && sudo apt-get autoremove -y'
      : 'sudo apt-get remove -y dexter'
  );

  if (request.removeRuntimeSystem) {
    commands.push(
      "sudo bash -lc 'systemctl stop ollama 2>/dev/null || true; systemctl disable ollama 2>/dev/null || true; rm -rf /usr/share/ollama /var/lib/ollama /etc/ollama /opt/ollama /usr/bin/ollama /usr/local/bin/ollama; id ollama >/dev/null 2>&1 && userdel -r ollama || true; getent group ollama >/dev/null 2>&1 && groupdel ollama || true'"
    );
  }

  if (request.removeRuntimeUserData) {
    commands.push('rm -rf ~/.ollama');
  }

  if (request.removeUserData) {
    commands.push('rm -rf ~/.config/dexter ~/.cache/dexter ~/.local/share/dexter');
  }

  return commands;
}

function isPrivilegeInteractiveFallbackError(errorCode: UninstallErrorCode): boolean {
  return errorCode === 'privilege_required' || errorCode === 'sudo_tty_required' || errorCode === 'sudo_policy_denied';
}

function normalizeOptionalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizePathList(input: string[]): string[] {
  const normalized = input
    .map((item) => normalizeOptionalPath(item))
    .filter((item): item is string => typeof item === 'string')
    .map((item) => path.resolve(item));

  return [...new Set(normalized)];
}

function isSafeCleanupPath(targetPath: string, userHomeDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedHome = path.resolve(userHomeDir);

  if (resolvedTarget === '/' || resolvedTarget === resolvedHome) {
    return false;
  }

  const relative = path.relative(resolvedHome, resolvedTarget);
  if (!relative || relative.startsWith('..')) {
    return false;
  }

  return true;
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

function hasDesktopPrivilegePrompt(): boolean {
  if (typeof process.env.DISPLAY === 'string' || typeof process.env.WAYLAND_DISPLAY === 'string') {
    return true;
  }

  const sessionType = process.env.XDG_SESSION_TYPE?.trim().toLowerCase();
  return sessionType === 'x11' || sessionType === 'wayland';
}
