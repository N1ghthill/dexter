import { ipcMain, BrowserWindow } from 'electron';
import type {
  ChatTurn,
  ChatRequest,
  ExportDateRange,
  ExportFormat,
  LogExportFilter,
  MemoryClearScope,
  MemoryLiveSnapshot,
  ModelHistoryFilter,
  ModelHistoryQuery,
  UpdateAuditTrailFilter,
  UpdatePolicyPatch
} from '@shared/contracts';
import { IPC_CHANNELS } from '@shared/ipc';
import { resolveSessionPreferredUserName } from '@main/services/agent/agent-consciousness';
import { DexterBrain } from '@main/services/agent/DexterBrain';
import { AuditExportService } from '@main/services/audit/AuditExportService';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { HealthService } from '@main/services/health/HealthService';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelService } from '@main/services/models/ModelService';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';
import { PermissionService } from '@main/services/permissions/PermissionService';
import type { PermissionMode, PermissionScope } from '@shared/contracts';
import { RuntimeService } from '@main/services/runtime/RuntimeService';
import { UpdateService } from '@main/services/update/UpdateService';

interface RegisterIpcDeps {
  brain: DexterBrain;
  healthService: HealthService;
  configStore: ConfigStore;
  memoryStore: MemoryStore;
  modelService: ModelService;
  modelHistoryService: ModelHistoryService;
  auditExportService: AuditExportService;
  permissionService: PermissionService;
  runtimeService: RuntimeService;
  updateService: UpdateService;
  logger: Logger;
  getWindow: () => BrowserWindow | null;
  reportBootHealthy?: () => void;
}

