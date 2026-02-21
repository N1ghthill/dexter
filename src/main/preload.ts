import { contextBridge, ipcRenderer } from 'electron';
import type {
  ChatReply,
  ChatRequest,
  CuratedModel,
  DexterConfig,
  ExportDateRange,
  ExportFormat,
  ExportPayload,
  HealthReport,
  InstalledModel,
  ModelHistoryPage,
  ModelHistoryFilter,
  ModelHistoryQuery,
  ModelHistoryRecord,
  MemorySnapshot,
  ModelOperationResult,
  ModelProgressEvent,
  PermissionCheckResult,
  PermissionMode,
  PermissionPolicy,
  PermissionScope,
  RuntimeInstallResult,
  RuntimeStatus
} from '@shared/contracts';
import type { DexterApi } from '@shared/api';
import { IPC_CHANNELS } from '@shared/ipc';

const runtimeApi: DexterApi = {
  chat: (request: ChatRequest): Promise<ChatReply> => ipcRenderer.invoke(IPC_CHANNELS.chat, request),
  health: (): Promise<HealthReport> => ipcRenderer.invoke(IPC_CHANNELS.health),
  getConfig: (): Promise<DexterConfig> => ipcRenderer.invoke(IPC_CHANNELS.configGet),
  setModel: (model: string): Promise<DexterConfig> => ipcRenderer.invoke(IPC_CHANNELS.configSetModel, model),
  memorySnapshot: (): Promise<MemorySnapshot> => ipcRenderer.invoke(IPC_CHANNELS.memorySnapshot),
  runtimeStatus: (): Promise<RuntimeStatus> => ipcRenderer.invoke(IPC_CHANNELS.runtimeStatus),
  installRuntime: (approved = false): Promise<RuntimeInstallResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.runtimeInstall, approved),
  startRuntime: (approved = false): Promise<RuntimeStatus> => ipcRenderer.invoke(IPC_CHANNELS.runtimeStart, approved),
  listCuratedModels: (): Promise<CuratedModel[]> => ipcRenderer.invoke(IPC_CHANNELS.modelsCurated),
  listInstalledModels: (): Promise<InstalledModel[]> => ipcRenderer.invoke(IPC_CHANNELS.modelsInstalled),
  listModelHistory: (query: ModelHistoryQuery): Promise<ModelHistoryPage> => ipcRenderer.invoke(IPC_CHANNELS.modelsHistory, query),
  exportModelHistory: (format: ExportFormat, filter?: ModelHistoryFilter): Promise<ExportPayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.modelsHistoryExport, format, filter),
  exportLogs: (format: ExportFormat, range?: ExportDateRange): Promise<ExportPayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.logsExport, format, range),
  pullModel: (model: string, approved = false): Promise<ModelOperationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.modelPull, model, approved),
  removeModel: (model: string, approved = false): Promise<ModelOperationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.modelRemove, model, approved),
  onModelProgress: (listener: (event: ModelProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ModelProgressEvent) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.modelProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.modelProgress, handler);
  },
  listPermissions: (): Promise<PermissionPolicy[]> => ipcRenderer.invoke(IPC_CHANNELS.permissionsList),
  setPermission: (scope: PermissionScope, mode: PermissionMode): Promise<PermissionPolicy[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.permissionsSet, scope, mode),
  checkPermission: (scope: PermissionScope, action: string): Promise<PermissionCheckResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.permissionsCheck, scope, action),
  minimize: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.appMinimize),
  toggleVisibility: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.appToggleTray)
};

const useMockApi =
  typeof process !== 'undefined' &&
  typeof process.env === 'object' &&
  process.env !== null &&
  process.env.DEXTER_MOCK_API === '1';

contextBridge.exposeInMainWorld('dexter', useMockApi ? createMockApi() : runtimeApi);

