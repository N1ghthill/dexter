import { spawn } from 'node:child_process';
import type { CuratedModel, InstalledModel, ModelOperationResult, ModelProgressEvent } from '@shared/contracts';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { Logger } from '@main/services/logging/Logger';
import { buildCuratedCatalog } from '@main/services/models/ModelCatalog';
import { fetchInstalledModels } from '@main/services/models/ollama-http';

interface OllamaExecResult {
  exitCode: number | null;
  output: string;
  errorOutput: string;
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
    if (!isSafeModelName(sanitized)) {
      onProgress?.({
        operation,
        model: sanitized,
        phase: 'error',
        percent: null,
        message: 'Nome de modelo invalido para operacao.',
        timestamp: new Date().toISOString()
      });

      return {
        ok: false,
        model: sanitized,
        message: 'Nome de modelo invalido para operacao.',
        output: '',
        errorOutput: ''
      };
    }

    this.logger.info('model.operation.start', {
      operation,
      model: sanitized
    });

    onProgress?.({
      operation,
      model: sanitized,
      phase: 'start',
      percent: null,
      message: `Iniciando ${operation} para ${sanitized}.`,
      timestamp: new Date().toISOString()
    });

    const result = await runOllamaCommand([command, sanitized], 25 * 60 * 1000, (line) => {
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

    this.logger.info('model.operation.finish', {
      operation,
      model: sanitized,
      ok,
      exitCode: result.exitCode
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
      errorOutput: result.errorOutput
    };
  }
}

async function runOllamaCommand(
  args: string[],
  timeoutMs: number,
  onLine?: (line: string) => void
): Promise<OllamaExecResult> {
  return new Promise((resolve) => {
    const child = spawn('ollama', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';

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

function isSafeModelName(model: string): boolean {
  return /^[a-zA-Z0-9._:/-]{2,120}$/.test(model);
}

function streamLines(chunk: string, buffer: string, onLine?: (line: string) => void): string {
  const merged = `${buffer}${chunk.replace(/\r/g, '\n')}`;
  const parts = merged.split('\n');
  const tail = parts.pop() as string;

  if (onLine) {
    for (const part of parts) {
      const line = part.trim();
      if (line) {
        onLine(line);
      }
    }
  }

  return tail;
}

function flushLineBuffer(buffer: string, onLine?: (line: string) => void): void {
  const line = buffer.trim();
  if (line && onLine) {
    onLine(line);
  }
}

function extractPercent(text: string): number | null {
  const match = text.match(/(\d{1,3})%/);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1]!, 10);

  return Math.max(0, Math.min(100, value));
}
