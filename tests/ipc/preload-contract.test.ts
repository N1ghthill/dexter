import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DexterApi } from '@shared/api';
import { IPC_CHANNELS } from '@shared/ipc';

afterEach(() => {
  delete process.env.DEXTER_MOCK_API;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('preload IPC contracts', () => {
  it('expoe runtime API e encaminha chamadas para os canais corretos', async () => {
    const setup = await loadPreload({ useMockApi: false });
    const api = setup.api;

    await api.chat({
      sessionId: 's1',
      input: 'oi'
    });
    expect(setup.invoke).toHaveBeenCalledWith(IPC_CHANNELS.chat, {
      sessionId: 's1',
      input: 'oi'
    });

    await api.setModel('llama3.2:3b');
    expect(setup.invoke).toHaveBeenCalledWith(IPC_CHANNELS.configSetModel, 'llama3.2:3b');

    await api.health();
    await api.getConfig();
    await api.memorySnapshot();
    await api.runtimeStatus();
    await api.installRuntime(true);
    await api.startRuntime(true);
    await api.listCuratedModels();
    await api.listInstalledModels();
    await api.listModelHistory({
      page: 1,
      pageSize: 8,
      operation: 'all',
      status: 'all'
    });
    await api.exportModelHistory('json', {
      operation: 'all',
      status: 'all'
    });
    await api.exportLogs('csv', {
      dateFrom: '2026-02-20T00:00:00.000Z',
      dateTo: '2026-02-22T23:59:59.999Z'
    });
    await api.pullModel('llama3.2:3b', true);
    await api.removeModel('llama3.2:3b', true);
    await api.listPermissions();
    await api.setPermission('tools.system.exec', 'allow');
    await api.checkPermission('tools.system.exec', 'Executar comando');
    await api.minimize();
    await api.toggleVisibility();

    const listener = vi.fn();
    const unsubscribe = api.onModelProgress(listener);
    expect(setup.on).toHaveBeenCalledWith(IPC_CHANNELS.modelProgress, expect.any(Function));

    const handler = setup.on.mock.calls[0]?.[1];
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') {
      throw new Error('Listener de progresso nao foi registrado');
    }

    handler({}, {
      operation: 'pull',
      model: 'llama3.2:3b',
      phase: 'progress',
      percent: 42,
      message: 'Download 42%',
      timestamp: new Date().toISOString()
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ operation: 'pull', percent: 42 }));

    unsubscribe();
    expect(setup.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.modelProgress, handler);

    const calledChannels = setup.invoke.mock.calls.map((call) => call[0]);
    const expectedChannels = [
      IPC_CHANNELS.chat,
      IPC_CHANNELS.health,
      IPC_CHANNELS.configGet,
      IPC_CHANNELS.configSetModel,
      IPC_CHANNELS.memorySnapshot,
      IPC_CHANNELS.runtimeStatus,
      IPC_CHANNELS.runtimeInstall,
      IPC_CHANNELS.runtimeStart,
      IPC_CHANNELS.modelsCurated,
      IPC_CHANNELS.modelsInstalled,
      IPC_CHANNELS.modelsHistory,
      IPC_CHANNELS.modelsHistoryExport,
      IPC_CHANNELS.logsExport,
      IPC_CHANNELS.modelPull,
      IPC_CHANNELS.modelRemove,
      IPC_CHANNELS.permissionsList,
      IPC_CHANNELS.permissionsSet,
      IPC_CHANNELS.permissionsCheck,
      IPC_CHANNELS.appMinimize,
      IPC_CHANNELS.appToggleTray
    ];

    for (const channel of expectedChannels) {
      expect(calledChannels).toContain(channel);
    }
  });

  it('expoe API mock quando DEXTER_MOCK_API=1 sem usar ipcRenderer.invoke', async () => {
    const setup = await loadPreload({ useMockApi: true });
    const api = setup.api;

    const reply = await api.chat({
      sessionId: 's1',
      input: 'teste'
    });
    const progressEvents: Array<{ operation: string; phase: string }> = [];
    const unsubscribe = api.onModelProgress((event) => {
      progressEvents.push({
        operation: event.operation,
        phase: event.phase
      });
    });

    await api.getConfig();
    await api.setModel('qwen2.5:7b');
    await api.runtimeStatus();
    await api.health();
    await api.installRuntime(true);
    await api.startRuntime(true);
    await api.listCuratedModels();
    await api.listInstalledModels();
    await api.memorySnapshot();
    await api.pullModel('llama3.2:3b', true);
    await api.removeModel('llama3.2:3b', true);
    await api.listModelHistory({
      page: 1,
      pageSize: 8,
      operation: 'all',
      status: 'all'
    });
    await api.exportModelHistory('csv', {
      operation: 'all',
      status: 'all'
    });
    await api.exportLogs('json');
    await api.setPermission('tools.system.exec', 'allow');
    const permissions = await api.listPermissions();
    await api.checkPermission('tools.system.exec', 'Executar comando');
    await api.minimize();
    await api.toggleVisibility();
    unsubscribe();

    expect(reply.content).toContain('Resposta mock');
    expect(permissions).toHaveLength(4);
    expect(progressEvents.some((item) => item.operation === 'pull')).toBe(true);
    expect(progressEvents.some((item) => item.operation === 'remove')).toBe(true);
    expect(setup.invoke).not.toHaveBeenCalled();
  });

  it('aplica filtros de data no mock para historico/logs e ignora datas invalidas', async () => {
    const setup = await loadPreload({ useMockApi: true });
    const api = setup.api;

    await api.setPermission('tools.system.exec', 'allow');
    await api.pullModel('llama3.2:3b', false);

    const historyFiltered = await api.exportModelHistory('json', {
      operation: 'all',
      status: 'all',
      dateFrom: '2999-01-01T00:00:00.000Z'
    });
    const historyItems = JSON.parse(historyFiltered.content) as unknown[];
    expect(historyItems).toHaveLength(0);

    const logsFiltered = await api.exportLogs('json', {
      dateTo: '2000-01-01T00:00:00.000Z'
    });
    const logsFilteredItems = JSON.parse(logsFiltered.content) as unknown[];
    expect(logsFilteredItems).toHaveLength(0);

    const logsWithInvalidRange = await api.exportLogs('json', {
      dateFrom: 'data-invalida',
      dateTo: 'tambem-invalida'
    });
    const logsWithInvalidRangeItems = JSON.parse(logsWithInvalidRange.content) as unknown[];
    expect(logsWithInvalidRangeItems.length).toBeGreaterThan(0);
    expect(setup.invoke).not.toHaveBeenCalled();
  });

  it('exercita politicas de permissao ask/deny/allow no mock', async () => {
    const setup = await loadPreload({ useMockApi: true });
    const api = setup.api;

    const askDecision = await api.checkPermission('runtime.install', 'Instalar runtime');
    expect(askDecision).toMatchObject({
      mode: 'ask',
      allowed: false,
      requiresPrompt: true
    });

    await api.setPermission('runtime.install', 'deny');
    const deniedInstall = await api.installRuntime(false);
    expect(deniedInstall.ok).toBe(false);
    expect(deniedInstall.errorOutput).toContain('Bloqueado por politica: runtime.install.');

    await api.setPermission('tools.system.exec', 'deny');
    const deniedStart = await api.startRuntime(false);
    expect(deniedStart.notes[0]).toContain('Bloqueado por politica: tools.system.exec.');

    const deniedPull = await api.pullModel('llama3.2:3b', false);
    expect(deniedPull.ok).toBe(false);
    expect(deniedPull.errorOutput).toContain('Bloqueado por politica: tools.system.exec.');

    const deniedRemove = await api.removeModel('llama3.2:3b', false);
    expect(deniedRemove.ok).toBe(false);
    expect(deniedRemove.errorOutput).toContain('Bloqueado por politica: tools.system.exec.');

    const denyDecision = await api.checkPermission('tools.system.exec', 'Executar comando');
    expect(denyDecision).toMatchObject({
      mode: 'deny',
      allowed: false,
      requiresPrompt: false
    });

    await api.setPermission('tools.system.exec', 'allow');
    const allowDecision = await api.checkPermission('tools.system.exec', 'Executar comando');
    expect(allowDecision).toMatchObject({
      mode: 'allow',
      allowed: true,
      requiresPrompt: false
    });
    expect(setup.invoke).not.toHaveBeenCalled();
  });

  it('filtra historico paginado no mock, exporta CSV e limita historico em 200 entradas', async () => {
    const setup = await loadPreload({ useMockApi: true });
    const api = setup.api;

    await api.setPermission('tools.system.exec', 'allow');
    await api.pullModel('llama3.2:3b', false);
    await api.pullModel('qwen2.5:7b', false);
    await api.removeModel('qwen2.5:7b', false);

    const filteredPage = await api.listModelHistory({
      page: 99,
      pageSize: 1,
      operation: 'pull',
      status: 'done'
    });
    expect(filteredPage.total).toBeGreaterThan(0);
    expect(filteredPage.items).toHaveLength(1);
    expect(filteredPage.items.every((item) => item.operation === 'pull' && item.status === 'done')).toBe(true);
    expect(filteredPage.page).toBe(filteredPage.totalPages);

    const historyCsv = await api.exportModelHistory('csv', {
      operation: 'pull',
      status: 'done'
    });
    expect(historyCsv.fileName).toMatch(/^dexter-model-history-.*\.csv$/);
    expect(historyCsv.mimeType).toBe('text/csv;charset=utf-8');
    expect(historyCsv.content).toContain('operation,model,status');

    const logsCsv = await api.exportLogs('csv');
    expect(logsCsv.fileName).toMatch(/^dexter-logs-.*\.csv$/);
    expect(logsCsv.content).toContain('"');

    await api.setPermission('tools.system.exec', 'deny');
    for (let i = 0; i < 210; i += 1) {
      await api.pullModel(`model-${i}`, false);
    }

    const boundedHistory = await api.listModelHistory({
      page: 1,
      pageSize: 500,
      operation: 'all',
      status: 'all'
    });
    expect(boundedHistory.total).toBe(200);
    expect(setup.invoke).not.toHaveBeenCalled();
  });

  it('descarta timestamps invalidos na exportacao de logs do mock', async () => {
    const setup = await loadPreload({ useMockApi: true });
    const api = setup.api;

    await api.setPermission('tools.system.exec', 'allow');

    const isoSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('data-invalida');
    try {
      await api.pullModel('modelo-com-data-invalida', false);
    } finally {
      isoSpy.mockRestore();
    }

    const logs = await api.exportLogs('json');
    const parsed = JSON.parse(logs.content) as Array<{ ts?: string }>;
    expect(parsed.some((item) => item.ts === 'data-invalida')).toBe(false);
    expect(setup.invoke).not.toHaveBeenCalled();
  });

  it('cobre estados de health/runtime e defaults de historico no mock', async () => {
    const setup = await loadPreload({ useMockApi: true });
    const api = setup.api;

    const initialHealth = await api.health();
    expect(initialHealth.ok).toBe(false);
    expect(initialHealth.ollamaReachable).toBe(false);
    expect(initialHealth.details[0]).toContain('Runtime mock offline');

    const deniedStart = await api.startRuntime(false);
    expect(deniedStart.notes[0]).toContain('Dexter solicita confirmacao');

    await api.setModel('   ');
    const initialConfig = await api.getConfig();
    expect(initialConfig.model).toBe('llama3.2:3b');

    await api.installRuntime(true);
    const healthWithoutModel = await api.health();
    expect(healthWithoutModel.ollamaReachable).toBe(true);
    expect(healthWithoutModel.modelAvailable).toBe(false);
    expect(healthWithoutModel.ok).toBe(false);
    expect(healthWithoutModel.details).toEqual([]);

    await api.pullModel('llama3.2:3b', true);
    const readyHealth = await api.health();
    expect(readyHealth.ok).toBe(true);
    expect(readyHealth.details).toEqual([]);

    const onlineStatus = await api.runtimeStatus();
    expect(onlineStatus.notes).toEqual([]);

    const defaultedHistory = await api.listModelHistory({
      page: Number.NaN,
      pageSize: Number.NaN
    } as never);
    expect(defaultedHistory.page).toBe(1);
    expect(defaultedHistory.pageSize).toBe(8);

    const noFilterExport = await api.exportModelHistory('json');
    const exportedItems = JSON.parse(noFilterExport.content) as unknown[];
    expect(exportedItems.length).toBeGreaterThan(0);
    expect(setup.invoke).not.toHaveBeenCalled();
  });

  it('cobre erro simulado e CSV com campos nulos/sem meta no mock', async () => {
    const setup = await loadPreload({ useMockApi: true });
    const api = setup.api;

    await api.setPermission('tools.system.exec', 'allow');
    const pullFail = await api.pullModel('model-fail', false);
    const removeFail = await api.removeModel('remove-error', false);
    expect(pullFail.ok).toBe(false);
    expect(removeFail.ok).toBe(false);

    await api.setPermission('tools.system.exec', 'deny');
    await api.pullModel('bloqueado', false);
    await api.removeModel('bloqueado', false);

    const historyCsv = await api.exportModelHistory('csv', {
      operation: 'all',
      status: 'all'
    });
    expect(historyCsv.content).toContain('id,operation,model,status,message,startedAt,finishedAt,durationMs,percent');
    expect(historyCsv.content).toContain('blocked');
    expect(historyCsv.content).toContain(',,,');

    const logsCsv = await api.exportLogs('csv');
    expect(logsCsv.content).toContain('ts,level,message,meta');
    expect(logsCsv.content).toContain('mock.model.pull');
    expect(logsCsv.content).toContain('mock.model.remove');
    expect(logsCsv.content).toContain('mock.runtime.status,');
    expect(logsCsv.content).toContain(',error,');
    expect(setup.invoke).not.toHaveBeenCalled();
  });
});

async function loadPreload(options: { useMockApi: boolean }): Promise<{
  api: DexterApi;
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  if (options.useMockApi) {
    process.env.DEXTER_MOCK_API = '1';
  } else {
    delete process.env.DEXTER_MOCK_API;
  }

  const invoke = vi.fn(async () => ({}));
  const on = vi.fn();
  const removeListener = vi.fn();
  let exposedApi: DexterApi | null = null;

  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: vi.fn((_key: string, api: DexterApi) => {
        exposedApi = api;
      })
    },
    ipcRenderer: {
      invoke,
      on,
      removeListener
    }
  }));

  await import('@main/preload');

  if (!exposedApi) {
    throw new Error('API nao foi exposta pelo preload');
  }

  return {
    api: exposedApi,
    invoke,
    on,
    removeListener
  };
}
