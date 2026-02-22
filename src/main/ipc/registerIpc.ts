import { ipcMain, BrowserWindow } from 'electron';
import type { ChatRequest, ExportDateRange, ExportFormat, ModelHistoryFilter, ModelHistoryQuery } from '@shared/contracts';
import { IPC_CHANNELS } from '@shared/ipc';
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
  logger: Logger;
  getWindow: () => BrowserWindow | null;
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
    logger,
    getWindow
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

  ipcMain.handle(IPC_CHANNELS.runtimeStatus, async () => {
    return runtimeService.status();
  });

  ipcMain.handle(IPC_CHANNELS.runtimeInstall, async (_event, approved = false) => {
    const decision = permissionService.check('runtime.install', 'Instalar runtime local');
    if (!decision.allowed && !(decision.requiresPrompt && approved)) {
      return {
        ok: false,
        command: '',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: null,
        output: '',
        errorOutput: decision.message
      };
    }

    return runtimeService.installRuntime();
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

  ipcMain.handle(IPC_CHANNELS.logsExport, (_event, format: ExportFormat, range?: ExportDateRange) => {
    return auditExportService.exportLogs(normalizeExportFormat(format), normalizeDateRange(range));
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
        errorOutput: decision.message
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
        errorOutput: reason
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
        errorOutput: decision.message
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
        errorOutput: reason
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