export function registerIpc(deps: RegisterIpcDeps): void {
  const {
    brain,
    healthService,
    configStore,
    memoryStore,
    modelService,
    modelHistoryService,
    auditExportService,
    permissionService,
    runtimeService,
    updateService,
    logger,
    getWindow,
    reportBootHealthy
  } = deps;

  ipcMain.handle(IPC_CHANNELS.chat, async (_event, payload: ChatRequest) => {
    logger.info('ipc.chat', { sessionId: payload.sessionId });
    return brain.respond(payload);
  });

  ipcMain.handle(IPC_CHANNELS.health, async () => {
    return healthService.report();
  });

  ipcMain.handle(IPC_CHANNELS.configGet, () => {
    return configStore.get();
  });

  ipcMain.handle(IPC_CHANNELS.configSetModel, (_event, model: string) => {
    const sanitized = model.trim();
    if (!sanitized) {
      return configStore.get();
    }

    const updated = configStore.setModel(sanitized);
    logger.info('config.model_updated', { model: sanitized });
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.memorySnapshot, () => {
    return memoryStore.snapshot();
  });

  ipcMain.handle(IPC_CHANNELS.memoryLiveSnapshot, (_event, sessionId: string) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return buildMemoryLiveSnapshot(memoryStore, normalizedSessionId);
  });

  ipcMain.handle(IPC_CHANNELS.memoryClearScope, (_event, scopeInput: unknown, sessionIdInput: unknown) => {
    const scope = normalizeMemoryClearScope(scopeInput);
    if (!scope) {
      throw new Error('Escopo de limpeza de memoria invalido.');
    }

    const sessionId = normalizeSessionId(typeof sessionIdInput === 'string' ? sessionIdInput : '');
    const removed = clearMemoryScope(memoryStore, scope, sessionId);
    const snapshot = memoryStore.snapshot();

    return {
      ok: true,
      scope,
      removed,
      sessionId,
      snapshot,
      message: buildMemoryClearMessage(scope, removed, sessionId)
    };
  });

  ipcMain.handle(IPC_CHANNELS.runtimeStatus, async () => {
    return runtimeService.status();
  });

  ipcMain.handle(IPC_CHANNELS.runtimeInstall, async (event, approved = false) => {
    const decision = permissionService.check('runtime.install', 'Instalar runtime local');
    if (!decision.allowed && !(decision.requiresPrompt && approved)) {
      return {
        ok: false,
        command: '',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: null,
        output: '',
        errorOutput: decision.message,
        errorCode: 'permission_blocked' as const,
        manualRequired: true,
        nextSteps: ['Revise a politica do escopo runtime.install no painel de Permissoes e tente novamente.']
      };
    }

    return runtimeService.installRuntime((progress) => {
      event.sender.send(IPC_CHANNELS.runtimeInstallProgress, progress);
    });
  });

  ipcMain.handle(IPC_CHANNELS.runtimeStart, async (_event, approved = false) => {
    const decision = permissionService.check('tools.system.exec', 'Iniciar runtime local');
    if (!decision.allowed && !(decision.requiresPrompt && approved)) {
      logger.warn('permission.blocked', {
        scope: decision.scope,
        action: decision.action,
        mode: decision.mode
      });
      return runtimeService.status();
    }

    return runtimeService.startRuntime();
  });

  ipcMain.handle(IPC_CHANNELS.runtimeRepair, async (_event, approved = false) => {
    const decision = permissionService.check('tools.system.exec', 'Reparar runtime local');
    if (!decision.allowed && !(decision.requiresPrompt && approved)) {
      logger.warn('permission.blocked', {
        scope: decision.scope,
        action: decision.action,
        mode: decision.mode
      });
      return runtimeService.status();
    }

    return runtimeService.repairRuntime();
  });

  ipcMain.handle(IPC_CHANNELS.modelsCurated, async () => {
    return modelService.listCurated();
  });

  ipcMain.handle(IPC_CHANNELS.modelsInstalled, async () => {
    return modelService.listInstalled();
  });

  ipcMain.handle(IPC_CHANNELS.modelsHistory, (_event, query: ModelHistoryQuery) => {
    return modelHistoryService.query(normalizeHistoryQuery(query));
  });

  ipcMain.handle(IPC_CHANNELS.modelsHistoryExport, (_event, format: ExportFormat, filter?: ModelHistoryFilter) => {
    return auditExportService.exportModelHistory(normalizeExportFormat(format), normalizeHistoryFilter(filter));
  });

  ipcMain.handle(IPC_CHANNELS.logsExport, (_event, format: ExportFormat, filter?: LogExportFilter) => {
    return auditExportService.exportLogs(normalizeExportFormat(format), normalizeLogExportFilter(filter));
  });

  ipcMain.handle(IPC_CHANNELS.logsExportCount, (_event, filter?: LogExportFilter) => {
    return auditExportService.countLogs(normalizeLogExportFilter(filter));
  });

  ipcMain.handle(IPC_CHANNELS.updateAuditExport, (_event, format: ExportFormat, filter?: UpdateAuditTrailFilter) => {
    return auditExportService.exportUpdateAuditTrail(normalizeExportFormat(format), normalizeUpdateAuditTrailFilter(filter));
  });

  ipcMain.handle(IPC_CHANNELS.updateAuditCount, (_event, filter?: UpdateAuditTrailFilter) => {
    return auditExportService.countUpdateAuditTrail(normalizeUpdateAuditTrailFilter(filter));
  });

  ipcMain.handle(IPC_CHANNELS.modelPull, async (event, model: string, approved = false) => {
    const decision = permissionService.check('tools.system.exec', `Baixar modelo ${model}`);
    if (!decision.allowed && !(decision.requiresPrompt && approved)) {
      modelHistoryService.block('pull', model, decision.message);
      return {
        ok: false,
        model,
        message: decision.message,
        output: '',
        errorOutput: decision.message,
        errorCode: 'permission_blocked' as const,
        strategy: 'assist' as const,
        nextSteps: ['Revise a politica tools.system.exec no painel de Permissoes e tente novamente.'],
        manualRequired: true
      };
    }

    const historyRecord = modelHistoryService.start('pull', model, `Iniciando download de ${model}.`);
    let completed = false;

    try {
      const result = await modelService.pullModel(model, (progress) => {
        modelHistoryService.progress(historyRecord.id, progress.message, progress.percent);
        if (progress.phase === 'done' || progress.phase === 'error') {
          completed = true;
          modelHistoryService.finish(
            historyRecord.id,
            progress.phase === 'done' ? 'done' : 'error',
            progress.message,
            progress.percent
          );
        }

        event.sender.send(IPC_CHANNELS.modelProgress, progress);
      });

      if (!completed) {
        modelHistoryService.finish(
          historyRecord.id,
          result.ok ? 'done' : 'error',
          result.message || result.errorOutput,
          result.ok ? 100 : null
        );
      }

      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const fallbackMessage = `Falha inesperada ao baixar modelo ${model}.`;

      if (!completed) {
        modelHistoryService.finish(historyRecord.id, 'error', fallbackMessage, null);
      }

      event.sender.send(IPC_CHANNELS.modelProgress, {
        operation: 'pull',
        model,
        phase: 'error',
        percent: null,
        message: fallbackMessage,
        timestamp: new Date().toISOString()
      });

      logger.error('model.pull.unexpected_error', {
        model,
        reason
      });

      return {
        ok: false,
        model,
        message: fallbackMessage,
        output: '',
        errorOutput: reason,
        errorCode: 'unexpected_error' as const,
        strategy: 'assist' as const,
        nextSteps: ['Confira os logs locais e tente novamente.']
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.modelRemove, async (event, model: string, approved = false) => {
    const decision = permissionService.check('tools.system.exec', `Remover modelo ${model}`);
    if (!decision.allowed && !(decision.requiresPrompt && approved)) {
      modelHistoryService.block('remove', model, decision.message);
      return {
        ok: false,
        model,
        message: decision.message,
        output: '',
        errorOutput: decision.message,
        errorCode: 'permission_blocked' as const,
        strategy: 'assist' as const,
        nextSteps: ['Revise a politica tools.system.exec no painel de Permissoes e tente novamente.'],
        manualRequired: true
      };
    }

    const historyRecord = modelHistoryService.start('remove', model, `Iniciando remocao de ${model}.`);
    let completed = false;

    try {
      const result = await modelService.removeModel(model, (progress) => {
        modelHistoryService.progress(historyRecord.id, progress.message, progress.percent);
        if (progress.phase === 'done' || progress.phase === 'error') {
          completed = true;
          modelHistoryService.finish(
            historyRecord.id,
            progress.phase === 'done' ? 'done' : 'error',
            progress.message,
            progress.percent
          );
        }

        event.sender.send(IPC_CHANNELS.modelProgress, progress);
      });

      if (!completed) {
        modelHistoryService.finish(
          historyRecord.id,
          result.ok ? 'done' : 'error',
          result.message || result.errorOutput,
          result.ok ? 100 : null
        );
      }

      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const fallbackMessage = `Falha inesperada ao remover modelo ${model}.`;

      if (!completed) {
        modelHistoryService.finish(historyRecord.id, 'error', fallbackMessage, null);
      }

      event.sender.send(IPC_CHANNELS.modelProgress, {
        operation: 'remove',
        model,
        phase: 'error',
        percent: null,
        message: fallbackMessage,
        timestamp: new Date().toISOString()
      });

      logger.error('model.remove.unexpected_error', {
        model,
        reason
      });

      return {
        ok: false,
        model,
        message: fallbackMessage,
        output: '',
        errorOutput: reason,
        errorCode: 'unexpected_error' as const,
        strategy: 'assist' as const,
        nextSteps: ['Confira os logs locais e tente novamente.']
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.permissionsList, () => {
    return permissionService.list();
  });

  ipcMain.handle(IPC_CHANNELS.permissionsSet, (_event, scope: PermissionScope, mode: PermissionMode) => {
    if (!isPermissionScope(scope) || !isPermissionMode(mode)) {
      return permissionService.list();
    }

    return permissionService.set(scope, mode);
  });

  ipcMain.handle(IPC_CHANNELS.permissionsCheck, (_event, scope: PermissionScope, action: string) => {
    if (!isPermissionScope(scope) || typeof action !== 'string') {
      return {
        scope: 'tools.system.exec',
        action: 'acao invalida',
        mode: 'deny',
        allowed: false,
        requiresPrompt: false,
        message: 'Solicitacao de permissao invalida.'
      };
    }

    return permissionService.check(scope, action);
  });

  ipcMain.handle(IPC_CHANNELS.updateState, () => {
    return updateService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.updatePolicyGet, () => {
    return updateService.getPolicy();
  });

  ipcMain.handle(IPC_CHANNELS.updatePolicySet, (_event, patch: UpdatePolicyPatch) => {
    return updateService.setPolicy(normalizeUpdatePolicyPatch(patch));
  });

  ipcMain.handle(IPC_CHANNELS.updateCheck, async () => {
    return updateService.checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNELS.updateDownload, async () => {
    return updateService.downloadUpdate();
  });

  ipcMain.handle(IPC_CHANNELS.updateRestartApply, () => {
    return updateService.restartToApplyUpdate();
  });

  ipcMain.handle(IPC_CHANNELS.appBootHealthy, () => {
    reportBootHealthy?.();
  });

  ipcMain.handle(IPC_CHANNELS.appUiAuditEvent, (_event, uiEvent: string, payload?: Record<string, unknown>) => {
    const name = typeof uiEvent === 'string' ? uiEvent.trim().slice(0, 96) : '';
    if (!name) {
      return;
    }

    logger.info('ui.audit.event', {
      event: name,
      payload: payload && typeof payload === 'object' ? payload : undefined
    });
  });

  ipcMain.handle(IPC_CHANNELS.appMinimize, () => {
    getWindow()?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.appToggleTray, () => {
    const window = getWindow();
    if (!window) {
      return;
    }

    if (window.isVisible()) {
      window.hide();
      return;
    }

    window.show();
    window.focus();
  });
}

function isPermissionScope(value: unknown): value is PermissionScope {
  return (
    value === 'runtime.install' ||
    value === 'tools.filesystem.read' ||
    value === 'tools.filesystem.write' ||
    value === 'tools.system.exec'
  );
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

function normalizeHistoryQuery(input: ModelHistoryQuery): ModelHistoryQuery {
  const page = Number.isFinite(input?.page) ? Math.max(1, Math.trunc(input.page)) : 1;
  const pageSize = Number.isFinite(input?.pageSize) ? Math.max(1, Math.trunc(input.pageSize)) : 8;
  const operation =
    input?.operation === 'pull' || input?.operation === 'remove' || input?.operation === 'all'
      ? input.operation
      : 'all';
  const status =
    input?.status === 'running' ||
    input?.status === 'done' ||
    input?.status === 'error' ||
    input?.status === 'blocked' ||
    input?.status === 'all'
      ? input.status
      : 'all';

  return {
    page,
    pageSize,
    operation,
    status
  };
}

function normalizeHistoryFilter(input?: ModelHistoryFilter): ModelHistoryFilter {
  const operation =
    input?.operation === 'pull' || input?.operation === 'remove' || input?.operation === 'all'
      ? input.operation
      : 'all';
  const status =
    input?.status === 'running' ||
    input?.status === 'done' ||
    input?.status === 'error' ||
    input?.status === 'blocked' ||
    input?.status === 'all'
      ? input.status
      : 'all';

  return {
    operation,
    status,
    ...normalizeDateRange(input)
  };
}

function normalizeExportFormat(value: unknown): ExportFormat {
  return value === 'csv' ? 'csv' : 'json';
}

function normalizeDateRange(input?: ExportDateRange): ExportDateRange {
  return {
    dateFrom: normalizeIsoDate(input?.dateFrom),
    dateTo: normalizeIsoDate(input?.dateTo)
  };
}

function normalizeLogExportFilter(input?: LogExportFilter): LogExportFilter {
  return {
    ...normalizeDateRange(input),
    scope: input?.scope === 'updates' ? 'updates' : 'all'
  };
}

function normalizeUpdateAuditTrailFilter(input?: UpdateAuditTrailFilter): UpdateAuditTrailFilter {
  const family =
    input?.family === 'check' ||
    input?.family === 'download' ||
    input?.family === 'apply' ||
    input?.family === 'migration' ||
    input?.family === 'rollback' ||
    input?.family === 'other' ||
    input?.family === 'all'
      ? input.family
      : 'all';
  const severity = input?.severity === 'warn-error' || input?.severity === 'all' ? input.severity : 'all';
  const codeOnly = input?.codeOnly === true;

  return {
    ...normalizeDateRange(input),
    family,
    severity,
    codeOnly
  };
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const normalized = value.trim();
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) {
    return undefined;
  }

  return new Date(ms).toISOString();
}

function normalizeSessionId(input: string): string {
  const normalized = input.trim();
  if (normalized.length > 0) {
    return normalized.slice(0, 128);
  }

  return 'default-session';
}

function buildMemoryLiveSnapshot(memoryStore: MemoryStore, sessionId: string): MemoryLiveSnapshot {
  const shortContext = memoryStore.getShortContext(sessionId);
  const inferredUserName = resolveSessionPreferredUserName(shortContext);
  const recentUserPrompts = shortContext
    .filter((turn): turn is ChatTurn => turn.role === 'user')
    .slice(-4)
    .map((turn) => truncateSingleLine(turn.content, 120));

  return {
    summary: memoryStore.snapshot(),
    session: {
      sessionId,
      shortTermTurns: shortContext.length,
      inferredUserName,
      recentUserPrompts
    },
    longTerm: memoryStore.getLongMemory()
  };
}

function normalizeMemoryClearScope(input: unknown): MemoryClearScope | null {
  if (
    input === 'session.short' ||
    input === 'long.profile' ||
    input === 'long.preferences' ||
    input === 'long.notes'
  ) {
    return input;
  }

  return null;
}

function clearMemoryScope(memoryStore: MemoryStore, scope: MemoryClearScope, sessionId: string): number {
  if (scope === 'session.short') {
    const removed = memoryStore.getShortContext(sessionId).length;
    memoryStore.clearSession(sessionId);
    return removed;
  }

  if (scope === 'long.profile') {
    return memoryStore.clearLongProfileFacts();
  }

  if (scope === 'long.preferences') {
    return memoryStore.clearLongPreferenceFacts();
  }

  return memoryStore.clearLongNotes();
}

function buildMemoryClearMessage(scope: MemoryClearScope, removed: number, sessionId: string): string {
  if (scope === 'session.short') {
    return removed > 0
      ? `Memoria curta da sessao ${sessionId} limpa (${removed} turnos removidos).`
      : `A sessao ${sessionId} ja estava sem memoria curta ativa.`;
  }

  if (scope === 'long.profile') {
    return removed > 0
      ? `Perfil persistente limpo (${removed} fato(s) removido(s)).`
      : 'Perfil persistente ja estava vazio.';
  }

  if (scope === 'long.preferences') {
    return removed > 0
      ? `Preferencias persistentes limpas (${removed} fato(s) removido(s)).`
      : 'Preferencias persistentes ja estavam vazias.';
  }

  return removed > 0
    ? `Notas persistentes limpas (${removed} nota(s) removida(s)).`
    : 'Notas persistentes ja estavam vazias.';
}

function truncateSingleLine(input: string, maxChars: number): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizeUpdatePolicyPatch(input: UpdatePolicyPatch | undefined): UpdatePolicyPatch {
  return {
    channel: input?.channel === 'rc' || input?.channel === 'stable' ? input.channel : undefined,
    autoCheck: typeof input?.autoCheck === 'boolean' ? input.autoCheck : undefined
  };
}
