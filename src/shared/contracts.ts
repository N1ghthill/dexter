export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatTurn {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
}

export interface ChatRequest {
  sessionId: string;
  input: string;
}

export type ReplySource = 'command' | 'llm' | 'fallback';

export interface ChatReply {
  id: string;
  role: 'assistant';
  content: string;
  timestamp: string;
  source: ReplySource;
}

export interface DexterConfig {
  model: string;
  endpoint: string;
  personality: string;
}

export interface HealthReport {
  ok: boolean;
  checkedAt: string;
  ollamaReachable: boolean;
  modelAvailable: boolean;
  memoryHealthy: boolean;
  loggingHealthy: boolean;
  details: string[];
}

export interface MemorySnapshot {
  shortTermTurns: number;
  mediumTermSessions: number;
  longTermFacts: number;
}

export interface MemoryLiveSessionSnapshot {
  sessionId: string;
  shortTermTurns: number;
  inferredUserName: string | null;
  recentUserPrompts: string[];
}

export interface MemoryLiveSnapshot {
  summary: MemorySnapshot;
  session: MemoryLiveSessionSnapshot;
  longTerm: LongTermMemory;
}

export type MemoryClearScope = 'session.short' | 'long.profile' | 'long.preferences' | 'long.notes';

export interface MemoryClearResult {
  ok: boolean;
  scope: MemoryClearScope;
  removed: number;
  sessionId: string;
  snapshot: MemorySnapshot;
  message: string;
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: string;
  sample: string[];
}

export interface LongTermMemory {
  profile: Record<string, string>;
  preferences: Record<string, string>;
  notes: string[];
}

export type PermissionScope =
  | 'runtime.install'
  | 'tools.filesystem.read'
  | 'tools.filesystem.write'
  | 'tools.system.exec';

export type PermissionMode = 'allow' | 'ask' | 'deny';

export interface PermissionPolicy {
  scope: PermissionScope;
  mode: PermissionMode;
  updatedAt: string;
}

export interface PermissionCheckResult {
  scope: PermissionScope;
  action: string;
  mode: PermissionMode;
  allowed: boolean;
  requiresPrompt: boolean;
  message: string;
}

export interface RuntimeStatus {
  endpoint: string;
  binaryFound: boolean;
  binaryPath: string | null;
  ollamaReachable: boolean;
  installedModelCount: number;
  suggestedInstallCommand: string;
  notes: string[];
  privilegedHelper?: {
    configured: boolean;
    available: boolean;
    path: string | null;
    statusProbeOk: boolean;
    pkexecAvailable: boolean;
    desktopPrivilegePromptAvailable: boolean;
    sudoAvailable: boolean;
    sudoNonInteractiveAvailable: boolean;
    sudoRequiresTty: boolean;
    sudoPolicyDenied: boolean;
    privilegeEscalationReady: boolean;
    agentOperationalMode: 'pkexec' | 'sudo-noninteractive' | 'sudo-terminal' | 'none';
    agentOperationalLevel: 'automated' | 'assisted' | 'blocked';
    agentOperationalReady: boolean;
    agentOperationalReason: string;
    capabilities: {
      systemctl: boolean;
      service: boolean;
      curl: boolean;
    } | null;
    notes: string[];
  };
}

export type RuntimeInstallStrategy =
  | 'linux-pkexec-helper'
  | 'linux-pkexec'
  | 'linux-sudo-noninteractive'
  | 'linux-shell'
  | 'linux-assist'
  | 'darwin-shell'
  | 'win32-manual'
  | 'unsupported';

export type RuntimeInstallErrorCode =
  | 'permission_blocked'
  | 'unsupported_platform'
  | 'not_implemented'
  | 'missing_dependency'
  | 'privilege_required'
  | 'sudo_tty_required'
  | 'sudo_policy_denied'
  | 'shell_spawn_error'
  | 'command_failed'
  | 'timeout';

export interface RuntimeInstallResult {
  ok: boolean;
  command: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  output: string;
  errorOutput: string;
  strategy?: RuntimeInstallStrategy;
  errorCode?: RuntimeInstallErrorCode;
  nextSteps?: string[];
  manualRequired?: boolean;
  timedOut?: boolean;
}

export interface RuntimeInstallProgressEvent {
  phase: 'start' | 'progress' | 'done' | 'error';
  percent: number | null;
  message: string;
  timestamp: string;
}

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  modifiedAt: string | null;
}

export type ModelSizeClass = 'small' | 'medium' | 'large';

export interface CuratedModel {
  name: string;
  label: string;
  description: string;
  sizeClass: ModelSizeClass;
  recommended: boolean;
  installed: boolean;
}

export interface ModelOperationResult {
  ok: boolean;
  model: string;
  message: string;
  output: string;
  errorOutput: string;
  command?: string;
  strategy?: 'ollama-cli-local' | 'assist';
  errorCode?:
    | 'permission_blocked'
    | 'invalid_model_name'
    | 'binary_missing'
    | 'runtime_unreachable'
    | 'remote_endpoint_unsupported'
    | 'spawn_error'
    | 'command_failed'
    | 'timeout'
    | 'unexpected_error';
  nextSteps?: string[];
  manualRequired?: boolean;
  timedOut?: boolean;
}

