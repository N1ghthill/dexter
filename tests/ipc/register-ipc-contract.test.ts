import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('registerIpc contracts', () => {
  it('registra todos os canais esperados', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();

    setup.registerIpc(deps);

    const handledChannels = Object.values(IPC_CHANNELS).filter((channel) => channel !== IPC_CHANNELS.modelProgress);

    expect(setup.ipcMainHandle).toHaveBeenCalledTimes(handledChannels.length);
    for (const channel of handledChannels) {
      expect(setup.handlers.has(channel)).toBe(true);
    }
  });

  it('normaliza query de historico recebida via IPC', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const handler = mustHandler(setup.handlers, IPC_CHANNELS.modelsHistory);
    await handler({}, { page: 0, pageSize: 0, operation: 'desconhecido', status: 'invalido' });

    expect(deps.modelHistoryService.query).toHaveBeenCalledWith({
      page: 1,
      pageSize: 1,
      operation: 'all',
      status: 'all'
    });
  });

  it('mantem valores validos na normalizacao de historico/filtro e cobre handlers basicos', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const chat = mustHandler(setup.handlers, IPC_CHANNELS.chat);
    const health = mustHandler(setup.handlers, IPC_CHANNELS.health);
    const configGet = mustHandler(setup.handlers, IPC_CHANNELS.configGet);
    const memorySnapshot = mustHandler(setup.handlers, IPC_CHANNELS.memorySnapshot);
    const runtimeStatus = mustHandler(setup.handlers, IPC_CHANNELS.runtimeStatus);
    const modelsCurated = mustHandler(setup.handlers, IPC_CHANNELS.modelsCurated);
    const modelsInstalled = mustHandler(setup.handlers, IPC_CHANNELS.modelsInstalled);
    const modelsHistory = mustHandler(setup.handlers, IPC_CHANNELS.modelsHistory);
    const modelsHistoryExport = mustHandler(setup.handlers, IPC_CHANNELS.modelsHistoryExport);
    const permissionsList = mustHandler(setup.handlers, IPC_CHANNELS.permissionsList);
    const permissionsSet = mustHandler(setup.handlers, IPC_CHANNELS.permissionsSet);

    await chat({}, { sessionId: 's-basic', input: 'oi' });
    await health({});
    await configGet({});
    await memorySnapshot({});
    await runtimeStatus({});
    await modelsCurated({});
    await modelsInstalled({});
    await modelsHistory({}, { page: 2, pageSize: 7, operation: 'pull', status: 'running' });
    await modelsHistoryExport(
      {},
      'csv',
      {
        operation: 'remove',
        status: 'blocked',
        dateFrom: '2026-02-20T10:00:00.000Z',
        dateTo: '2026-02-20T12:00:00.000Z'
      }
    );
    await permissionsList({});
    await permissionsSet({}, 'scope.invalido', 'allow');

    expect(deps.logger.info).toHaveBeenCalledWith('ipc.chat', {
      sessionId: 's-basic'
    });
    expect(deps.brain.respond).toHaveBeenCalledWith({
      sessionId: 's-basic',
      input: 'oi'
    });
    expect(deps.healthService.report).toHaveBeenCalledTimes(1);
    expect(deps.configStore.get).toHaveBeenCalled();
    expect(deps.memoryStore.snapshot).toHaveBeenCalledTimes(1);
    expect(deps.runtimeService.status).toHaveBeenCalledTimes(1);
    expect(deps.modelService.listCurated).toHaveBeenCalledTimes(1);
    expect(deps.modelService.listInstalled).toHaveBeenCalledTimes(1);
    expect(deps.modelHistoryService.query).toHaveBeenCalledWith({
      page: 2,
      pageSize: 7,
      operation: 'pull',
      status: 'running'
    });
    expect(deps.auditExportService.exportModelHistory).toHaveBeenCalledWith(
      'csv',
      expect.objectContaining({
        operation: 'remove',
        status: 'blocked'
      })
    );
    expect(deps.permissionService.list).toHaveBeenCalled();
    expect(deps.permissionService.set).not.toHaveBeenCalled();
  });

  it('normaliza filtro de exportacao de logs (datas + scope)', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const handler = mustHandler(setup.handlers, IPC_CHANNELS.logsExport);
    await handler({}, 'csv', { dateFrom: '2026-02-20', dateTo: 'nao-e-data', scope: 'zzz' });

    expect(deps.auditExportService.exportLogs).toHaveBeenCalled();
    const firstCall = deps.auditExportService.exportLogs.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error('exportLogs nao recebeu argumentos');
    }

    const [formatArg, rangeArg] = firstCall;

    expect(formatArg).toBe('csv');
    expect(rangeArg).toMatchObject({
      dateTo: undefined,
      scope: 'all'
    });
    expect(typeof rangeArg.dateFrom).toBe('string');

    await handler({}, 'json', { scope: 'updates' });
    const secondCall = deps.auditExportService.exportLogs.mock.calls[1];
    expect(secondCall?.[1]).toMatchObject({
      scope: 'updates'
    });

    const countHandler = mustHandler(setup.handlers, IPC_CHANNELS.logsExportCount);
    await countHandler({}, { dateTo: 'nao', scope: 'invalid' });
    const countCall = deps.auditExportService.countLogs.mock.calls[0];
    expect(countCall?.[0]).toMatchObject({
      dateTo: undefined,
      scope: 'all'
    });

    const updateAuditHandler = mustHandler(setup.handlers, IPC_CHANNELS.updateAuditExport);
    await updateAuditHandler({}, 'csv', {
      dateFrom: '2026-02-22',
      dateTo: 'invalida',
      family: 'bad',
      severity: 'oops',
      codeOnly: 'nope' as never
    });
    const updateAuditCall = deps.auditExportService.exportUpdateAuditTrail.mock.calls[0];
    expect(updateAuditCall?.[0]).toBe('csv');
    expect(updateAuditCall?.[1]).toMatchObject({
      dateTo: undefined,
      family: 'all',
      severity: 'all',
      codeOnly: false
    });
    expect(typeof updateAuditCall?.[1]?.dateFrom).toBe('string');

    await updateAuditHandler({}, 'json', { family: 'migration', severity: 'warn-error', codeOnly: true });
    const secondUpdateAuditCall = deps.auditExportService.exportUpdateAuditTrail.mock.calls[1];
    expect(secondUpdateAuditCall?.[1]).toMatchObject({
      family: 'migration',
      severity: 'warn-error',
      codeOnly: true
    });

    const updateAuditCountHandler = mustHandler(setup.handlers, IPC_CHANNELS.updateAuditCount);
    await updateAuditCountHandler({}, { family: 'zzz', severity: 'bad', codeOnly: 'x' as never, dateTo: 'bad-date' });
    const updateAuditCountCall = deps.auditExportService.countUpdateAuditTrail.mock.calls[0];
    expect(updateAuditCountCall?.[0]).toMatchObject({
      family: 'all',
      severity: 'all',
      codeOnly: false,
      dateTo: undefined
    });

    await updateAuditCountHandler({}, { family: 'check', severity: 'warn-error', codeOnly: true });
    const secondUpdateAuditCountCall = deps.auditExportService.countUpdateAuditTrail.mock.calls[1];
    expect(secondUpdateAuditCountCall?.[0]).toMatchObject({
      family: 'check',
      severity: 'warn-error',
      codeOnly: true
    });
  });

  it('fecha historico com erro e notifica progresso quando pull falha de forma inesperada', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();

    deps.modelService.pullModel.mockRejectedValue(new Error('kaboom'));
    deps.modelHistoryService.start.mockReturnValue({
      id: 'rec-1'
    });

    setup.registerIpc(deps);
    const handler = mustHandler(setup.handlers, IPC_CHANNELS.modelPull);
    const send = vi.fn();

    const result = await handler({ sender: { send } }, 'llama3.2:3b', false);

    expect(result).toMatchObject({
      ok: false,
      model: 'llama3.2:3b'
    });
    expect(deps.modelHistoryService.finish).toHaveBeenCalledWith(
      'rec-1',
      'error',
      'Falha inesperada ao baixar modelo llama3.2:3b.',
      null
    );
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.modelProgress,
      expect.objectContaining({
        operation: 'pull',
        model: 'llama3.2:3b',
        phase: 'error'
      })
    );
    expect(deps.logger.error).toHaveBeenCalledWith(
      'model.pull.unexpected_error',
      expect.objectContaining({
        model: 'llama3.2:3b',
        reason: 'kaboom'
      })
    );
  });

  it('valida canais de permissoes, config e controles da janela', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    const window = {
      minimize: vi.fn(),
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isVisible: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    };
    deps.getWindow.mockReturnValue(window);

    setup.registerIpc(deps);

    const configSetModel = mustHandler(setup.handlers, IPC_CHANNELS.configSetModel);
    await configSetModel({}, '  qwen2.5:7b  ');
    expect(deps.configStore.setModel).toHaveBeenCalledWith('qwen2.5:7b');

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'runtime.install',
      action: 'Instalar runtime local',
      mode: 'ask',
      allowed: false,
      requiresPrompt: true,
      message: 'Aprovacao necessaria'
    });
    const runtimeInstall = mustHandler(setup.handlers, IPC_CHANNELS.runtimeInstall);
    const installResult = await runtimeInstall({}, false);
    expect(installResult).toMatchObject({
      ok: false,
      errorOutput: 'Aprovacao necessaria'
    });

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'tools.system.exec',
      action: 'Iniciar runtime local',
      mode: 'deny',
      allowed: false,
      requiresPrompt: false,
      message: 'Bloqueado'
    });
    const runtimeStart = mustHandler(setup.handlers, IPC_CHANNELS.runtimeStart);
    await runtimeStart({}, false);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'permission.blocked',
      expect.objectContaining({
        scope: 'tools.system.exec'
      })
    );

    const permissionsCheck = mustHandler(setup.handlers, IPC_CHANNELS.permissionsCheck);
    const invalidPermission = await permissionsCheck({}, 'scope.invalido', 123);
    expect(invalidPermission).toMatchObject({
      mode: 'deny',
      allowed: false
    });

    const appMinimize = mustHandler(setup.handlers, IPC_CHANNELS.appMinimize);
    await appMinimize({});
    expect(window.minimize).toHaveBeenCalledTimes(1);

    const appToggle = mustHandler(setup.handlers, IPC_CHANNELS.appToggleTray);
    await appToggle({});
    await appToggle({});
    expect(window.hide).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('retorna config atual quando modelo informado e vazio e cobre janela ausente', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    deps.getWindow.mockReturnValue(null);

    setup.registerIpc(deps);

    const configSetModel = mustHandler(setup.handlers, IPC_CHANNELS.configSetModel);
    const result = await configSetModel({}, '   ');

    expect(result).toEqual({
      model: 'llama3.2:3b',
      endpoint: 'http://127.0.0.1:11434',
      personality: 'Dexter'
    });
    expect(deps.configStore.setModel).not.toHaveBeenCalled();
    expect(deps.logger.info).not.toHaveBeenCalledWith('config.model_updated', expect.anything());

    const appToggle = mustHandler(setup.handlers, IPC_CHANNELS.appToggleTray);
    await appToggle({});
  });

  it('executa runtime install/start quando permissao ask e aprovada', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'runtime.install',
      action: 'Instalar runtime local',
      mode: 'ask',
      allowed: false,
      requiresPrompt: true,
      message: 'Aprovacao'
    });

    const runtimeInstall = mustHandler(setup.handlers, IPC_CHANNELS.runtimeInstall);
    await runtimeInstall({}, true);
    expect(deps.runtimeService.installRuntime).toHaveBeenCalledTimes(1);

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'tools.system.exec',
      action: 'Iniciar runtime local',
      mode: 'ask',
      allowed: false,
      requiresPrompt: true,
      message: 'Aprovacao'
    });

    const runtimeStart = mustHandler(setup.handlers, IPC_CHANNELS.runtimeStart);
    await runtimeStart({}, true);
    expect(deps.runtimeService.startRuntime).toHaveBeenCalledTimes(1);
  });

  it('cobre bloqueio e finalizacao automatica do pull sem evento terminal', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'tools.system.exec',
      action: 'Baixar modelo llama3.2:3b',
      mode: 'deny',
      allowed: false,
      requiresPrompt: false,
      message: 'Bloqueado por politica'
    });
    const pullHandler = mustHandler(setup.handlers, IPC_CHANNELS.modelPull);

    const denied = await pullHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(denied).toMatchObject({
      ok: false,
      model: 'llama3.2:3b'
    });
    expect(deps.modelHistoryService.block).toHaveBeenCalledWith('pull', 'llama3.2:3b', 'Bloqueado por politica');

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'pull-rec-1' });
    deps.modelService.pullModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'pull',
        model: 'llama3.2:3b',
        phase: 'progress',
        percent: 37,
        message: 'Download 37%',
        timestamp: new Date().toISOString()
      });

      return {
        ok: true,
        model: 'llama3.2:3b',
        message: 'Concluido fora do callback',
        output: 'ok',
        errorOutput: ''
      };
    });

    const send = vi.fn();
    const success = await pullHandler({ sender: { send } }, 'llama3.2:3b', false);
    expect(success).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.modelProgress,
      expect.objectContaining({
        phase: 'progress'
      })
    );
    expect(deps.modelHistoryService.finish).toHaveBeenCalledWith('pull-rec-1', 'done', 'Concluido fora do callback', 100);
  });

  it('evita finalizacao duplicada no pull quando callback ja recebeu done', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'pull-rec-2' });
    deps.modelService.pullModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'pull',
        model: 'llama3.2:3b',
        phase: 'done',
        percent: 100,
        message: 'Concluido no callback',
        timestamp: new Date().toISOString()
      });

      return {
        ok: true,
        model: 'llama3.2:3b',
        message: 'Concluido retorno',
        output: '',
        errorOutput: ''
      };
    });

    const send = vi.fn();
    await mustHandler(setup.handlers, IPC_CHANNELS.modelPull)({ sender: { send } }, 'llama3.2:3b', false);

    const finishCalls = deps.modelHistoryService.finish.mock.calls.filter((call: any[]) => call[0] === 'pull-rec-2');
    expect(finishCalls).toHaveLength(1);
    expect(finishCalls[0]).toEqual(['pull-rec-2', 'done', 'Concluido no callback', 100]);
  });

  it('cobre bloqueio e erro inesperado no remove', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'tools.system.exec',
      action: 'Remover modelo llama3.2:3b',
      mode: 'deny',
      allowed: false,
      requiresPrompt: false,
      message: 'Bloqueado'
    });

    const removeHandler = mustHandler(setup.handlers, IPC_CHANNELS.modelRemove);
    const denied = await removeHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(denied).toMatchObject({ ok: false });
    expect(deps.modelHistoryService.block).toHaveBeenCalledWith('remove', 'llama3.2:3b', 'Bloqueado');

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'rm-rec-1' });
    deps.modelService.removeModel.mockRejectedValueOnce(new Error('remove kaboom'));

    const send = vi.fn();
    const failed = await removeHandler({ sender: { send } }, 'llama3.2:3b', false);
    expect(failed).toMatchObject({
      ok: false,
      model: 'llama3.2:3b'
    });
    expect(deps.modelHistoryService.finish).toHaveBeenCalledWith(
      'rm-rec-1',
      'error',
      'Falha inesperada ao remover modelo llama3.2:3b.',
      null
    );
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.modelProgress,
      expect.objectContaining({
        operation: 'remove',
        phase: 'error'
      })
    );
    expect(deps.logger.error).toHaveBeenCalledWith(
      'model.remove.unexpected_error',
      expect.objectContaining({
        reason: 'remove kaboom'
      })
    );
  });

  it('cobre sucesso do remove com finalizacao automatica e sem duplicidade', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const removeHandler = mustHandler(setup.handlers, IPC_CHANNELS.modelRemove);
    const send = vi.fn();

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'rm-rec-2' });
    deps.modelService.removeModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'remove',
        model: 'llama3.2:3b',
        phase: 'progress',
        percent: null,
        message: 'Removendo 50%',
        timestamp: new Date().toISOString()
      });

      return {
        ok: true,
        model: 'llama3.2:3b',
        message: 'Remocao concluida fora do callback',
        output: 'ok',
        errorOutput: ''
      };
    });

    const first = await removeHandler({ sender: { send } }, 'llama3.2:3b', false);
    expect(first).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.modelProgress,
      expect.objectContaining({
        operation: 'remove',
        phase: 'progress'
      })
    );
    expect(deps.modelHistoryService.finish).toHaveBeenCalledWith(
      'rm-rec-2',
      'done',
      'Remocao concluida fora do callback',
      100
    );

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'rm-rec-3' });
    deps.modelService.removeModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'remove',
        model: 'llama3.2:3b',
        phase: 'done',
        percent: null,
        message: 'Concluido no callback',
        timestamp: new Date().toISOString()
      });

      return {
        ok: true,
        model: 'llama3.2:3b',
        message: 'Concluido retorno',
        output: '',
        errorOutput: ''
      };
    });

    await removeHandler({ sender: { send } }, 'llama3.2:3b', false);
    const finishCalls = deps.modelHistoryService.finish.mock.calls.filter((call: any[]) => call[0] === 'rm-rec-3');
    expect(finishCalls).toHaveLength(1);
    expect(finishCalls[0]).toEqual(['rm-rec-3', 'done', 'Concluido no callback', null]);
  });

  it('normaliza export de historico e exercita permissoes validas', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const historyExport = mustHandler(setup.handlers, IPC_CHANNELS.modelsHistoryExport);
    await historyExport(
      {},
      'xml',
      {
        operation: 'desconhecido',
        status: 'invalido',
        dateFrom: '',
        dateTo: '2026-02-20'
      } as any
    );

    expect(deps.auditExportService.exportModelHistory).toHaveBeenCalledWith(
      'json',
      expect.objectContaining({
        operation: 'all',
        status: 'all',
        dateFrom: undefined
      })
    );

    const permissionsSet = mustHandler(setup.handlers, IPC_CHANNELS.permissionsSet);
    await permissionsSet({}, 'tools.system.exec', 'allow');
    expect(deps.permissionService.set).toHaveBeenCalledWith('tools.system.exec', 'allow');

    const permissionsCheck = mustHandler(setup.handlers, IPC_CHANNELS.permissionsCheck);
    await permissionsCheck({}, 'tools.system.exec', 'Executar');
    expect(deps.permissionService.check).toHaveBeenCalledWith('tools.system.exec', 'Executar');
  });

  it('cobre fallback de pagina e modos ask/deny em permissionsSet', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const modelsHistory = mustHandler(setup.handlers, IPC_CHANNELS.modelsHistory);
    await modelsHistory(
      {},
      {
        page: Number.NaN,
        pageSize: Number.POSITIVE_INFINITY,
        operation: 'pull',
        status: 'done'
      }
    );
    expect(deps.modelHistoryService.query).toHaveBeenCalledWith({
      page: 1,
      pageSize: 8,
      operation: 'pull',
      status: 'done'
    });

    const permissionsSet = mustHandler(setup.handlers, IPC_CHANNELS.permissionsSet);
    await permissionsSet({}, 'tools.system.exec', 'ask');
    await permissionsSet({}, 'tools.system.exec', 'deny');
    expect(deps.permissionService.set).toHaveBeenNthCalledWith(1, 'tools.system.exec', 'ask');
    expect(deps.permissionService.set).toHaveBeenNthCalledWith(2, 'tools.system.exec', 'deny');
  });

  it('cobre canais de update com normalizacao de policy patch', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const getState = mustHandler(setup.handlers, IPC_CHANNELS.updateState);
    const getPolicy = mustHandler(setup.handlers, IPC_CHANNELS.updatePolicyGet);
    const setPolicy = mustHandler(setup.handlers, IPC_CHANNELS.updatePolicySet);
    const check = mustHandler(setup.handlers, IPC_CHANNELS.updateCheck);
    const download = mustHandler(setup.handlers, IPC_CHANNELS.updateDownload);
    const restartApply = mustHandler(setup.handlers, IPC_CHANNELS.updateRestartApply);

    await getState({});
    await getPolicy({});
    await setPolicy({}, {
      channel: 'zzz',
      autoCheck: 'nao-bool'
    });
    await check({});
    await download({});
    await restartApply({});

    expect(deps.updateService.getState).toHaveBeenCalledTimes(1);
    expect(deps.updateService.getPolicy).toHaveBeenCalledTimes(1);
    expect(deps.updateService.setPolicy).toHaveBeenCalledWith({
      channel: undefined,
      autoCheck: undefined
    });
    expect(deps.updateService.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(deps.updateService.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(deps.updateService.restartToApplyUpdate).toHaveBeenCalledTimes(1);
  });

  it('cobre ramos restantes de pull (prompt negado, erro de retorno e excecao textual)', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const pullHandler = mustHandler(setup.handlers, IPC_CHANNELS.modelPull);

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'tools.system.exec',
      action: 'Baixar modelo llama3.2:3b',
      mode: 'ask',
      allowed: false,
      requiresPrompt: true,
      message: 'Precisa aprovar'
    });
    const denied = await pullHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(denied).toMatchObject({
      ok: false,
      errorOutput: 'Precisa aprovar'
    });

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'pull-rec-r1' });
    deps.modelService.pullModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'pull',
        model: 'llama3.2:3b',
        phase: 'progress',
        percent: 22,
        message: 'Download 22%',
        timestamp: new Date().toISOString()
      });

      return {
        ok: false,
        model: 'llama3.2:3b',
        message: '',
        output: '',
        errorOutput: 'erro final pull'
      };
    });
    await pullHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(deps.modelHistoryService.finish).toHaveBeenCalledWith('pull-rec-r1', 'error', 'erro final pull', null);

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'pull-rec-r2' });
    deps.modelService.pullModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'pull',
        model: 'llama3.2:3b',
        phase: 'error',
        percent: null,
        message: 'Erro no callback',
        timestamp: new Date().toISOString()
      });

      return {
        ok: false,
        model: 'llama3.2:3b',
        message: 'retorno com erro',
        output: '',
        errorOutput: 'erro'
      };
    });
    await pullHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    const finishErrorCallback = deps.modelHistoryService.finish.mock.calls.filter((call: any[]) => call[0] === 'pull-rec-r2');
    expect(finishErrorCallback).toHaveLength(1);
    expect(finishErrorCallback[0]).toEqual(['pull-rec-r2', 'error', 'Erro no callback', null]);

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'pull-rec-r3' });
    deps.modelService.pullModel.mockImplementationOnce(async () => {
      throw 'falha textual pull';
    });
    await pullHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(deps.logger.error).toHaveBeenCalledWith(
      'model.pull.unexpected_error',
      expect.objectContaining({
        reason: 'falha textual pull'
      })
    );
  });

  it('cobre ramos restantes de remove (prompt negado, erro de retorno e excecao textual)', async () => {
    const setup = await setupRegisterIpc();
    const deps = createDeps();
    setup.registerIpc(deps);

    const removeHandler = mustHandler(setup.handlers, IPC_CHANNELS.modelRemove);

    deps.permissionService.check.mockReturnValueOnce({
      scope: 'tools.system.exec',
      action: 'Remover modelo llama3.2:3b',
      mode: 'ask',
      allowed: false,
      requiresPrompt: true,
      message: 'Precisa aprovar'
    });
    const denied = await removeHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(denied).toMatchObject({
      ok: false,
      errorOutput: 'Precisa aprovar'
    });

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'rm-rec-r1' });
    deps.modelService.removeModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'remove',
        model: 'llama3.2:3b',
        phase: 'progress',
        percent: null,
        message: 'Removendo...',
        timestamp: new Date().toISOString()
      });

      return {
        ok: false,
        model: 'llama3.2:3b',
        message: '',
        output: '',
        errorOutput: 'erro final remove'
      };
    });
    await removeHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(deps.modelHistoryService.finish).toHaveBeenCalledWith('rm-rec-r1', 'error', 'erro final remove', null);

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'rm-rec-r2' });
    deps.modelService.removeModel.mockImplementationOnce(async (_model: string, onProgress: (event: any) => void) => {
      onProgress({
        operation: 'remove',
        model: 'llama3.2:3b',
        phase: 'error',
        percent: null,
        message: 'Erro no callback',
        timestamp: new Date().toISOString()
      });

      return {
        ok: false,
        model: 'llama3.2:3b',
        message: 'retorno com erro',
        output: '',
        errorOutput: 'erro'
      };
    });
    await removeHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    const finishErrorCallback = deps.modelHistoryService.finish.mock.calls.filter((call: any[]) => call[0] === 'rm-rec-r2');
    expect(finishErrorCallback).toHaveLength(1);
    expect(finishErrorCallback[0]).toEqual(['rm-rec-r2', 'error', 'Erro no callback', null]);

    deps.modelHistoryService.start.mockReturnValueOnce({ id: 'rm-rec-r3' });
    deps.modelService.removeModel.mockImplementationOnce(async () => {
      throw 'falha textual remove';
    });
    await removeHandler({ sender: { send: vi.fn() } }, 'llama3.2:3b', false);
    expect(deps.logger.error).toHaveBeenCalledWith(
      'model.remove.unexpected_error',
      expect.objectContaining({
        reason: 'falha textual remove'
      })
    );
  });
});

