import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  message: string;
  meta?: unknown;
}

interface LoggerOptions {
  mirrorFilePath?: string | null;
}

export class Logger {
  private readonly filePath: string;
  private readonly mirrorFilePath: string | null;
  private readonly maxBytes = 2 * 1024 * 1024;

  constructor(baseDir: string, options?: LoggerOptions) {
    const logDir = path.join(baseDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    this.filePath = path.join(logDir, 'dexter.log');
    this.mirrorFilePath = normalizeMirrorPath(options?.mirrorFilePath);
    if (this.mirrorFilePath) {
      fs.mkdirSync(path.dirname(this.mirrorFilePath), { recursive: true });
    }
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }

  isHealthy(): boolean {
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.filePath, '');
      return true;
    } catch {
      return false;
    }
  }

  entries(limit?: number): LogEntry[] {
    const files = [`${this.filePath}.1`, this.filePath];
    const entries: LogEntry[] = [];

    for (const file of files) {
      if (!fs.existsSync(file)) {
        continue;
      }

      const text = fs.readFileSync(file, 'utf-8');
      const lines = text.split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) {
          continue;
        }

        entries.push(parseLogLine(line));
      }
    }

    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0 || entries.length <= limit) {
      return entries;
    }

    return entries.slice(-Math.trunc(limit));
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      meta
    });

    this.rotateIfNeeded();
    fs.appendFileSync(this.filePath, `${line}\n`);
    if (this.mirrorFilePath) {
      try {
        fs.appendFileSync(this.mirrorFilePath, `${line}\n`);
      } catch {
        // espelho de debug e opcional; erros aqui nao devem quebrar o logger principal
      }
    }
  }

  private rotateIfNeeded(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    const stats = fs.statSync(this.filePath);
    if (stats.size < this.maxBytes) {
      return;
    }

    const rotated = `${this.filePath}.1`;
    if (fs.existsSync(rotated)) {
      fs.rmSync(rotated, { force: true });
    }
    fs.renameSync(this.filePath, rotated);
  }
}

function parseLogLine(line: string): LogEntry {
  try {
    const parsed = JSON.parse(line) as Partial<LogEntry>;
    return {
      ts: typeof parsed.ts === 'string' ? parsed.ts : new Date().toISOString(),
      level: isLogLevel(parsed.level) ? parsed.level : 'info',
      message: typeof parsed.message === 'string' ? parsed.message : line,
      meta: parsed.meta
    };
  } catch {
    return {
      ts: new Date().toISOString(),
      level: 'info',
      message: line
    };
  }
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function normalizeMirrorPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}
