import fs from 'node:fs';
import path from 'node:path';
import type {
  ModelHistoryPage,
  ModelHistoryQuery,
  ModelHistoryRecord,
  ModelOperationStatus,
  ModelOperationType
} from '@shared/contracts';

interface PersistedHistoryFile {
  records: ModelHistoryRecord[];
}

export class ModelHistoryService {
  private readonly filePath: string;
  private readonly maxRecords = 500;
  private records: ModelHistoryRecord[] = [];

  constructor(baseDir: string) {
    const historyDir = path.join(baseDir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    this.filePath = path.join(historyDir, 'model-operations.json');

    this.records = this.load();
  }

  start(operation: ModelOperationType, model: string, message: string): ModelHistoryRecord {
    const record: ModelHistoryRecord = {
      id: crypto.randomUUID(),
      operation,
      model,
      status: 'running',
      message,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      percent: null
    };

    this.records.unshift(record);
    this.trim();
    this.persist();
    return cloneRecord(record);
  }

  progress(id: string, message: string, percent: number | null): ModelHistoryRecord | null {
    const record = this.findById(id);
    if (!record) {
      return null;
    }

    record.message = message;
    record.percent = normalizePercent(percent);
    this.persist();
    return cloneRecord(record);
  }

  finish(
    id: string,
    status: Extract<ModelOperationStatus, 'done' | 'error'>,
    message: string,
    percent: number | null
  ): ModelHistoryRecord | null {
    const record = this.findById(id);
    if (!record) {
      return null;
    }

    const finished = new Date();
    const startedMs = Date.parse(record.startedAt);
    record.status = status;
    record.message = message;
    record.finishedAt = finished.toISOString();
    record.durationMs = Number.isFinite(startedMs) ? Math.max(0, finished.getTime() - startedMs) : null;
    record.percent = status === 'done' ? 100 : normalizePercent(percent);
    this.persist();

    return cloneRecord(record);
  }

  block(operation: ModelOperationType, model: string, message: string): ModelHistoryRecord {
    const now = new Date().toISOString();
    const record: ModelHistoryRecord = {
      id: crypto.randomUUID(),
      operation,
      model,
      status: 'blocked',
      message,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      percent: null
    };

    this.records.unshift(record);
    this.trim();
    this.persist();

    return cloneRecord(record);
  }

  query(query: ModelHistoryQuery): ModelHistoryPage {
    const page = clampInt(query.page, 1, 99999);
    const pageSize = clampInt(query.pageSize, 1, 100);
    const operation = query.operation ?? 'all';
    const status = query.status ?? 'all';

    let filtered = this.records;

    if (operation !== 'all') {
      filtered = filtered.filter((item) => item.operation === operation);
    }

    if (status !== 'all') {
      filtered = filtered.filter((item) => item.status === status);
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;

    return {
      items: filtered.slice(start, end).map((item) => cloneRecord(item)),
      page: safePage,
      pageSize,
      total,
      totalPages
    };
  }

  private findById(id: string): ModelHistoryRecord | null {
    for (const record of this.records) {
      if (record.id === id) {
        return record;
      }
    }

    return null;
  }

  private trim(): void {
    if (this.records.length <= this.maxRecords) {
      return;
    }

    this.records.splice(this.maxRecords);
  }

  private persist(): void {
    this.writeRecords(this.records);
  }

  private load(): ModelHistoryRecord[] {
    if (!fs.existsSync(this.filePath)) {
      this.writeRecords([]);
      return [];
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedHistoryFile;
      const source = Array.isArray(parsed.records) ? parsed.records : [];
      const records = source.filter((item) => isValidRecord(item)).slice(0, this.maxRecords);

      // Self-heal file when payload is malformed or oversized.
      if (!Array.isArray(parsed.records) || records.length !== source.length || source.length > this.maxRecords) {
        this.writeRecords(records);
      }

      return records;
    } catch {
      this.writeRecords([]);
      return [];
    }
  }

  private writeRecords(records: ModelHistoryRecord[]): void {
    const file: PersistedHistoryFile = {
      records
    };

    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }
}

function normalizePercent(value: number | null): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isValidRecord(value: unknown): value is ModelHistoryRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<ModelHistoryRecord>;

  if (typeof record.id !== 'string') {
    return false;
  }

  if (record.operation !== 'pull' && record.operation !== 'remove') {
    return false;
  }

  if (record.status !== 'running' && record.status !== 'done' && record.status !== 'error' && record.status !== 'blocked') {
    return false;
  }

  return (
    typeof record.model === 'string' &&
    typeof record.message === 'string' &&
    isIsoDate(record.startedAt) &&
    (record.finishedAt === null || isIsoDate(record.finishedAt)) &&
    (record.durationMs === null ||
      (typeof record.durationMs === 'number' && Number.isFinite(record.durationMs) && record.durationMs >= 0)) &&
    (record.percent === null ||
      (typeof record.percent === 'number' && Number.isFinite(record.percent) && record.percent >= 0 && record.percent <= 100))
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

function cloneRecord(input: ModelHistoryRecord): ModelHistoryRecord {
  return {
    ...input
  };
}
