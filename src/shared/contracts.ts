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
}

export interface RuntimeInstallResult {
  ok: boolean;
  command: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  output: string;
  errorOutput: string;
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
}

export interface ModelProgressEvent {
  operation: ModelOperationType;
  model: string;
  phase: 'start' | 'progress' | 'done' | 'error';
  percent: number | null;
  message: string;
  timestamp: string;
}
