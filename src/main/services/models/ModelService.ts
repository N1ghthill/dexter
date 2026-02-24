import { spawn } from 'node:child_process';
import type { CuratedModel, InstalledModel, ModelOperationResult, ModelProgressEvent } from '@shared/contracts';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { Logger } from '@main/services/logging/Logger';
import { buildCuratedCatalog } from '@main/services/models/ModelCatalog';
import { fetchInstalledModels } from '@main/services/models/ollama-http';
import { buildCommandEnvironment, resolveCommandBinary } from '@main/services/environment/command-resolution';

interface OllamaExecResult {
  exitCode: number | null;
  output: string;
  errorOutput: string;
  timedOut: boolean;
}

interface BinaryProbe {
  found: boolean;
  path: string | null;
}

export class ModelService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly logger: Logger
  ) {}

  async listInstalled(): Promise<InstalledModel[]> {
    const endpoint = this.configStore.get().endpoint;
    return fetchInstalledModels(endpoint);
  }

  async listCurated(): Promise<CuratedModel[]> {
    const installed = await this.listInstalled();
    const installedNames = new Set(installed.map((item) => item.name));
    return buildCuratedCatalog(installedNames);
  }

  async pullModel(model: string, onProgress?: (event: ModelProgressEvent) => void): Promise<ModelOperationResult> {
    return this.runModelOperation('pull', model, 'pull', onProgress);
  }

  async removeModel(model: string, onProgress?: (event: ModelProgressEvent) => void): Promise<ModelOperationResult> {
    return this.runModelOperation('remove', model, 'rm', onProgress);
  }

  private async runModelOperation(
    operation: 'pull' | 'remove',
    model: string,
    command: 'pull' | 'rm',
    onProgress?: (event: ModelProgressEvent) => void
  ): Promise<ModelOperationResult> {
    const sanitized = model.trim();
    const commandText = `ollama ${command} ${sanitized || '<modelo>'}`;

    const invalidResult = buildInvalidModelResult(operation, sanitized, commandText, onProgress);
    if (invalidResult) {
      return invalidResult;
    }

    const endpoint = this.configStore.get().endpoint;
    const binary = probeOllamaBinary();
    const preflightFailure = await this.checkOperationPreflight({
      operation,
      model: sanitized,
      endpoint,
      commandText,
      binary,
      onProgress
    });
    if (preflightFailure) {
      return preflightFailure;
    }

    this.logger.info('model.operation.start', {
      operation,
      model: sanitized,
      endpoint,
      command: commandText
    });

    onProgress?.({
      operation,
      model: sanitized,
      phase: 'start',
      percent: null,
      message: `Iniciando ${operation} para ${sanitized}.`,
      timestamp: new Date().toISOString()
    });

    const result = await runOllamaCommand(binary.path ?? 'ollama', [command, sanitized], 25 * 60 * 1000, (line) => {
      onProgress?.({
        operation,
        model: sanitized,
        phase: 'progress',
        percent: extractPercent(line),
        message: line,
        timestamp: new Date().toISOString()
      });
    });

    const ok = result.exitCode === 0;
    const errorCode = ok ? undefined : classifyModelOperationFailure(result);

    this.logger.info('model.operation.finish', {
      operation,
      model: sanitized,
      ok,
      exitCode: result.exitCode,
      errorCode: errorCode ?? null,
      timedOut: result.timedOut
    });

    onProgress?.({
      operation,
      model: sanitized,
      phase: ok ? 'done' : 'error',
      percent: ok ? 100 : null,
      message: ok
        ? `Operacao ${operation} concluida para ${sanitized}.`
        : `Operacao ${operation} falhou para ${sanitized}.`,
      timestamp: new Date().toISOString()
    });

    return {
      ok,
      model: sanitized,
      message: ok
        ? `Operacao concluida para o modelo ${sanitized}.`
        : `Falha ao executar operacao no modelo ${sanitized}.`,
      output: result.output,
      errorOutput: result.errorOutput,
      command: commandText,
      strategy: 'ollama-cli-local',
      errorCode,
      nextSteps: ok
        ? undefined
        : buildModelOperationNextSteps({
            operation,
            model: sanitized,
            endpoint,
            command: commandText,
            errorCode
          }),
      timedOut: result.timedOut
    };
  }

  private async checkOperationPreflight(input: {
    operation: 'pull' | 'remove';
    model: string;
    endpoint: string;
    commandText: string;
    binary: BinaryProbe;
    onProgress?: (event: ModelProgressEvent) => void;
  }): Promise<ModelOperationResult | null> {
    if (classifyEndpointScope(input.endpoint) === 'remote') {
      const message = 'Operacao de modelo via CLI local desabilitada: endpoint configurado aponta para host remoto.';
      emitModelPreflightError(input, message);
      return {
        ok: false,
        model: input.model,
        message,
        output: '',
        errorOutput: message,
        command: input.commandText,
        strategy: 'assist',
        errorCode: 'remote_endpoint_unsupported',
        manualRequired: true,
        nextSteps: [
          'A UI de modelos executa o CLI local do Ollama.',
          'Configure endpoint local (ex.: http://127.0.0.1:11434) para usar pull/rm pela interface.',
          `Ou execute manualmente no host remoto: ${input.commandText}`
        ]
      };
    }

    if (!input.binary.found) {
      const message = 'Comando `ollama` nao encontrado no PATH local.';
      emitModelPreflightError(input, message);
      return {
        ok: false,
        model: input.model,
        message,
        output: '',
        errorOutput: message,
        command: input.commandText,
        strategy: 'assist',
        errorCode: 'binary_missing',
        manualRequired: true,
        nextSteps: [
          'Instale o runtime Ollama primeiro (painel Runtime Local).',
          'Depois tente novamente a operacao de modelo.'
        ]
      };
    }

    if (!(await isEndpointReachable(input.endpoint))) {
      const message = `Runtime Ollama indisponivel em ${input.endpoint}.`;
      emitModelPreflightError(input, message);
      return {
        ok: false,
        model: input.model,
        message,
        output: '',
        errorOutput: message,
        command: input.commandText,
        strategy: 'assist',
        errorCode: 'runtime_unreachable',
        nextSteps: [
          'Inicie o runtime local pelo botao "Iniciar Runtime" ou execute `ollama serve`.',
          'Confirme no painel Runtime ou com `/health`, depois tente novamente.'
        ]
      };
    }

    return null;
  }
}

