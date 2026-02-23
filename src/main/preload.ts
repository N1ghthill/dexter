import { contextBridge, ipcRenderer } from 'electron';
import type {
  ChatReply,
  ChatRequest,
  CuratedModel,
  DexterConfig,
  ExportFormat,
  ExportPayload,
  HealthReport,
  InstalledModel,
  LogExportCount,
  ModelHistoryPage,
  ModelHistoryFilter,
  ModelHistoryQuery,
  ModelHistoryRecord,
  MemorySnapshot,
  ModelOperationResult,
  ModelProgressEvent,
  LogExportFilter,
  PermissionCheckResult,
  PermissionMode,
  PermissionPolicy,
  PermissionScope,
  RuntimeInstallResult,
  RuntimeStatus,
  UpdateAuditTrailCount,
  UpdateAuditTrailFamily,
  UpdateAuditTrailFilter,
  UpdateAuditTrailRecord,
  UpdateAuditTrailSeverity,
  UpdateManifest,
  UpdateRestartResult,
  UpdatePolicy,
  UpdatePolicyPatch,
  UpdateState
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
  exportLogs: (format: ExportFormat, filter?: LogExportFilter): Promise<ExportPayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.logsExport, format, filter),
  countExportLogs: (filter?: LogExportFilter): Promise<LogExportCount> => ipcRenderer.invoke(IPC_CHANNELS.logsExportCount, filter),
  exportUpdateAuditTrail: (format: ExportFormat, filter?: UpdateAuditTrailFilter): Promise<ExportPayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.updateAuditExport, format, filter),
  countUpdateAuditTrail: (filter?: UpdateAuditTrailFilter): Promise<UpdateAuditTrailCount> =>
    ipcRenderer.invoke(IPC_CHANNELS.updateAuditCount, filter),
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
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.updateState),
  getUpdatePolicy: (): Promise<UpdatePolicy> => ipcRenderer.invoke(IPC_CHANNELS.updatePolicyGet),
  setUpdatePolicy: (patch: UpdatePolicyPatch): Promise<UpdatePolicy> => ipcRenderer.invoke(IPC_CHANNELS.updatePolicySet, patch),
  checkForUpdates: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),
  restartToApplyUpdate: (): Promise<UpdateRestartResult> => ipcRenderer.invoke(IPC_CHANNELS.updateRestartApply),
  reportBootHealthy: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.appBootHealthy),
  minimize: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.appMinimize),
  toggleVisibility: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.appToggleTray)
};

const useMockApi =
  typeof process !== 'undefined' &&
  typeof process.env === 'object' &&
  process.env !== null &&
  process.env.DEXTER_MOCK_API === '1';

contextBridge.exposeInMainWorld('dexter', useMockApi ? createMockApi() : runtimeApi);

type MockUpdateMode = 'normal' | 'blocked-schema';