async function setupRegisterIpc(): Promise<{
  registerIpc: (deps: any) => void;
  handlers: Map<string, IpcHandler>;
  ipcMainHandle: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  const handlers = new Map<string, IpcHandler>();
  const ipcMainHandle = vi.fn((channel: string, handler: IpcHandler) => {
    handlers.set(channel, handler);
  });

  vi.doMock('electron', () => ({
    ipcMain: {
      handle: ipcMainHandle
    }
  }));

  const mod = await import('@main/ipc/registerIpc');

  return {
    registerIpc: mod.registerIpc,
    handlers,
    ipcMainHandle
  };
}

function createDeps() {
  return {
    brain: {
      respond: vi.fn().mockResolvedValue({
        id: 'chat-1',
        role: 'assistant',
        content: 'ok',
        timestamp: new Date().toISOString(),
        source: 'llm'
      })
    },
    healthService: {
      report: vi.fn().mockResolvedValue({
        ok: true,
        checkedAt: new Date().toISOString(),
        ollamaReachable: true,
        modelAvailable: true,
        memoryHealthy: true,
        loggingHealthy: true,
        details: []
      })
    },
    configStore: {
      get: vi.fn().mockReturnValue({
        model: 'llama3.2:3b',
        endpoint: 'http://127.0.0.1:11434',
        personality: 'Dexter'
      }),
      setModel: vi.fn().mockReturnValue({
        model: 'llama3.2:3b',
        endpoint: 'http://127.0.0.1:11434',
        personality: 'Dexter'
      })
    },
    memoryStore: {
      snapshot: vi.fn().mockReturnValue({
        shortTermTurns: 0,
        mediumTermSessions: 0,
        longTermFacts: 0
      })
    },
    modelService: {
      listCurated: vi.fn().mockResolvedValue([]),
      listInstalled: vi.fn().mockResolvedValue([]),
      pullModel: vi.fn().mockResolvedValue({
        ok: true,
        model: 'llama3.2:3b',
        message: 'ok',
        output: '',
        errorOutput: ''
      }),
      removeModel: vi.fn().mockResolvedValue({
        ok: true,
        model: 'llama3.2:3b',
        message: 'ok',
        output: '',
        errorOutput: ''
      })
    },
    modelHistoryService: {
      query: vi.fn().mockReturnValue({
        items: [],
        page: 1,
        pageSize: 8,
        total: 0,
        totalPages: 1
      }),
      block: vi.fn(),
      start: vi.fn().mockReturnValue({
        id: 'history-1'
      }),
      progress: vi.fn(),
      finish: vi.fn()
    },
    auditExportService: {
      exportModelHistory: vi.fn().mockReturnValue({
        fileName: 'history.json',
        mimeType: 'application/json',
        content: '[]'
      }),
      exportLogs: vi.fn().mockReturnValue({
        fileName: 'logs.json',
        mimeType: 'application/json',
        content: '[]'
      }),
      countLogs: vi.fn().mockReturnValue({
        scope: 'all',
        count: 0,
        estimatedBytesJson: 2,
        estimatedBytesCsv: 2
      }),
      exportUpdateAuditTrail: vi.fn().mockReturnValue({
        fileName: 'update-audit.json',
        mimeType: 'application/json',
        content: '{}'
      }),
      countUpdateAuditTrail: vi.fn().mockReturnValue({
        family: 'all',
        severity: 'all',
        codeOnly: false,
        count: 0,
        estimatedBytesJson: 2,
        estimatedBytesCsv: 2
      })
    },
    permissionService: {
      list: vi.fn().mockReturnValue([]),
      set: vi.fn().mockReturnValue([]),
      check: vi.fn().mockReturnValue({
        scope: 'tools.system.exec',
        action: 'acao',
        mode: 'allow',
        allowed: true,
        requiresPrompt: false,
        message: 'ok'
      })
    },
    runtimeService: {
      status: vi.fn().mockResolvedValue({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: true,
        installedModelCount: 1,
        suggestedInstallCommand: '',
        notes: []
      }),
      installRuntime: vi.fn().mockResolvedValue({
        ok: true,
        command: '',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        output: '',
        errorOutput: ''
      }),
      startRuntime: vi.fn().mockResolvedValue({
        endpoint: 'http://127.0.0.1:11434',
        binaryFound: true,
        binaryPath: '/usr/bin/ollama',
        ollamaReachable: true,
        installedModelCount: 1,
        suggestedInstallCommand: '',
        notes: []
      })
    },
    updateService: {
      getState: vi.fn().mockReturnValue({
        phase: 'idle',
        provider: 'none',
        checkedAt: null,
        lastError: null,
        lastErrorCode: null,
        available: null,
        stagedVersion: null,
        stagedArtifactPath: null
      }),
      getPolicy: vi.fn().mockReturnValue({
        channel: 'stable',
        autoCheck: true,
        updatedAt: new Date().toISOString()
      }),
      setPolicy: vi.fn().mockReturnValue({
        channel: 'stable',
        autoCheck: true,
        updatedAt: new Date().toISOString()
      }),
      checkForUpdates: vi.fn().mockResolvedValue({
        phase: 'up-to-date',
        provider: 'none',
        checkedAt: new Date().toISOString(),
        lastError: null,
        lastErrorCode: null,
        available: null,
        stagedVersion: null,
        stagedArtifactPath: null
      }),
      downloadUpdate: vi.fn().mockResolvedValue({
        phase: 'error',
        provider: 'none',
        checkedAt: new Date().toISOString(),
        lastError: 'Nenhum update disponivel para download.',
        lastErrorCode: 'no_update_available_for_download',
        available: null,
        stagedVersion: null,
        stagedArtifactPath: null
      }),
      restartToApplyUpdate: vi.fn().mockReturnValue({
        ok: false,
        message: 'Nenhum update staged para aplicar no reinicio.',
        state: {
          phase: 'error',
          provider: 'none',
          checkedAt: new Date().toISOString(),
          lastError: 'Nenhum update staged para aplicar no reinicio.',
          lastErrorCode: 'no_staged_update',
          available: null,
          stagedVersion: null,
          stagedArtifactPath: null
        }
      })
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    getWindow: vi.fn().mockReturnValue({
      minimize: vi.fn(),
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isVisible: vi.fn().mockReturnValue(true)
    })
  };
}

function mustHandler(handlers: Map<string, IpcHandler>, channel: string): IpcHandler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler ausente para canal ${channel}`);
  }

  return handler;
}
