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
  MemorySnapshot,
  ModelProgressEvent,
  LogExportFilter,
  ModelOperationResult,
  PermissionCheckResult,
  PermissionMode,
  PermissionPolicy,
  PermissionScope,
  RuntimeInstallResult,
  RuntimeStatus,
  UpdateAuditTrailCount,
  UpdateAuditTrailFilter,
  UpdateRestartResult,
  UpdatePolicy,
  UpdatePolicyPatch,
  UpdateState
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
  repairRuntime(approved?: boolean): Promise<RuntimeStatus>;
  listCuratedModels(): Promise<CuratedModel[]>;
  listInstalledModels(): Promise<InstalledModel[]>;
  listModelHistory(query: ModelHistoryQuery): Promise<ModelHistoryPage>;
  exportModelHistory(format: ExportFormat, filter?: ModelHistoryFilter): Promise<ExportPayload>;
  exportLogs(format: ExportFormat, filter?: LogExportFilter): Promise<ExportPayload>;
  countExportLogs(filter?: LogExportFilter): Promise<LogExportCount>;
  exportUpdateAuditTrail(format: ExportFormat, filter?: UpdateAuditTrailFilter): Promise<ExportPayload>;
  countUpdateAuditTrail(filter?: UpdateAuditTrailFilter): Promise<UpdateAuditTrailCount>;
  pullModel(model: string, approved?: boolean): Promise<ModelOperationResult>;
  removeModel(model: string, approved?: boolean): Promise<ModelOperationResult>;
  onModelProgress(listener: (event: ModelProgressEvent) => void): () => void;
  listPermissions(): Promise<PermissionPolicy[]>;
  setPermission(scope: PermissionScope, mode: PermissionMode): Promise<PermissionPolicy[]>;
  checkPermission(scope: PermissionScope, action: string): Promise<PermissionCheckResult>;
  getUpdateState(): Promise<UpdateState>;
  getUpdatePolicy(): Promise<UpdatePolicy>;
  setUpdatePolicy(patch: UpdatePolicyPatch): Promise<UpdatePolicy>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  restartToApplyUpdate(): Promise<UpdateRestartResult>;
  reportBootHealthy(): Promise<void>;
  recordUiAuditEvent(event: string, payload?: Record<string, unknown>): Promise<void>;
  minimize(): Promise<void>;
  toggleVisibility(): Promise<void>;
}