function createMockApi(): DexterApi {
  const permissions = new Map<PermissionScope, PermissionMode>([
    ['runtime.install', 'ask'],
    ['tools.filesystem.read', 'ask'],
    ['tools.filesystem.write', 'ask'],
    ['tools.system.exec', 'ask']
  ]);

  const updatedAt = new Map<PermissionScope, string>([
    ['runtime.install', new Date().toISOString()],
    ['tools.filesystem.read', new Date().toISOString()],
    ['tools.filesystem.write', new Date().toISOString()],
    ['tools.system.exec', new Date().toISOString()]
  ]);

  const listeners = new Set<(event: ModelProgressEvent) => void>();

  let config: DexterConfig = {
    model: 'llama3.2:3b',
    endpoint: 'http://127.0.0.1:11434',
    personality:
      'Voce e Dexter, um assistente local amigavel, objetivo e paciente. Explique com clareza e priorize utilidade pratica.'
  };

  let runtimeOnline = false;
  const installed: InstalledModel[] = [];
  const modelHistory: ModelHistoryRecord[] = [];

  return {
    chat: async (request: ChatRequest) => ({
      id: crypto.randomUUID(),
      role: 'assistant',
      timestamp: new Date().toISOString(),
      source: 'llm',
      content: `Resposta mock para: ${request.input}`
    }),

    health: async () => {
      const modelAvailable = installed.some((item) => item.name === config.model);
      return {
        ok: runtimeOnline && modelAvailable,
        checkedAt: new Date().toISOString(),
        ollamaReachable: runtimeOnline,
        modelAvailable,
        memoryHealthy: true,
        loggingHealthy: true,
        details: runtimeOnline ? [] : ['Runtime mock offline.']
      };
    },

    getConfig: async () => config,

    setModel: async (model: string) => {
      config = { ...config, model: model.trim() || config.model };
      return config;
    },

    memorySnapshot: async () => ({
      shortTermTurns: 4,
      mediumTermSessions: 1,
      longTermFacts: 2
    }),

    runtimeStatus: async () => ({
      endpoint: config.endpoint,
      binaryFound: true,
      binaryPath: '/usr/bin/ollama',
      ollamaReachable: runtimeOnline,
      installedModelCount: installed.length,
      suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
      notes: runtimeOnline ? [] : ['Runtime mock desligado.']
    }),

    installRuntime: async (approved = false) => {
      const check = checkPermission('runtime.install', 'Instalar runtime local', permissions);
      if (!check.allowed && !(check.requiresPrompt && approved)) {
        return {
          ok: false,
          command: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          exitCode: null,
          output: '',
          errorOutput: check.message
        };
      }

      await delay(150);
      runtimeOnline = true;

      return {
        ok: true,
        command: 'mock install command',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        output: 'runtime instalado (mock)',
        errorOutput: ''
      };
    },

    startRuntime: async (approved = false) => {
      const check = checkPermission('tools.system.exec', 'Iniciar runtime local', permissions);
      if (!check.allowed && !(check.requiresPrompt && approved)) {
        return {
          endpoint: config.endpoint,
          binaryFound: true,
          binaryPath: '/usr/bin/ollama',
          ollamaReachable: runtimeOnline,
          installedModelCount: installed.length,
          suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
          notes: [check.message]
        };
      }

      await delay(80);
      runtimeOnline = true;
      return {
        endpoint: config.endpoint,
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: true,
        installedModelCount: installed.length,
        suggestedInstallCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
        notes: []
      };
    },

    listCuratedModels: async () => {
      const names = new Set(installed.map((item) => item.name));
      const curated: CuratedModel[] = [
        {
          name: 'llama3.2:3b',
          label: 'Llama 3.2 3B',
          description: 'Modelo geral para assistente local.',
          sizeClass: 'small',
          recommended: true,
          installed: names.has('llama3.2:3b')
        },
        {
          name: 'qwen2.5:7b',
          label: 'Qwen 2.5 7B',
          description: 'Modelo de maior capacidade de contexto.',
          sizeClass: 'medium',
          recommended: true,
          installed: names.has('qwen2.5:7b')
        }
      ];

      return curated;
    },

    listInstalledModels: async () => [...installed],

    listModelHistory: async (query: ModelHistoryQuery) => {
      const page = Number.isFinite(query.page) ? Math.max(1, Math.trunc(query.page)) : 1;
      const pageSize = Number.isFinite(query.pageSize) ? Math.max(1, Math.trunc(query.pageSize)) : 8;
      const operation = query.operation ?? 'all';
      const status = query.status ?? 'all';

      let filtered = [...modelHistory];
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
        items: filtered.slice(start, end),
        page: safePage,
        pageSize,
        total,
        totalPages
      };
    },

    exportModelHistory: async (format: ExportFormat, filter?: ModelHistoryFilter) => {
      const filtered = filterMockHistory(modelHistory, filter);
      const stamp = mockFileStamp();

      if (format === 'csv') {
        return {
          fileName: `dexter-model-history-${stamp}.csv`,
          mimeType: 'text/csv;charset=utf-8',
          content: toMockHistoryCsv(filtered)
        };
      }

      return {
        fileName: `dexter-model-history-${stamp}.json`,
        mimeType: 'application/json;charset=utf-8',
        content: JSON.stringify(filtered, null, 2)
      };
    },

    exportLogs: async (format: ExportFormat, range?: ExportDateRange) => {
      const logs = filterMockLogs(buildMockLogs(modelHistory, runtimeOnline), range);
      const stamp = mockFileStamp();

      if (format === 'csv') {
        return {
          fileName: `dexter-logs-${stamp}.csv`,
          mimeType: 'text/csv;charset=utf-8',
          content: toMockLogsCsv(logs)
        };
      }

      return {
        fileName: `dexter-logs-${stamp}.json`,
        mimeType: 'application/json;charset=utf-8',
        content: JSON.stringify(logs, null, 2)
      };
    },

    pullModel: async (model: string, approved = false) => {
      const check = checkPermission('tools.system.exec', `Baixar modelo ${model}`, permissions);
      if (!check.allowed && !(check.requiresPrompt && approved)) {
        unshiftHistory(modelHistory, {
          id: crypto.randomUUID(),
          operation: 'pull',
          model,
          status: 'blocked',
          message: check.message,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          percent: null
        });

        return {
          ok: false,
          model,
          message: check.message,
          output: '',
          errorOutput: check.message
        };
      }

      emitProgress(listeners, {
        operation: 'pull',
        model,
        phase: 'start',
        percent: 0,
        message: `Iniciando download de ${model}`,
        timestamp: new Date().toISOString()
      });

      for (const percent of [15, 45, 74, 100]) {
        await delay(50);
        emitProgress(listeners, {
          operation: 'pull',
          model,
          phase: percent === 100 ? 'done' : 'progress',
          percent,
          message: `Download ${percent}%`,
          timestamp: new Date().toISOString()
        });
      }

      if (!installed.some((item) => item.name === model)) {
        installed.push({
          name: model,
          sizeBytes: 2_100_000_000,
          modifiedAt: new Date().toISOString()
        });
      }

      unshiftHistory(modelHistory, {
        id: crypto.randomUUID(),
        operation: 'pull',
        model,
        status: 'done',
        message: 'Operacao concluida no mock.',
        startedAt: new Date(Date.now() - 300).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 300,
        percent: 100
      });

      return {
        ok: true,
        model,
        message: 'Modelo baixado no mock.',
        output: 'ok',
        errorOutput: ''
      };
    },

    removeModel: async (model: string, approved = false) => {
      const check = checkPermission('tools.system.exec', `Remover modelo ${model}`, permissions);
      if (!check.allowed && !(check.requiresPrompt && approved)) {
        unshiftHistory(modelHistory, {
          id: crypto.randomUUID(),
          operation: 'remove',
          model,
          status: 'blocked',
          message: check.message,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          percent: null
        });

        return {
          ok: false,
          model,
          message: check.message,
          output: '',
          errorOutput: check.message
        };
      }

      emitProgress(listeners, {
        operation: 'remove',
        model,
        phase: 'start',
        percent: null,
        message: `Removendo ${model}`,
        timestamp: new Date().toISOString()
      });

      await delay(50);
      const index = installed.findIndex((item) => item.name === model);
      if (index >= 0) {
        installed.splice(index, 1);
      }

      emitProgress(listeners, {
        operation: 'remove',
        model,
        phase: 'done',
        percent: null,
        message: `Modelo ${model} removido`,
        timestamp: new Date().toISOString()
      });

      unshiftHistory(modelHistory, {
        id: crypto.randomUUID(),
        operation: 'remove',
        model,
        status: 'done',
        message: 'Operacao concluida no mock.',
        startedAt: new Date(Date.now() - 120).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 120,
        percent: 100
      });

      return {
        ok: true,
        model,
        message: 'Modelo removido no mock.',
        output: 'ok',
        errorOutput: ''
      };
    },

    onModelProgress: (listener: (event: ModelProgressEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    listPermissions: async () => toPolicyList(permissions, updatedAt),

    setPermission: async (scope: PermissionScope, mode: PermissionMode) => {
      permissions.set(scope, mode);
      updatedAt.set(scope, new Date().toISOString());
      return toPolicyList(permissions, updatedAt);
    },

    checkPermission: async (scope: PermissionScope, action: string) => {
      return checkPermission(scope, action, permissions);
    },

    minimize: async () => undefined,
    toggleVisibility: async () => undefined
  };
}

function unshiftHistory(target: ModelHistoryRecord[], item: ModelHistoryRecord): void {
  target.unshift(item);
  if (target.length > 200) {
    target.splice(200);
  }
}

function checkPermission(
  scope: PermissionScope,
  action: string,
  permissions: Map<PermissionScope, PermissionMode>
): PermissionCheckResult {
  const mode = permissions.get(scope) ?? 'ask';

  if (mode === 'allow') {
    return {
      scope,
      action,
      mode,
      allowed: true,
      requiresPrompt: false,
      message: `Permitido por politica: ${scope}.`
    };
  }

  if (mode === 'deny') {
    return {
      scope,
      action,
      mode,
      allowed: false,
      requiresPrompt: false,
      message: `Bloqueado por politica: ${scope}.`
    };
  }

  return {
    scope,
    action,
    mode,
    allowed: false,
    requiresPrompt: true,
    message: `Dexter solicita confirmacao para: ${action}.`
  };
}

function toPolicyList(
  permissions: Map<PermissionScope, PermissionMode>,
  updatedAt: Map<PermissionScope, string>
): PermissionPolicy[] {
  const scopes: PermissionScope[] = [
    'runtime.install',
    'tools.filesystem.read',
    'tools.filesystem.write',
    'tools.system.exec'
  ];

  return scopes.map((scope) => ({
    scope,
    mode: permissions.get(scope) ?? 'ask',
    updatedAt: updatedAt.get(scope) ?? new Date().toISOString()
  }));
}

function emitProgress(
  listeners: Set<(event: ModelProgressEvent) => void>,
  event: ModelProgressEvent
): void {
  for (const listener of listeners) {
    listener(event);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MockLogEntry {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: unknown;
}

function filterMockHistory(records: ModelHistoryRecord[], filter?: ModelHistoryFilter): ModelHistoryRecord[] {
  const operation = filter?.operation ?? 'all';
  const status = filter?.status ?? 'all';
  let filtered = [...records];

  if (operation !== 'all') {
    filtered = filtered.filter((item) => item.operation === operation);
  }

  if (status !== 'all') {
    filtered = filtered.filter((item) => item.status === status);
  }

  filtered = filtered.filter((item) => isWithinRange(item.startedAt, filter?.dateFrom, filter?.dateTo));

  return filtered;
}

function buildMockLogs(records: ModelHistoryRecord[], runtimeOnline: boolean): MockLogEntry[] {
  const base: MockLogEntry[] = [
    {
      ts: new Date().toISOString(),
      level: runtimeOnline ? 'info' : 'warn',
      message: 'mock.runtime.status',
      meta: { runtimeOnline }
    }
  ];

  for (const item of records.slice(0, 40)) {
    base.push({
      ts: item.finishedAt ?? item.startedAt,
      level: item.status === 'error' ? 'error' : item.status === 'blocked' ? 'warn' : 'info',
      message: `mock.model.${item.operation}`,
      meta: {
        model: item.model,
        status: item.status,
        percent: item.percent
      }
    });
  }

  return base;
}

function filterMockLogs(records: MockLogEntry[], range?: ExportDateRange): MockLogEntry[] {
  return records.filter((entry) => isWithinRange(entry.ts, range?.dateFrom, range?.dateTo));
}

function toMockHistoryCsv(records: ModelHistoryRecord[]): string {
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
  const rows = records.map((item) => [
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

  return toMockCsv([header, ...rows]);
}

function toMockLogsCsv(records: MockLogEntry[]): string {
  const header = ['ts', 'level', 'message', 'meta'];
  const rows = records.map((item) => [
    item.ts,
    item.level,
    item.message,
    item.meta === undefined ? '' : JSON.stringify(item.meta)
  ]);

  return toMockCsv([header, ...rows]);
}

function toMockCsv(rows: string[][]): string {
  return rows.map((row) => row.map(mockCsvEscape).join(',')).join('\n');
}

function mockCsvEscape(value: string): string {
  if (/["\n,]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function mockFileStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
}

function isWithinRange(timestamp: string, dateFrom?: string, dateTo?: string): boolean {
  const valueMs = parseTime(timestamp);
  if (valueMs === null) {
    return false;
  }

  const fromMs = parseTime(dateFrom);
  if (fromMs !== null && valueMs < fromMs) {
    return false;
  }

  const toMs = parseTime(dateTo);
  if (toMs !== null && valueMs > toMs) {
    return false;
  }

  return true;
}

function parseTime(value?: string): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
