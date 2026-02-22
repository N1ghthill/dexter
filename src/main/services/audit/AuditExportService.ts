import type {
  ExportDateRange,
  ExportFormat,
  ExportPayload,
  ModelHistoryFilter,
  ModelHistoryRecord
} from '@shared/contracts';
import type { LogEntry } from '@main/services/logging/Logger';
import { Logger } from '@main/services/logging/Logger';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const HISTORY_EXPORT_PAGE_SIZE = 100;
const HISTORY_EXPORT_MAX_PAGES = 1000;

export class AuditExportService {
  constructor(
    private readonly modelHistoryService: ModelHistoryService,
    private readonly logger: Logger
  ) {}

  exportModelHistory(format: ExportFormat, filter: ModelHistoryFilter = {}): ExportPayload {
    const records = this.collectHistory(filter);
    const stamp = fileStamp();

    if (format === 'csv') {
      return {
        fileName: `dexter-model-history-${stamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: historyToCsv(records)
      };
    }

    return {
      fileName: `dexter-model-history-${stamp}.json`,
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify(records, null, 2)
    };
  }

  exportLogs(format: ExportFormat, range: ExportDateRange = {}): ExportPayload {
    const entries = this.logger.entries().filter((entry) => isWithinDateRange(entry.ts, range.dateFrom, range.dateTo));
    const stamp = fileStamp();

    if (format === 'csv') {
      return {
        fileName: `dexter-logs-${stamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: logsToCsv(entries)
      };
    }

    return {
      fileName: `dexter-logs-${stamp}.json`,
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify(entries, null, 2)
    };
  }

  private collectHistory(filter: ModelHistoryFilter): ModelHistoryRecord[] {
    const operation = filter.operation ?? 'all';
    const status = filter.status ?? 'all';
    const pageSize = HISTORY_EXPORT_PAGE_SIZE;
    const records: ModelHistoryRecord[] = [];

    for (let page = 1; page <= HISTORY_EXPORT_MAX_PAGES; page += 1) {
      const result = this.modelHistoryService.query({
        page,
        pageSize,
        operation,
        status
      });

      records.push(...result.items);
      const totalPages = sanitizeTotalPages(result.totalPages);

      if (page >= totalPages || result.items.length === 0) {
        break;
      }
    }

    return records.filter((item) => isWithinDateRange(item.startedAt, filter.dateFrom, filter.dateTo));
  }
}

function historyToCsv(items: ModelHistoryRecord[]): string {
  const header = [
    'id',
    'operation',
    'model',
    'status',
    'message',
    'startedAt',
    'finishedAt',
    'durationMs',
    'percent'
  ];
  const rows = items.map((item) => [
    item.id,
    item.operation,
    item.model,
    item.status,
    item.message,
    item.startedAt,
    item.finishedAt ?? '',
    item.durationMs === null ? '' : String(item.durationMs),
    item.percent === null ? '' : String(item.percent)
  ]);

  return toCsv([header, ...rows]);
}

function logsToCsv(items: LogEntry[]): string {
  const header = ['ts', 'level', 'message', 'meta'];
  const rows = items.map((entry) => [
    entry.ts,
    entry.level,
    entry.message,
    entry.meta === undefined ? '' : JSON.stringify(entry.meta)
  ]);

  return toCsv([header, ...rows]);
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function csvEscape(value: string): string {
  if (/["\n,]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function fileStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
}

function isWithinDateRange(timestamp: string, dateFrom?: string, dateTo?: string): boolean {
  const valueMs = parseMs(timestamp);
  if (valueMs === null) {
    return false;
  }

  const fromMs = parseMs(dateFrom);
  if (fromMs !== null && valueMs < fromMs) {
    return false;
  }

  const toMs = parseMs(dateTo);
  if (toMs !== null && valueMs > toMs) {
    return false;
  }

  return true;
}

function parseMs(value?: string): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sanitizeTotalPages(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(HISTORY_EXPORT_MAX_PAGES, Math.trunc(value)));
}
