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
  MemorySnapshot,
  ModelProgressEvent,
  ModelOperationResult,
  PermissionCheckResult,
  PermissionMode,
  PermissionPolicy,
  PermissionScope,
  RuntimeInstallResult,
  RuntimeStatus
} from '@shared/contracts';

export interface DexterApi {
  chat(request: ChatRequest): Promise<ChatReply>;
  health(): Promise<HealthReport>;
  getConfig(): Promise<DexterConfig>;
  setModel(model: string): Promise<DexterConfig>;
  memorySnapshot(): Promise<MemorySnapshot>;
  runtimeStatus(): Promise<RuntimeStatus>;
  installRuntime(approved?: boolean): Promise<RuntimeInstallResult>;
  startRuntime(approved?: boolean): Promise<RuntimeStatus>;
  listCuratedModels(): Promise<CuratedModel[]>;
  listInstalledModels(): Promise<InstalledModel[]>;
  listModelHistory(query: ModelHistoryQuery): Promise<ModelHistoryPage>;
  exportModelHistory(format: ExportFormat, filter?: ModelHistoryFilter): Promise<ExportPayload>;
  exportLogs(format: ExportFormat, range?: ExportDateRange): Promise<ExportPayload>;
  pullModel(model: string, approved?: boolean): Promise<ModelOperationResult>;
  removeModel(model: string, approved?: boolean): Promise<ModelOperationResult>;
  onModelProgress(listener: (event: ModelProgressEvent) => void): () => void;
  listPermissions(): Promise<PermissionPolicy[]>;
  setPermission(scope: PermissionScope, mode: PermissionMode): Promise<PermissionPolicy[]>;
  checkPermission(scope: PermissionScope, action: string): Promise<PermissionCheckResult>;
  minimize(): Promise<void>;
  toggleVisibility(): Promise<void>;
}