function createMockApi(): DexterApi {
  const permissions = new Map<PermissionScope, PermissionMode>();
  const updatedAt = new Map<PermissionScope, string>();

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
  let updatePolicy: UpdatePolicy = {
    channel: 'stable',
    autoCheck: true,
    updatedAt: new Date().toISOString()
  };
  let updateState: UpdateState = {
    phase: 'idle',
    provider: 'mock',
    checkedAt: null,
    lastError: null,
    lastErrorCode: null,
    available: null,
    stagedVersion: null,
    stagedArtifactPath: null
  };
  const mockUpdateMode = readMockUpdateMode();

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
        return await withMockExportMeta({
          fileName: `dexter-model-history-${stamp}.csv`,
          mimeType: 'text/csv;charset=utf-8',
          content: toMockHistoryCsv(filtered)
        });
      }

      return await withMockExportMeta({
        fileName: `dexter-model-history-${stamp}.json`,
        mimeType: 'application/json;charset=utf-8',
        content: JSON.stringify(filtered, null, 2)
      });
    },

    exportLogs: async (format: ExportFormat, filter?: LogExportFilter) => {
      const logs = filterMockLogs(buildMockLogs(modelHistory, runtimeOnline, updateState), filter);
      const stamp = mockFileStamp();

      if (format === 'csv') {
        return await withMockExportMeta({
          fileName: `dexter-logs-${stamp}.csv`,
          mimeType: 'text/csv;charset=utf-8',
          content: toMockLogsCsv(logs)
        });
      }

      return await withMockExportMeta({
        fileName: `dexter-logs-${stamp}.json`,
        mimeType: 'application/json;charset=utf-8',
        content: JSON.stringify(logs, null, 2)
      });
    },

    countExportLogs: async (filter?: LogExportFilter) => {
      const scope = filter?.scope === 'updates' ? 'updates' : 'all';
      const logs = filterMockLogs(buildMockLogs(modelHistory, runtimeOnline, updateState), {
        ...filter,
        scope
      });
      const estimatedBytesJson = utf8ByteLength(JSON.stringify(logs, null, 2));
      const estimatedBytesCsv = utf8ByteLength(toMockLogsCsv(logs));
      return {
        scope,
        count: logs.length,
        estimatedBytesJson,
        estimatedBytesCsv
      };
    },

    exportUpdateAuditTrail: async (format: ExportFormat, filter?: UpdateAuditTrailFilter) => {
      const { family, severity, codeOnly, items } = buildMockUpdateAuditTrailItems(modelHistory, runtimeOnline, updateState, filter);
      const stamp = mockFileStamp();
      const itemsSha256 = await sha256HexAsync(JSON.stringify(items));

      if (format === 'csv') {
        return await withMockExportMeta({
          fileName: `dexter-update-audit-${stamp}.csv`,
          mimeType: 'text/csv;charset=utf-8',
          content: toMockUpdateAuditTrailCsv(items, itemsSha256)
        });
      }

      return await withMockExportMeta({
        fileName: `dexter-update-audit-${stamp}.json`,
        mimeType: 'application/json;charset=utf-8',
        content: JSON.stringify(
          {
            schema: 'dexter.update-audit.v1',
            generatedAt: new Date().toISOString(),
            filter: {
              dateFrom: filter?.dateFrom,
              dateTo: filter?.dateTo,
              family,
              severity,
              codeOnly
            },
            count: items.length,
            integrity: {
              itemsSha256
            },
            items
          },
          null,
          2
        )
        });
    },

    countUpdateAuditTrail: async (filter?: UpdateAuditTrailFilter) => {
      const { family, severity, codeOnly, items } = buildMockUpdateAuditTrailItems(modelHistory, runtimeOnline, updateState, filter);
      const itemsSha256 = await sha256HexAsync(JSON.stringify(items));
      const jsonPayload = {
        schema: 'dexter.update-audit.v1',
        generatedAt: new Date().toISOString(),
        filter: {
          dateFrom: filter?.dateFrom,
          dateTo: filter?.dateTo,
          family,
          severity,
          codeOnly
        },
        count: items.length,
        integrity: {
          itemsSha256
        },
        items
      };

      return {
        family,
        severity,
        codeOnly,
        count: items.length,
        estimatedBytesJson: utf8ByteLength(JSON.stringify(jsonPayload, null, 2)),
        estimatedBytesCsv: utf8ByteLength(toMockUpdateAuditTrailCsv(items, itemsSha256))
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
          finishedAt: null,
          durationMs: null,
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

      if (shouldMockModelFailure(model)) {
        const message = `Falha simulada no mock ao baixar ${model}`;
        emitProgress(listeners, {
          operation: 'pull',
          model,
          phase: 'error',
          percent: null,
          message,
          timestamp: new Date().toISOString()
        });
        unshiftHistory(modelHistory, {
          id: crypto.randomUUID(),
          operation: 'pull',
          model,
          status: 'error',
          message,
          startedAt: new Date(Date.now() - 90).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 90,
          percent: null
        });
        return {
          ok: false,
          model,
          message,
          output: '',
          errorOutput: message
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
          finishedAt: null,
          durationMs: null,
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

      if (shouldMockModelFailure(model)) {
        const message = `Falha simulada no mock ao remover ${model}`;
        emitProgress(listeners, {
          operation: 'remove',
          model,
          phase: 'error',
          percent: null,
          message,
          timestamp: new Date().toISOString()
        });
        unshiftHistory(modelHistory, {
          id: crypto.randomUUID(),
          operation: 'remove',
          model,
          status: 'error',
          message,
          startedAt: new Date(Date.now() - 60).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 60,
          percent: null
        });
        return {
          ok: false,
          model,
          message,
          output: '',
          errorOutput: message
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

    getUpdateState: async () => cloneMockUpdateState(updateState),

    getUpdatePolicy: async () => ({ ...updatePolicy }),

    setUpdatePolicy: async (patch: UpdatePolicyPatch) => {
      updatePolicy = {
        channel: patch.channel === 'rc' ? 'rc' : patch.channel === 'stable' ? 'stable' : updatePolicy.channel,
        autoCheck: typeof patch.autoCheck === 'boolean' ? patch.autoCheck : updatePolicy.autoCheck,
        updatedAt: new Date().toISOString()
      };
      return { ...updatePolicy };
    },

    checkForUpdates: async () => {
      if (updateState.phase === 'staged' && updateState.stagedVersion) {
        return cloneMockUpdateState(updateState);
      }

      updateState = {
        ...updateState,
        phase: 'checking',
        provider: 'mock',
        lastError: null,
        lastErrorCode: null
      };

      await delay(40);
      const available = buildMockUpdateManifest(updatePolicy.channel);
      if (mockUpdateMode === 'blocked-schema') {
        available.components.userDataSchemaVersion = 3;
        updateState = {
          phase: 'error',
          provider: 'mock',
          checkedAt: new Date().toISOString(),
          lastError: 'Update disponivel, mas bloqueado: migracao de schema indisponivel (1 -> 3).',
          lastErrorCode: 'schema_migration_unavailable',
          available,
          stagedVersion: null,
          stagedArtifactPath: null
        };

        return cloneMockUpdateState(updateState);
      }

      updateState = {
        phase: 'available',
        provider: 'mock',
        checkedAt: new Date().toISOString(),
        lastError: null,
        lastErrorCode: null,
        available,
        stagedVersion: null,
        stagedArtifactPath: null
      };

      return cloneMockUpdateState(updateState);
    },

    downloadUpdate: async () => {
      if (updateState.phase === 'staged' && updateState.stagedVersion) {
        return cloneMockUpdateState(updateState);
      }

      if (
        updateState.phase === 'error' &&
        (updateState.lastErrorCode === 'ipc_incompatible' ||
          updateState.lastErrorCode === 'remote_schema_incompatible' ||
          updateState.lastErrorCode === 'schema_migration_unavailable')
      ) {
        return cloneMockUpdateState(updateState);
      }

      if (!updateState.available) {
        updateState = {
          ...updateState,
          phase: 'error',
          provider: 'mock',
          lastError: 'Nenhum update disponivel para download.',
          lastErrorCode: 'no_update_available_for_download'
        };
        return cloneMockUpdateState(updateState);
      }
      const stagedVersion = updateState.available.version;

      updateState = {
        ...updateState,
        phase: 'downloading',
        provider: 'mock',
        lastError: null,
        lastErrorCode: null
      };

      await delay(60);
      updateState = {
        ...updateState,
        phase: 'staged',
        provider: 'mock',
        stagedVersion,
        stagedArtifactPath: `/tmp/dexter-updates/${stagedVersion}/dexter-${stagedVersion}.AppImage`,
        lastErrorCode: null
      };

      return cloneMockUpdateState(updateState);
    },

    restartToApplyUpdate: async () => {
      if (updateState.phase !== 'staged' || !updateState.stagedVersion) {
        updateState = {
          ...updateState,
          phase: 'error',
          provider: 'mock',
          lastError: 'Nenhum update staged para aplicar no reinicio.',
          lastErrorCode: 'no_staged_update'
        };

        return {
          ok: false,
          message: updateState.lastError ?? 'Nenhum update staged para aplicar no reinicio.',
          state: cloneMockUpdateState(updateState)
        };
      }

      return {
        ok: true,
        message: `Reinicio solicitado para aplicar update ${updateState.stagedVersion} (mock).`,
        state: cloneMockUpdateState(updateState)
      };
    },

    reportBootHealthy: async () => undefined,

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

function buildMockLogs(records: ModelHistoryRecord[], runtimeOnline: boolean, updateState: UpdateState): MockLogEntry[] {
  const base: MockLogEntry[] = [
    {
      ts: new Date().toISOString(),
      level: runtimeOnline ? 'info' : 'warn',
      message: 'mock.runtime.status',
      meta: runtimeOnline ? { runtimeOnline } : undefined
    }
  ];

  if (updateState.checkedAt) {
    base.push({
      ts: updateState.checkedAt,
      level: updateState.phase === 'error' ? 'warn' : 'info',
      message: 'update.check.finish',
      meta: {
        phase: updateState.phase,
        code: updateState.lastErrorCode,
        stagedVersion: updateState.stagedVersion
      }
    });
  }

  if (updateState.phase === 'staged' && updateState.stagedVersion) {
    base.push({
      ts: new Date().toISOString(),
      level: 'info',
      message: 'update.download.finish',
      meta: {
        version: updateState.stagedVersion
      }
    });
  }

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

function filterMockLogs(records: MockLogEntry[], filter?: LogExportFilter): MockLogEntry[] {
  const scope = filter?.scope === 'updates' ? 'updates' : 'all';

  return records
    .filter((entry) => isWithinRange(entry.ts, filter?.dateFrom, filter?.dateTo))
    .filter((entry) => {
      if (scope === 'all') {
        return true;
      }

      return entry.message.startsWith('update.') || entry.message === 'app.relaunch';
    });
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

function toMockUpdateAuditTrailCsv(records: UpdateAuditTrailRecord[], itemsSha256: string): string {
  const header = ['ts', 'level', 'event', 'family', 'category', 'code', 'phase', 'version', 'reason', 'meta'];
  const rows = records.map((item) => [
    item.ts,
    item.level,
    item.event,
    item.family,
    item.category,
    item.code ?? '',
    item.phase ?? '',
    item.version ?? '',
    item.reason ?? '',
    item.meta === null ? '' : JSON.stringify(item.meta)
  ]);

  const csv = toMockCsv([header, ...rows]);
  return `${csv}\n# schema=dexter.update-audit.v1\n# count=${records.length}\n# items_sha256=${itemsSha256}`;
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

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

async function withMockExportMeta(payload: ExportPayload): Promise<ExportPayload> {
  return {
    ...payload,
    contentBytes: utf8ByteLength(payload.content),
    sha256: await sha256HexAsync(payload.content)
  };
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

function shouldMockModelFailure(model: string): boolean {
  return model.toLowerCase().includes('fail') || model.toLowerCase().includes('error');
}

function toMockUpdateAuditTrailRecord(entry: MockLogEntry): UpdateAuditTrailRecord {
  const meta = asMockRecord(entry.meta);
  const version = readMockString(meta, 'version') ?? readMockString(meta, 'stagedVersion');
  const family = deriveMockUpdateAuditFamily(entry.message);

  return {
    ts: entry.ts,
    level: entry.level,
    event: entry.message,
    family,
    category: entry.message === 'app.relaunch' ? 'app' : 'update',
    code: readMockString(meta, 'code'),
    phase: readMockString(meta, 'phase'),
    version,
    reason: readMockString(meta, 'reason'),
    meta
  };
}

function buildMockUpdateAuditTrailItems(
  modelHistory: ModelHistoryRecord[],
  runtimeOnline: boolean,
  updateState: UpdateState,
  filter?: UpdateAuditTrailFilter
): {
  family: UpdateAuditTrailFamily;
  severity: UpdateAuditTrailSeverity;
  codeOnly: boolean;
  items: UpdateAuditTrailRecord[];
} {
  const logs = filterMockLogs(buildMockLogs(modelHistory, runtimeOnline, updateState), {
    ...filter,
    scope: 'updates'
  });
  const family = normalizeMockUpdateAuditFamily(filter?.family);
  const severity = normalizeMockUpdateAuditSeverity(filter?.severity);
  const codeOnly = filter?.codeOnly === true;
  const items = logs
    .map(toMockUpdateAuditTrailRecord)
    .filter((item) => family === 'all' || item.family === family)
    .filter((item) => severity === 'all' || item.level === 'warn' || item.level === 'error')
    .filter((item) => !codeOnly || (typeof item.code === 'string' && item.code.length > 0));

  return {
    family,
    severity,
    codeOnly,
    items
  };
}

function normalizeMockUpdateAuditFamily(value: unknown): UpdateAuditTrailFamily {
  return value === 'check' ||
    value === 'download' ||
    value === 'apply' ||
    value === 'migration' ||
    value === 'rollback' ||
    value === 'other'
    ? value
    : 'all';
}

function normalizeMockUpdateAuditSeverity(value: unknown): UpdateAuditTrailSeverity {
  return value === 'warn-error' ? 'warn-error' : 'all';
}

function deriveMockUpdateAuditFamily(event: string): UpdateAuditTrailFamily {
  if (event === 'app.relaunch' || event.startsWith('update.apply.')) {
    return 'apply';
  }
  if (event.startsWith('update.check.')) {
    return 'check';
  }
  if (event.startsWith('update.download.')) {
    return 'download';
  }
  if (event.startsWith('update.migration.')) {
    return 'migration';
  }
  if (event.startsWith('update.rollback.')) {
    return 'rollback';
  }

  return event.startsWith('update.') ? 'other' : 'other';
}

function asMockRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readMockString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === 'string' ? value : null;
}

async function sha256HexAsync(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readMockUpdateMode(): MockUpdateMode {
  if (
    typeof process !== 'undefined' &&
    typeof process.env === 'object' &&
    process.env !== null &&
    process.env.DEXTER_MOCK_UPDATE_MODE === 'blocked-schema'
  ) {
    return 'blocked-schema';
  }

  return 'normal';
}

function buildMockUpdateManifest(channel: UpdatePolicy['channel']): UpdateManifest {
  const version = channel === 'rc' ? '0.1.4-rc.1' : '0.1.4';
  const appImageArtifact = {
    platform: 'linux' as const,
    arch: 'x64' as const,
    packageType: 'appimage' as const,
    downloadUrl: `https://example.invalid/dexter/${version}/Dexter-${version}.AppImage`,
    checksumSha256: 'a'.repeat(64)
  };
  const debArtifact = {
    platform: 'linux' as const,
    arch: 'x64' as const,
    packageType: 'deb' as const,
    downloadUrl: `https://example.invalid/dexter/${version}/dexter_${version}_amd64.deb`,
    checksumSha256: 'b'.repeat(64)
  };

  return {
    version,
    channel,
    provider: 'mock',
    publishedAt: new Date().toISOString(),
    releaseNotes: 'Mock update para validar fluxo de check/download/staging.',
    downloadUrl: appImageArtifact.downloadUrl,
    checksumSha256: appImageArtifact.checksumSha256,
    artifacts: [appImageArtifact, debArtifact],
    selectedArtifact: appImageArtifact,
    components: {
      appVersion: version,
      coreVersion: version,
      uiVersion: version,
      ipcContractVersion: 1,
      userDataSchemaVersion: 1
    },
    compatibility: {
      strategy: 'atomic',
      requiresRestart: true,
      ipcContractCompatible: true,
      userDataSchemaCompatible: true,
      notes: []
    }
  };
}

function cloneMockUpdateState(input: UpdateState): UpdateState {
  return {
    ...input,
    available: input.available
      ? {
          ...input.available,
          artifacts: input.available.artifacts?.map((artifact) => ({ ...artifact })),
          selectedArtifact: input.available.selectedArtifact ? { ...input.available.selectedArtifact } : input.available.selectedArtifact,
          components: { ...input.available.components },
          compatibility: {
            ...input.available.compatibility,
            notes: input.available.compatibility.notes.slice()
          }
        }
      : null
  };
}