function buildInvalidModelResult(
  operation: 'pull' | 'remove',
  model: string,
  commandText: string,
  onProgress?: (event: ModelProgressEvent) => void
): ModelOperationResult | null {
  if (isSafeModelName(model)) {
    return null;
  }

  const message = 'Nome de modelo invalido para operacao.';
  onProgress?.({
    operation,
    model,
    phase: 'error',
    percent: null,
    message,
    timestamp: new Date().toISOString()
  });

  return {
    ok: false,
    model,
    message,
    output: '',
    errorOutput: '',
    command: commandText,
    strategy: 'assist',
    errorCode: 'invalid_model_name',
    nextSteps: [
      'Use um nome de modelo Ollama valido (ex.: `llama3.2:3b`, `qwen2.5:7b`).',
      `Comando esperado: ${commandText}`
    ]
  };
}

function emitModelPreflightError(
  input: {
    operation: 'pull' | 'remove';
    model: string;
    onProgress?: (event: ModelProgressEvent) => void;
  },
  message: string
): void {
  input.onProgress?.({
    operation: input.operation,
    model: input.model,
    phase: 'error',
    percent: null,
    message,
    timestamp: new Date().toISOString()
  });
}

async function runOllamaCommand(
  binaryPath: string,
  args: string[],
  timeoutMs: number,
  onLine?: (line: string) => void
): Promise<OllamaExecResult> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildCommandEnvironment()
    });

    let output = '';
    let errorOutput = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      const value = String(chunk);
      output += value;
      stdoutBuffer = streamLines(value, stdoutBuffer, onLine);
    });

    child.stderr.on('data', (chunk) => {
      const value = String(chunk);
      errorOutput += value;
      stderrBuffer = streamLines(value, stderrBuffer, onLine);
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
      resolve({
        exitCode: null,
        output,
        errorOutput: `${errorOutput}\n${error.message}`.trim(),
        timedOut
      });
    });
  });
}

function isSafeModelName(model: string): boolean {
  return /^[a-zA-Z0-9._:/-]{2,120}$/.test(model);
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

function sanitizeProgressLine(line: string): string {
  // Remove ANSI escapes emitted by Ollama CLI progress output.
  const withoutAnsi = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b/g, '');
  const withoutControl = withoutAnsi.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, '');
  return withoutControl.replace(/\s+/g, ' ').trim();
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

function probeOllamaBinary(platform: NodeJS.Platform = process.platform): BinaryProbe {
  const resolved = resolveCommandBinary('ollama', platform);
  return {
    found: resolved.found && Boolean(resolved.path),
    path: resolved.path
  };
}

async function isEndpointReachable(endpoint: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
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

function classifyModelOperationFailure(result: OllamaExecResult): 'spawn_error' | 'command_failed' | 'timeout' {
  if (result.timedOut) {
    return 'timeout';
  }
  if (result.exitCode === null) {
    return 'spawn_error';
  }
  return 'command_failed';
}

function buildModelOperationNextSteps(input: {
  operation: 'pull' | 'remove';
  model: string;
  endpoint: string;
  command: string;
  errorCode?: 'spawn_error' | 'command_failed' | 'timeout';
}): string[] {
  const steps = new Set<string>();

  if (input.errorCode === 'timeout') {
    steps.add(
      input.operation === 'pull'
        ? 'Download de modelo demorou demais. Verifique rede, espaco em disco e tente novamente.'
        : 'Remocao demorou demais. Tente novamente e confirme que o runtime esta responsivo.'
    );
  }

  if (input.errorCode === 'spawn_error') {
    steps.add('Falha ao iniciar o CLI do Ollama. Verifique instalacao do runtime e PATH local.');
  }

  if (!steps.size) {
    steps.add(`Verifique se o runtime local responde em ${input.endpoint}.`);
  }

  steps.add('Operacoes de modelos geralmente nao exigem sudo; erros de permissao costumam indicar problema de dono/permissoes do diretorio de modelos.');
  steps.add(`Teste no terminal para ver a saida completa: ${input.command}`);
  return [...steps];
}