export type ModelOperationType = 'pull' | 'remove';
export type ModelOperationStatus = 'running' | 'done' | 'error' | 'blocked';
export type ExportFormat = 'json' | 'csv';

export interface ModelHistoryRecord {
  id: string;
  operation: ModelOperationType;
  model: string;
  status: ModelOperationStatus;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  percent: number | null;
}

export interface ModelHistoryQuery {
  page: number;
  pageSize: number;
  operation?: ModelOperationType | 'all';
  status?: ModelOperationStatus | 'all';
}

export interface ModelHistoryPage {
  items: ModelHistoryRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ExportDateRange {
  dateFrom?: string;
  dateTo?: string;
}

export type LogExportScope = 'all' | 'updates' | 'ui';

export interface LogExportFilter extends ExportDateRange {
  scope?: LogExportScope;
}

export interface LogExportCount {
  scope: LogExportScope;
  count: number;
  estimatedBytesJson: number;
  estimatedBytesCsv: number;
}

export type UpdateAuditTrailFamily = 'all' | 'check' | 'download' | 'apply' | 'migration' | 'rollback' | 'other';
export type UpdateAuditTrailSeverity = 'all' | 'warn-error';

export interface UpdateAuditTrailFilter extends ExportDateRange {
  family?: UpdateAuditTrailFamily;
  severity?: UpdateAuditTrailSeverity;
  codeOnly?: boolean;
}

export interface UpdateAuditTrailRecord {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  family: UpdateAuditTrailFamily;
  category: 'update' | 'app';
  code: string | null;
  phase: string | null;
  version: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
}

export interface UpdateAuditTrailJsonPayload {
  schema: 'dexter.update-audit.v1';
  generatedAt: string;
  filter: UpdateAuditTrailFilter;
  count: number;
  integrity: {
    itemsSha256: string;
  };
  items: UpdateAuditTrailRecord[];
}

export interface UpdateAuditTrailCount {
  family: UpdateAuditTrailFamily;
  severity: UpdateAuditTrailSeverity;
  codeOnly: boolean;
  count: number;
  estimatedBytesJson: number;
  estimatedBytesCsv: number;
}

export interface ModelHistoryFilter {
  operation?: ModelOperationType | 'all';
  status?: ModelOperationStatus | 'all';
  dateFrom?: string;
  dateTo?: string;
}

export interface ExportPayload {
  fileName: string;
  mimeType: string;
  content: string;
  sha256?: string;
  contentBytes?: number;
}

export interface ModelProgressEvent {
  operation: ModelOperationType;
  model: string;
  phase: 'start' | 'progress' | 'done' | 'error';
  percent: number | null;
  message: string;
  timestamp: string;
}

export type UpdateChannel = 'stable' | 'rc';
export type UpdateStrategy = 'atomic' | 'ui-only';
export type UpdateProviderKind = 'none' | 'mock' | 'github';
export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'staged' | 'error';
export type UpdateErrorCode =
  | 'check_failed'
  | 'download_failed'
  | 'restart_failed'
  | 'restart_unavailable'
  | 'no_update_available_for_download'
  | 'no_staged_update'
  | 'ipc_incompatible'
  | 'remote_schema_incompatible'
  | 'schema_migration_unavailable';

export interface ComponentVersionSet {
  appVersion: string;
  coreVersion: string;
  uiVersion: string;
  ipcContractVersion: number;
  userDataSchemaVersion: number;
}

export interface UpdateCompatibility {
  strategy: UpdateStrategy;
  requiresRestart: boolean;
  ipcContractCompatible: boolean;
  userDataSchemaCompatible: boolean;
  notes: string[];
}

export type UpdateArtifactPlatform = 'linux';
export type UpdateArtifactArch = 'x64' | 'arm64';
export type UpdateArtifactPackageType = 'appimage' | 'deb';

export interface UpdateArtifact {
  platform: UpdateArtifactPlatform;
  arch: UpdateArtifactArch;
  packageType: UpdateArtifactPackageType;
  downloadUrl: string;
  checksumSha256: string;
}

export interface UpdateManifest {
  version: string;
  channel: UpdateChannel;
  provider: UpdateProviderKind;
  publishedAt: string;
  releaseNotes: string;
  downloadUrl: string;
  checksumSha256: string;
  artifacts?: UpdateArtifact[];
  selectedArtifact?: UpdateArtifact | null;
  components: ComponentVersionSet;
  compatibility: UpdateCompatibility;
}

export interface UpdateState {
  phase: UpdatePhase;
  provider: UpdateProviderKind;
  checkedAt: string | null;
  lastError: string | null;
  lastErrorCode: UpdateErrorCode | null;
  available: UpdateManifest | null;
  stagedVersion: string | null;
  stagedArtifactPath: string | null;
}

export interface UpdateRestartResult {
  ok: boolean;
  message: string;
  state: UpdateState;
}

export interface UpdatePolicy {
  channel: UpdateChannel;
  autoCheck: boolean;
  updatedAt: string;
}

export interface UpdatePolicyPatch {
  channel?: UpdateChannel;
  autoCheck?: boolean;
}
