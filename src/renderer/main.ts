import type {
  ChatReply,
  CuratedModel,
  ExportDateRange,
  ExportFormat,
  ExportPayload,
  HealthReport,
  InstalledModel,
  LogExportFilter,
  LogExportScope,
  ModelHistoryPage,
  ModelHistoryFilter,
  ModelHistoryQuery,
  ModelHistoryRecord,
  MemorySnapshot,
  ModelProgressEvent,
  PermissionMode,
  PermissionPolicy,
  PermissionScope,
  RuntimeStatus,
  UpdateAuditTrailFamily,
  UpdateAuditTrailSeverity,
  UpdatePolicy,
  UpdateState
} from '@shared/contracts';
import { buildExportDateRangeFromInputs } from '@renderer/utils/export-date-range';

const sessionId = crypto.randomUUID();
let runtimeOfflineNoticeShown = false;
let activeProgress: {
  operation: ModelProgressEvent['operation'];
  model: string;
  startedAtMs: number;
  lastPercent: number | null;
} | null = null;
let historyPage = 1;
const historyPageSize = 8;
let historyOperationFilter: ModelHistoryQuery['operation'] = 'all';
let historyStatusFilter: ModelHistoryQuery['status'] = 'all';
let currentHistoryPage: ModelHistoryPage | null = null;
let historyRefreshTimer: number | null = null;
let selectedHistoryId: string | null = null;
let currentUpdateState: UpdateState | null = null;
const EXPORT_LOG_SCOPE_STORAGE_KEY = 'dexter.export.logScope';
const EXPORT_UPDATE_AUDIT_FAMILY_STORAGE_KEY = 'dexter.export.updateAudit.family';
const EXPORT_UPDATE_AUDIT_SEVERITY_STORAGE_KEY = 'dexter.export.updateAudit.severity';
const EXPORT_UPDATE_AUDIT_WINDOW_STORAGE_KEY = 'dexter.export.updateAudit.window';
const EXPORT_UPDATE_AUDIT_CODE_ONLY_STORAGE_KEY = 'dexter.export.updateAudit.codeOnly';
let exportLogsPreviewRequestId = 0;
let exportUpdateAuditPreviewRequestId = 0;

const elements = {
  messages: required<HTMLDivElement>('messages'),
  promptInput: required<HTMLTextAreaElement>('promptInput'),
  sendBtn: required<HTMLButtonElement>('sendBtn'),
  statusChip: required<HTMLDivElement>('statusChip'),
  modelInput: required<HTMLInputElement>('modelInput'),
  applyModelBtn: required<HTMLButtonElement>('applyModelBtn'),
  healthBtn: required<HTMLButtonElement>('healthBtn'),
  minimizeBtn: required<HTMLButtonElement>('minimizeBtn'),
  trayBtn: required<HTMLButtonElement>('trayBtn'),
  healthSummary: required<HTMLParagraphElement>('healthSummary'),
  memoryStats: required<HTMLUListElement>('memoryStats'),
  runtimeSummary: required<HTMLParagraphElement>('runtimeSummary'),
  runtimeCommand: required<HTMLElement>('runtimeCommand'),
  startRuntimeBtn: required<HTMLButtonElement>('startRuntimeBtn'),
  installRuntimeBtn: required<HTMLButtonElement>('installRuntimeBtn'),
  curatedModelSelect: required<HTMLSelectElement>('curatedModelSelect'),
  pullModelBtn: required<HTMLButtonElement>('pullModelBtn'),
  removeModelBtn: required<HTMLButtonElement>('removeModelBtn'),
  installedModels: required<HTMLUListElement>('installedModels'),
  modelProgressTrack: required<HTMLDivElement>('modelProgressTrack'),
  modelProgressFill: required<HTMLDivElement>('modelProgressFill'),
  modelProgressText: required<HTMLParagraphElement>('modelProgressText'),
  modelProgressEta: required<HTMLParagraphElement>('modelProgressEta'),
  modelHistory: required<HTMLUListElement>('modelHistory'),
  historyOperationFilter: required<HTMLSelectElement>('historyOperationFilter'),
  historyStatusFilter: required<HTMLSelectElement>('historyStatusFilter'),
  historyPrevBtn: required<HTMLButtonElement>('historyPrevBtn'),
  historyNextBtn: required<HTMLButtonElement>('historyNextBtn'),
  historyPageInfo: required<HTMLParagraphElement>('historyPageInfo'),
  exportDateFrom: required<HTMLInputElement>('exportDateFrom'),
  exportDateTo: required<HTMLInputElement>('exportDateTo'),
  exportFormatSelect: required<HTMLSelectElement>('exportFormatSelect'),
  exportLogScopeSelect: required<HTMLSelectElement>('exportLogScopeSelect'),
  exportUpdateAuditFamilySelect: required<HTMLSelectElement>('exportUpdateAuditFamilySelect'),
  exportUpdateAuditSeveritySelect: required<HTMLSelectElement>('exportUpdateAuditSeveritySelect'),
  exportUpdateAuditWindowSelect: required<HTMLSelectElement>('exportUpdateAuditWindowSelect'),
  exportUpdateAuditCodeOnly: required<HTMLInputElement>('exportUpdateAuditCodeOnly'),
  exportPresetTodayBtn: required<HTMLButtonElement>('exportPresetTodayBtn'),
  exportPreset7dBtn: required<HTMLButtonElement>('exportPreset7dBtn'),
  exportPreset30dBtn: required<HTMLButtonElement>('exportPreset30dBtn'),
  exportPresetClearBtn: required<HTMLButtonElement>('exportPresetClearBtn'),
  exportHistoryBtn: required<HTMLButtonElement>('exportHistoryBtn'),
  exportLogsBtn: required<HTMLButtonElement>('exportLogsBtn'),
  exportUpdateLogsBtn: required<HTMLButtonElement>('exportUpdateLogsBtn'),
  exportUpdateAuditTrailBtn: required<HTMLButtonElement>('exportUpdateAuditTrailBtn'),
  exportUpdateAuditErrorsBtn: required<HTMLButtonElement>('exportUpdateAuditErrorsBtn'),
  exportLogsPreview: required<HTMLParagraphElement>('exportLogsPreview'),
  exportUpdateAuditPreview: required<HTMLParagraphElement>('exportUpdateAuditPreview'),
  historyDetailTitle: required<HTMLParagraphElement>('historyDetailTitle'),
  historyDetailMessage: required<HTMLParagraphElement>('historyDetailMessage'),
  historyDetailMeta: required<HTMLElement>('historyDetailMeta'),
  permRuntimeInstall: required<HTMLSelectElement>('permRuntimeInstall'),
  permFsRead: required<HTMLSelectElement>('permFsRead'),
  permFsWrite: required<HTMLSelectElement>('permFsWrite'),
  permSystemExec: required<HTMLSelectElement>('permSystemExec'),
  updateSummary: required<HTMLParagraphElement>('updateSummary'),
  updateChannelSelect: required<HTMLSelectElement>('updateChannelSelect'),
  updateAutoCheckInput: required<HTMLInputElement>('updateAutoCheckInput'),
  updateCheckBtn: required<HTMLButtonElement>('updateCheckBtn'),
  updateDownloadBtn: required<HTMLButtonElement>('updateDownloadBtn'),
  updateRestartBtn: required<HTMLButtonElement>('updateRestartBtn'),
  updateAvailableVersion: required<HTMLElement>('updateAvailableVersion'),
  updateCompatibility: required<HTMLParagraphElement>('updateCompatibility'),
  updateNotes: required<HTMLParagraphElement>('updateNotes')
};

void bootstrap();

elements.sendBtn.addEventListener('click', () => {
  void sendPrompt();
});

elements.promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void sendPrompt();
  }
});

elements.applyModelBtn.addEventListener('click', () => {
  void applyModel();
});

elements.healthBtn.addEventListener('click', () => {
  void refreshHealth(true);
});

elements.minimizeBtn.addEventListener('click', () => {
  void window.dexter.minimize();
});

elements.trayBtn.addEventListener('click', () => {
  void window.dexter.toggleVisibility();
});

elements.installRuntimeBtn.addEventListener('click', () => {
  void installRuntime();
});

elements.startRuntimeBtn.addEventListener('click', () => {
  void startRuntime();
});

elements.pullModelBtn.addEventListener('click', () => {
  void pullSelectedModel();
});

elements.removeModelBtn.addEventListener('click', () => {
  void removeSelectedModel();
});

for (const select of permissionSelects()) {
  select.addEventListener('change', () => {
    void applyPermission(select);
  });
}

elements.updateChannelSelect.addEventListener('change', () => {
  void applyUpdatePolicy();
});

elements.updateAutoCheckInput.addEventListener('change', () => {
  void applyUpdatePolicy();
});

elements.updateCheckBtn.addEventListener('click', () => {
  void checkForUpdatesAction();
});

elements.updateDownloadBtn.addEventListener('click', () => {
  void downloadUpdateAction();
});

elements.updateRestartBtn.addEventListener('click', () => {
  void restartToApplyUpdateAction();
});

elements.historyOperationFilter.addEventListener('change', () => {
  historyOperationFilter = parseHistoryOperation(elements.historyOperationFilter.value);
  historyPage = 1;
  void refreshModelHistory();
});

elements.historyStatusFilter.addEventListener('change', () => {
  historyStatusFilter = parseHistoryStatus(elements.historyStatusFilter.value);
  historyPage = 1;
  void refreshModelHistory();
});

elements.historyPrevBtn.addEventListener('click', () => {
  if (historyPage <= 1) {
    return;
  }

  historyPage -= 1;
  void refreshModelHistory();
});

elements.historyNextBtn.addEventListener('click', () => {
  if (currentHistoryPage && historyPage >= currentHistoryPage.totalPages) {
    return;
  }

  historyPage += 1;
  void refreshModelHistory();
});

elements.exportHistoryBtn.addEventListener('click', () => {
  void exportHistoryAudit();
});

elements.exportLogsBtn.addEventListener('click', () => {
  void exportLogsAudit();
});

elements.exportUpdateLogsBtn.addEventListener('click', () => {
  elements.exportLogScopeSelect.value = 'updates';
  persistExportLogScope('updates');
  void exportLogsAudit('updates');
});

elements.exportUpdateAuditTrailBtn.addEventListener('click', () => {
  void exportUpdateAuditTrail();
});

elements.exportUpdateAuditErrorsBtn.addEventListener('click', () => {
  elements.exportUpdateAuditFamilySelect.value = 'all';
  elements.exportUpdateAuditSeveritySelect.value = 'warn-error';
  elements.exportUpdateAuditCodeOnly.checked = true;
  elements.exportLogScopeSelect.value = 'updates';
  persistExportLogScope('updates');
  persistUpdateAuditTrailFilterControls();
  void exportUpdateAuditTrail();
});

elements.exportUpdateAuditFamilySelect.addEventListener('change', () => {
  persistUpdateAuditTrailFilterControls();
  void refreshAuditExportPreviews();
});

elements.exportUpdateAuditSeveritySelect.addEventListener('change', () => {
  persistUpdateAuditTrailFilterControls();
  void refreshAuditExportPreviews();
});

elements.exportUpdateAuditWindowSelect.addEventListener('change', () => {
  persistUpdateAuditTrailFilterControls();
  void refreshAuditExportPreviews();
});

elements.exportUpdateAuditCodeOnly.addEventListener('change', () => {
  persistUpdateAuditTrailFilterControls();
  void refreshAuditExportPreviews();
});

elements.exportLogScopeSelect.addEventListener('change', () => {
  persistExportLogScope(parseLogExportScope(elements.exportLogScopeSelect.value));
  void refreshExportLogsPreview();
});

elements.exportFormatSelect.addEventListener('change', () => {
  void refreshAuditExportPreviews();
});

elements.exportPresetTodayBtn.addEventListener('click', () => {
  applyExportPreset('today');
});

elements.exportPreset7dBtn.addEventListener('click', () => {
  applyExportPreset('7d');
});

elements.exportPreset30dBtn.addEventListener('click', () => {
  applyExportPreset('30d');
});

elements.exportPresetClearBtn.addEventListener('click', () => {
  applyExportPreset('clear');
});

elements.exportDateFrom.addEventListener('change', () => {
  setActiveExportPreset(null);
  void refreshAuditExportPreviews();
});

elements.exportDateTo.addEventListener('change', () => {
  setActiveExportPreset(null);
  void refreshAuditExportPreviews();
});

setActiveExportPreset(null);
hydrateExportLogScope();
hydrateUpdateAuditTrailFilterControls();

async function bootstrap(): Promise<void> {
  setStatus('Sincronizando...', 'idle');
  window.dexter.onModelProgress((event) => {
    renderModelProgress(event);
    scheduleModelHistoryRefresh();
  });
  resetModelProgressUi();
  renderModelHistory([]);
  renderHistoryDetail(null);

  const config = await window.dexter.getConfig();
  elements.modelInput.value = config.model;

  appendMessage(
    'assistant',
    'Oi, eu sou o Dexter. Estou pronto para conversar e te ajudar com foco e clareza. Digite /help para ver comandos rapidos.',
    'command'
  );

  await refreshHealth();
  await refreshMemory();
  await refreshRuntime();
  await refreshModels();
  await refreshPermissions();
  await refreshUpdates();
  await refreshModelHistory();
  await refreshAuditExportPreviews();
}

async function sendPrompt(): Promise<void> {
  const input = elements.promptInput.value.trim();
  if (!input) {
    return;
  }

  elements.promptInput.value = '';
  appendMessage('user', input, 'command');
  setComposerBusy(true);
  setStatus('Pensando...', 'busy');

  try {
    const reply = await window.dexter.chat({
      sessionId,
      input
    });

    appendMessage('assistant', reply.content, reply.source);
  } catch {
    appendMessage('assistant', 'Falha ao processar sua mensagem. Tente novamente em instantes.', 'fallback');
  } finally {
    setComposerBusy(false);
    await refreshHealth();
    await refreshMemory();
  }
}

async function applyModel(): Promise<void> {
  const desiredModel = elements.modelInput.value.trim();
  if (!desiredModel) {
    return;
  }

  setStatus('Atualizando modelo...', 'idle');
  const config = await window.dexter.setModel(desiredModel);
  elements.modelInput.value = config.model;

  appendMessage('assistant', `Modelo ativo atualizado para ${config.model}.`, 'command');
  await refreshHealth();
}

async function refreshHealth(notify = false): Promise<void> {
  try {
    const health = await window.dexter.health();
    renderHealth(health);

    if (health.ok) {
      setStatus('Pronto', 'ok');
      if (notify) {
        appendMessage('assistant', 'Health check concluido: sistema saudavel.', 'command');
      }
    } else {
      setStatus('Atencao', 'warn');
      if (notify) {
        appendMessage('assistant', 'Health check concluido com alertas. Veja o painel lateral.', 'command');
      }
    }
  } catch {
    setStatus('Sem diagnostico', 'warn');
    elements.healthSummary.textContent = 'Nao foi possivel consultar a saude do sistema.';
  }
}

async function refreshMemory(): Promise<void> {
  const memory = await window.dexter.memorySnapshot();
  renderMemory(memory);
}

async function refreshRuntime(): Promise<void> {
  const status = await window.dexter.runtimeStatus();
  renderRuntime(status);

  if (!status.ollamaReachable && !runtimeOfflineNoticeShown) {
    runtimeOfflineNoticeShown = true;
    appendMessage(
      'assistant',
      `Runtime local indisponivel. Para instalar: ${status.suggestedInstallCommand || 'consulte docs do seu sistema'}.`,
      'command'
    );
  }
}

async function installRuntime(): Promise<void> {
  const permission = await requestPermission('runtime.install', 'Instalar runtime local');
  if (!permission.allowed) {
    return;
  }

  setModelButtonsBusy(true);
  elements.installRuntimeBtn.textContent = 'Instalando...';
  setStatus('Instalando runtime...', 'busy');

  try {
    const result = await window.dexter.installRuntime(permission.approvedPrompt);
    const excerpt = summarizeInstallResult(result);

    appendMessage(
      'assistant',
      result.ok
        ? `Runtime instalado com sucesso. ${excerpt}`
        : `Falha na instalacao do runtime. ${excerpt}`,
      result.ok ? 'command' : 'fallback'
    );
  } finally {
    setModelButtonsBusy(false);
    await refreshRuntime();
    await refreshHealth();
  }
}

async function startRuntime(): Promise<void> {
  const permission = await requestPermission('tools.system.exec', 'Iniciar runtime local');
  if (!permission.allowed) {
    return;
  }

  setModelButtonsBusy(true);
  elements.startRuntimeBtn.textContent = 'Iniciando...';

  try {
    const status = await window.dexter.startRuntime(permission.approvedPrompt);
    renderRuntime(status);

    if (status.ollamaReachable) {
      appendMessage('assistant', 'Runtime iniciado com sucesso.', 'command');
    } else {
      appendMessage('assistant', 'Nao consegui iniciar o runtime automaticamente.', 'fallback');
    }
  } finally {
    setModelButtonsBusy(false);
    await refreshHealth();
  }
}

async function refreshModels(): Promise<void> {
  const [curated, installed] = await Promise.all([
    window.dexter.listCuratedModels(),
    window.dexter.listInstalledModels()
  ]);

  renderCuratedModels(curated);
  renderInstalledModels(installed);
}

async function pullSelectedModel(): Promise<void> {
  const selected = elements.curatedModelSelect.value || elements.modelInput.value.trim();
  if (!selected) {
    return;
  }

  const permission = await requestPermission('tools.system.exec', `Baixar modelo ${selected}`);
  if (!permission.allowed) {
    return;
  }

  setModelButtonsBusy(true);
  elements.pullModelBtn.textContent = 'Baixando...';
  setStatus('Baixando modelo...', 'busy');
  elements.modelProgressText.textContent = `Iniciando download de ${selected}...`;

  try {
    const result = await window.dexter.pullModel(selected, permission.approvedPrompt);
    if (result.ok) {
      elements.modelInput.value = selected;
      await window.dexter.setModel(selected);
      appendMessage('assistant', `Modelo ${selected} baixado e selecionado.`, 'command');
    } else {
      appendMessage('assistant', `Falha ao baixar ${selected}. ${result.errorOutput || ''}`.trim(), 'fallback');
    }
  } finally {
    setModelButtonsBusy(false);
    await refreshModels();
    await refreshModelHistory();
    await refreshRuntime();
    await refreshHealth();
  }
}

async function removeSelectedModel(): Promise<void> {
  const selected = elements.curatedModelSelect.value || elements.modelInput.value.trim();
  if (!selected) {
    return;
  }

  const permission = await requestPermission('tools.system.exec', `Remover modelo ${selected}`);
  if (!permission.allowed) {
    return;
  }

  setModelButtonsBusy(true);
  elements.removeModelBtn.textContent = 'Removendo...';

  try {
    const result = await window.dexter.removeModel(selected, permission.approvedPrompt);
    appendMessage(
      'assistant',
      result.ok ? `Modelo ${selected} removido.` : `Nao foi possivel remover ${selected}. ${result.errorOutput || ''}`.trim(),
      result.ok ? 'command' : 'fallback'
    );
  } finally {
    setModelButtonsBusy(false);
    await refreshModels();
    await refreshModelHistory();
    await refreshRuntime();
    await refreshHealth();
  }
}

async function refreshPermissions(): Promise<void> {
  const policies = await window.dexter.listPermissions();
  renderPermissionPolicies(policies);
}

async function refreshUpdates(): Promise<void> {
  try {
    const [state, policy] = await Promise.all([window.dexter.getUpdateState(), window.dexter.getUpdatePolicy()]);
    renderUpdatePolicy(policy);
    renderUpdateState(state);
  } catch {
    currentUpdateState = null;
    elements.updateSummary.dataset.phase = 'error';
    elements.updateSummary.dataset.errorKind = 'operation';
    elements.updateSummary.textContent = 'Nao foi possivel carregar estado de updates.';
    elements.updateAvailableVersion.textContent = '-';
    elements.updateCompatibility.textContent = '-';
    elements.updateNotes.textContent = 'Sem dados de update.';
    syncUpdateControls();
  }
}

async function applyPermission(select: HTMLSelectElement): Promise<void> {
  const scope = select.dataset.scope as PermissionScope | undefined;
  const mode = select.value as PermissionMode;

  if (!scope) {
    return;
  }

  const updated = await window.dexter.setPermission(scope, mode);
  renderPermissionPolicies(updated);
  appendMessage('assistant', `Permissao ${scope} atualizada para ${mode}.`, 'command');
}

async function applyUpdatePolicy(): Promise<void> {
  elements.updateChannelSelect.disabled = true;
  elements.updateAutoCheckInput.disabled = true;

  try {
    const policy = await window.dexter.setUpdatePolicy({
      channel: parseUpdateChannel(elements.updateChannelSelect.value),
      autoCheck: elements.updateAutoCheckInput.checked
    });
    renderUpdatePolicy(policy);
    appendMessage(
      'assistant',
      `Politica de update atualizada: canal ${policy.channel}, auto-check ${policy.autoCheck ? 'on' : 'off'}.`,
      'command'
    );
  } catch {
    appendMessage('assistant', 'Falha ao atualizar politica de updates.', 'fallback');
  } finally {
    syncUpdateControls();
  }
}

async function checkForUpdatesAction(): Promise<void> {
  elements.updateCheckBtn.textContent = 'Verificando...';
  syncUpdateControls(true);

  try {
    const state = await window.dexter.checkForUpdates();
    renderUpdateState(state);

    if (state.phase === 'available' && state.available) {
      appendMessage('assistant', `Update disponivel: ${state.available.version}.`, 'command');
      return;
    }

    if (state.phase === 'up-to-date') {
      appendMessage('assistant', 'Nenhum update disponivel no canal configurado.', 'command');
      return;
    }

    if (state.phase === 'error') {
      appendMessage('assistant', state.lastError || 'Falha ao verificar updates.', 'fallback');
      return;
    }
  } catch {
    appendMessage('assistant', 'Falha ao verificar updates.', 'fallback');
  } finally {
    elements.updateCheckBtn.textContent = 'Verificar Update';
    syncUpdateControls();
    void refreshAuditExportPreviews();
  }
}

async function downloadUpdateAction(): Promise<void> {
  elements.updateDownloadBtn.textContent = 'Baixando...';
  syncUpdateControls(true);

  try {
    const state = await window.dexter.downloadUpdate();
    renderUpdateState(state);

    if (state.phase === 'staged' && state.stagedVersion) {
      appendMessage(
        'assistant',
        `Update ${state.stagedVersion} pronto para aplicar no proximo reinicio do Dexter.`,
        'command'
      );
      return;
    }

    appendMessage('assistant', state.lastError || 'Falha ao baixar update.', 'fallback');
  } catch {
    appendMessage('assistant', 'Falha ao baixar update.', 'fallback');
  } finally {
    elements.updateDownloadBtn.textContent = 'Baixar Update';
    syncUpdateControls();
    void refreshAuditExportPreviews();
  }
}

async function restartToApplyUpdateAction(): Promise<void> {
  elements.updateRestartBtn.textContent = 'Reiniciando...';
  syncUpdateControls(true);

  try {
    const result = await window.dexter.restartToApplyUpdate();
    renderUpdateState(result.state);
    appendMessage('assistant', result.message, result.ok ? 'command' : 'fallback');
  } catch {
    appendMessage('assistant', 'Falha ao solicitar reinicio para aplicar update.', 'fallback');
  } finally {
    elements.updateRestartBtn.textContent = 'Aplicar no Reinicio';
    syncUpdateControls();
    void refreshAuditExportPreviews();
  }
}

function renderHealth(health: HealthReport): void {
  const label = health.ok ? 'Sistema saudavel.' : 'Sistema com alertas.';
  const detail = health.details.length > 0 ? ` ${health.details.join(' ')}` : '';
  elements.healthSummary.textContent = `${label}${detail}`;
}

function renderMemory(memory: MemorySnapshot): void {
  elements.memoryStats.innerHTML = '';
  const rows = [
    `Curto prazo: ${memory.shortTermTurns} turnos`,
    `Medio prazo: ${memory.mediumTermSessions} sessoes`,
    `Longo prazo: ${memory.longTermFacts} fatos`
  ];

  for (const row of rows) {
    const li = document.createElement('li');
    li.textContent = row;
    elements.memoryStats.appendChild(li);
  }
}

function renderRuntime(status: RuntimeStatus): void {
  const summary = status.ollamaReachable
    ? `Runtime online em ${status.endpoint}. Modelos instalados: ${status.installedModelCount}.`
    : `Runtime offline. Endpoint esperado: ${status.endpoint}.`;

  const notes = status.notes.length > 0 ? ` ${status.notes.join(' ')}` : '';
  elements.runtimeSummary.textContent = `${summary}${notes}`;
  elements.runtimeCommand.textContent = status.suggestedInstallCommand || '-';
}

function renderCuratedModels(models: CuratedModel[]): void {
  const currentValue = elements.curatedModelSelect.value;
  elements.curatedModelSelect.innerHTML = '';

  for (const model of models) {
    const option = document.createElement('option');
    const badge = model.installed ? '[instalado]' : '[novo]';
    const star = model.recommended ? ' *' : '';

    option.value = model.name;
    option.textContent = `${badge} ${model.label}${star}`;
    option.title = `${model.name} - ${model.description}`;

    elements.curatedModelSelect.appendChild(option);
  }

  if (currentValue && models.some((item) => item.name === currentValue)) {
    elements.curatedModelSelect.value = currentValue;
  }
}

function renderInstalledModels(models: InstalledModel[]): void {
  elements.installedModels.innerHTML = '';

  if (models.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Nenhum modelo instalado.';
    elements.installedModels.appendChild(li);
    return;
  }

  for (const model of models) {
    const li = document.createElement('li');
    li.textContent = `${model.name} (${formatBytes(model.sizeBytes)})`;
    elements.installedModels.appendChild(li);
  }
}

function renderPermissionPolicies(policies: PermissionPolicy[]): void {
  const map = new Map<PermissionScope, PermissionMode>();
  for (const policy of policies) {
    map.set(policy.scope, policy.mode);
  }

  for (const select of permissionSelects()) {
    const scope = select.dataset.scope as PermissionScope | undefined;
    if (!scope) {
      continue;
    }

    const mode = map.get(scope);
    if (mode) {
      select.value = mode;
    }
  }
}

function renderUpdatePolicy(policy: UpdatePolicy): void {
  elements.updateChannelSelect.value = policy.channel;
  elements.updateAutoCheckInput.checked = policy.autoCheck;
}

function renderUpdateState(state: UpdateState): void {
  currentUpdateState = state;

  elements.updateSummary.dataset.phase = state.phase;
  elements.updateSummary.dataset.errorKind = state.phase === 'error' ? classifyUpdateErrorKind(state.lastErrorCode) : 'none';
  elements.updateSummary.textContent = formatUpdateSummary(state);

  if (!state.available) {
    elements.updateAvailableVersion.textContent = state.stagedVersion ? `Staged: ${state.stagedVersion}` : '-';
    elements.updateCompatibility.textContent = state.stagedVersion
      ? 'Update staged localmente; aplicacao depende de reinicio do app.'
      : '-';
    elements.updateNotes.textContent =
      state.lastError ?? (state.stagedVersion ? 'Use "Aplicar no Reinicio" para solicitar relaunch controlado.' : 'Sem dados de update.');
    syncUpdateControls();
    return;
  }

  const manifest = state.available;
  elements.updateAvailableVersion.textContent = `${manifest.version} (${manifest.channel}, ${manifest.provider})`;
  const localBlocked = state.phase === 'error' && typeof state.lastError === 'string' && state.lastError.trim().length > 0;
  const compatibilityBase =
    `Estrategia ${manifest.compatibility.strategy}; reinicio ${manifest.compatibility.requiresRestart ? 'sim' : 'nao'}; ` +
    `IPC ${manifest.compatibility.ipcContractCompatible ? 'ok' : 'incompativel'}; ` +
    `Schema ${manifest.compatibility.userDataSchemaCompatible ? 'ok' : 'incompativel'}`;
  elements.updateCompatibility.textContent = localBlocked ? `${compatibilityBase}; bloqueio local: sim` : compatibilityBase;
  elements.updateNotes.textContent = [
    localBlocked
      ? `Bloqueio${state.lastErrorCode ? ` [${formatUpdateErrorCode(state.lastErrorCode)}]` : ''}: ${state.lastError}`
      : '',
    manifest.releaseNotes.trim() || 'Sem release notes.',
    ...manifest.compatibility.notes
  ]
    .filter(Boolean)
    .join(' ');

  syncUpdateControls();
}

function renderModelProgress(event: ModelProgressEvent): void {
  if (
    !activeProgress ||
    activeProgress.operation !== event.operation ||
    activeProgress.model !== event.model ||
    event.phase === 'start'
  ) {
    activeProgress = {
      operation: event.operation,
      model: event.model,
      startedAtMs: Date.now(),
      lastPercent: typeof event.percent === 'number' ? clampPercent(event.percent) : null
    };
  }

  if (typeof event.percent === 'number') {
    activeProgress.lastPercent = clampPercent(event.percent);
  }

  const tracker = activeProgress;
  if (!tracker) {
    return;
  }

  const percentValue =
    event.phase === 'done'
      ? 100
      : typeof event.percent === 'number'
        ? clampPercent(event.percent)
        : tracker.lastPercent;

  updateProgressClasses(event.phase, percentValue);
  elements.modelProgressFill.style.width = `${percentValue ?? 0}%`;

  const percentText = typeof percentValue === 'number' ? ` (${Math.round(percentValue)}%)` : '';
  const statusLabel = event.operation.toUpperCase();
  elements.modelProgressText.textContent = `${event.operation.toUpperCase()}: ${event.message}${percentText}`;

  if (event.phase === 'done') {
    elements.modelProgressEta.textContent = 'ETA: concluido';
    return;
  }

  if (event.phase === 'error') {
    elements.modelProgressEta.textContent = 'ETA: --';
    return;
  }

  if (typeof percentValue === 'number' && percentValue > 0 && percentValue < 100) {
    const elapsed = Date.now() - tracker.startedAtMs;
    const total = (elapsed / percentValue) * 100;
    const remaining = Math.max(0, total - elapsed);
    elements.modelProgressEta.textContent = `ETA: ${formatEta(remaining)} (${statusLabel}${percentText})`;
    return;
  }

  elements.modelProgressEta.textContent = `ETA: calculando... (${statusLabel}${percentText || ''})`;
}

function appendMessage(role: 'user' | 'assistant', content: string, source: ChatReply['source']): void {
  const article = document.createElement('article');
  article.className = `message ${role}`;

  const head = document.createElement('div');
  head.className = 'message-head';
  head.textContent = role === 'user' ? 'Voce' : `Dexter (${source})`;

  const body = document.createElement('p');
  body.className = 'message-body';
  body.textContent = content;

  const timestamp = document.createElement('span');
  timestamp.className = 'message-time';
  timestamp.textContent = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  article.append(head, body, timestamp);
  elements.messages.appendChild(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function setComposerBusy(busy: boolean): void {
  elements.sendBtn.disabled = busy;
  elements.promptInput.disabled = busy;
  elements.sendBtn.textContent = busy ? 'Enviando...' : 'Enviar';
}

function setModelButtonsBusy(busy: boolean): void {
  elements.pullModelBtn.disabled = busy;
  elements.removeModelBtn.disabled = busy;
  elements.installRuntimeBtn.disabled = busy;
  elements.startRuntimeBtn.disabled = busy;

  if (!busy) {
    elements.pullModelBtn.textContent = 'Baixar Modelo';
    elements.removeModelBtn.textContent = 'Remover Modelo';
    elements.installRuntimeBtn.textContent = 'Instalar Runtime';
    elements.startRuntimeBtn.textContent = 'Iniciar Runtime';
  }
}

function setExportLogButtonsBusy(busy: boolean): void {
  elements.exportLogsBtn.disabled = busy;
  elements.exportUpdateLogsBtn.disabled = busy;
  elements.exportUpdateAuditTrailBtn.disabled = busy;
  elements.exportUpdateAuditErrorsBtn.disabled = busy;
}

function syncUpdateControls(forceBusy = false): void {
  const phase = currentUpdateState?.phase ?? 'idle';
  const busy = forceBusy || phase === 'checking' || phase === 'downloading';
  const lockedByStaged = phase === 'staged';
  const blockedCompatibilityError =
    phase === 'error' &&
    (currentUpdateState?.lastErrorCode === 'ipc_incompatible' ||
      currentUpdateState?.lastErrorCode === 'remote_schema_incompatible' ||
      currentUpdateState?.lastErrorCode === 'schema_migration_unavailable');
  const canDownload = Boolean(currentUpdateState?.available) && phase !== 'staged' && !busy && !blockedCompatibilityError;
  const canRestart = Boolean(currentUpdateState?.stagedVersion) && phase === 'staged' && !busy;

  elements.updateCheckBtn.disabled = busy || lockedByStaged;
  elements.updateDownloadBtn.disabled = !canDownload;
  elements.updateRestartBtn.disabled = !canRestart;
  elements.updateChannelSelect.disabled = busy || lockedByStaged;
  elements.updateAutoCheckInput.disabled = busy || lockedByStaged;
}

function setStatus(label: string, tone: 'ok' | 'warn' | 'busy' | 'idle'): void {
  elements.statusChip.textContent = label;
  elements.statusChip.dataset.tone = tone;
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Elemento nao encontrado: ${id}`);
  }

  return element as T;
}

function permissionSelects(): HTMLSelectElement[] {
  return [elements.permRuntimeInstall, elements.permFsRead, elements.permFsWrite, elements.permSystemExec];
}

function parseUpdateChannel(value: string): UpdatePolicy['channel'] {
  return value === 'rc' ? 'rc' : 'stable';
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex >= 2 ? 1 : 0)} ${units[unitIndex]}`;
}

function summarizeInstallResult(result: {
  command: string;
  exitCode: number | null;
  output: string;
  errorOutput: string;
}): string {
  const out = (result.output || result.errorOutput || '').trim();
  const compact = out.length > 220 ? `${out.slice(0, 220)}...` : out;
  const command = result.command ? `Comando: ${result.command}.` : '';
  const exit = `Exit: ${result.exitCode ?? 'n/a'}.`;

  return `${command} ${exit} ${compact}`.trim();
}

function resetModelProgressUi(): void {
  activeProgress = null;
  elements.modelProgressTrack.classList.remove('indeterminate', 'success', 'error');
  elements.modelProgressFill.style.width = '0%';
  elements.modelProgressText.textContent = 'Sem operacao em andamento.';
  elements.modelProgressEta.textContent = 'ETA: --';
}

async function refreshModelHistory(): Promise<void> {
  const page = await window.dexter.listModelHistory({
    page: historyPage,
    pageSize: historyPageSize,
    operation: historyOperationFilter,
    status: historyStatusFilter
  });

  currentHistoryPage = page;
  historyPage = page.page;
  renderModelHistory(page.items);

  elements.historyPageInfo.textContent = `Pagina ${page.page}/${page.totalPages} (${page.total})`;
  elements.historyPrevBtn.disabled = page.page <= 1;
  elements.historyNextBtn.disabled = page.page >= page.totalPages;
}

async function exportHistoryAudit(): Promise<void> {
  const format = parseExportFormat(elements.exportFormatSelect.value);
  const range = buildExportDateRange();
  if (!range.ok) {
    appendMessage('assistant', range.message, 'fallback');
    return;
  }
  const filter: ModelHistoryFilter = {
    operation: historyOperationFilter,
    status: historyStatusFilter,
    ...range.value
  };

  elements.exportHistoryBtn.disabled = true;
  try {
    const payload = await window.dexter.exportModelHistory(format, filter);
    downloadExportPayload(payload);
    appendMessage('assistant', `Historico exportado: ${payload.fileName}${formatExportIntegritySuffix(payload)}.`, 'command');
  } catch {
    appendMessage('assistant', 'Falha ao exportar historico.', 'fallback');
  } finally {
    elements.exportHistoryBtn.disabled = false;
  }
}

async function exportLogsAudit(scopeOverride?: LogExportFilter['scope']): Promise<void> {
  const format = parseExportFormat(elements.exportFormatSelect.value);
  const range = buildExportDateRange();
  const scope = scopeOverride ?? parseLogExportScope(elements.exportLogScopeSelect.value);
  if (!range.ok) {
    appendMessage('assistant', range.message, 'fallback');
    return;
  }

  setExportLogButtonsBusy(true);
  try {
    const payload = await window.dexter.exportLogs(format, {
      ...range.value,
      scope
    });
    downloadExportPayload(payload);
    appendMessage(
      'assistant',
      scope === 'updates'
        ? `Logs de update exportados: ${payload.fileName}${formatExportIntegritySuffix(payload)}.`
        : `Logs exportados: ${payload.fileName}${formatExportIntegritySuffix(payload)}.`,
      'command'
    );
  } catch {
    appendMessage('assistant', scope === 'updates' ? 'Falha ao exportar logs de update.' : 'Falha ao exportar logs.', 'fallback');
  } finally {
    setExportLogButtonsBusy(false);
    void refreshAuditExportPreviews();
  }
}

async function exportUpdateAuditTrail(): Promise<void> {
  const format = parseExportFormat(elements.exportFormatSelect.value);
  const range = buildUpdateAuditTrailExportRange();
  const family = parseUpdateAuditTrailFamily(elements.exportUpdateAuditFamilySelect.value);
  const severity = parseUpdateAuditTrailSeverity(elements.exportUpdateAuditSeveritySelect.value);
  const codeOnly = elements.exportUpdateAuditCodeOnly.checked;
  if (!range.ok) {
    appendMessage('assistant', range.message, 'fallback');
    return;
  }

  setExportLogButtonsBusy(true);
  try {
    const payload = await window.dexter.exportUpdateAuditTrail(format, {
      ...range.value,
      family,
      severity,
      codeOnly
    });
    downloadExportPayload(payload);
    appendMessage(
      'assistant',
      `Auditoria de update exportada (${family}, ${severity}, codeOnly=${codeOnly ? 'on' : 'off'}): ${payload.fileName}${formatExportIntegritySuffix(payload)}.`,
      'command'
    );
  } catch {
    appendMessage('assistant', 'Falha ao exportar auditoria de update.', 'fallback');
  } finally {
    setExportLogButtonsBusy(false);
    void refreshAuditExportPreviews();
  }
}

async function refreshAuditExportPreviews(): Promise<void> {
  await Promise.all([refreshExportLogsPreview(), refreshUpdateAuditTrailPreview()]);
}

async function refreshExportLogsPreview(): Promise<void> {
  const requestId = ++exportLogsPreviewRequestId;
  const scope = parseLogExportScope(elements.exportLogScopeSelect.value);
  const format = parseExportFormat(elements.exportFormatSelect.value);
  const range = buildExportDateRange();

  if (!range.ok) {
    elements.exportLogsPreview.textContent = `Logs no escopo selecionado: filtro invalido (${range.message})`;
    return;
  }

  elements.exportLogsPreview.textContent = 'Logs no escopo selecionado: calculando...';

  try {
    const result = await window.dexter.countExportLogs({
      ...range.value,
      scope
    });

    if (requestId !== exportLogsPreviewRequestId) {
      return;
    }

    const scopeLabel = result.scope === 'updates' ? 'updates' : 'all';
    const plural = result.count === 1 ? 'evento' : 'eventos';
    const periodLabel = describeExportPeriodForPreview(elements.exportDateFrom.value, elements.exportDateTo.value);
    const selectedEstimate = format === 'csv' ? result.estimatedBytesCsv : result.estimatedBytesJson;
    const estimatesLabel = `estimativa: ${format} ${formatByteSize(selectedEstimate)} (json ${formatByteSize(result.estimatedBytesJson)} | csv ${formatByteSize(result.estimatedBytesCsv)})`;
    elements.exportLogsPreview.textContent =
      `Logs no escopo ${scopeLabel}: ${result.count} ${plural} | formato: ${format} | ${estimatesLabel} | periodo: ${periodLabel}`;
  } catch {
    if (requestId !== exportLogsPreviewRequestId) {
      return;
    }
    elements.exportLogsPreview.textContent = 'Logs no escopo selecionado: falha ao calcular.';
  }
}

async function refreshUpdateAuditTrailPreview(): Promise<void> {
  const requestId = ++exportUpdateAuditPreviewRequestId;
  const family = parseUpdateAuditTrailFamily(elements.exportUpdateAuditFamilySelect.value);
  const severity = parseUpdateAuditTrailSeverity(elements.exportUpdateAuditSeveritySelect.value);
  const codeOnly = elements.exportUpdateAuditCodeOnly.checked;
  const format = parseExportFormat(elements.exportFormatSelect.value);
  const range = buildUpdateAuditTrailExportRange();

  if (!range.ok) {
    elements.exportUpdateAuditPreview.textContent = `Auditoria Update: filtro invalido (${range.message})`;
    return;
  }

  elements.exportUpdateAuditPreview.textContent = 'Auditoria Update: calculando...';

  try {
    const result = await window.dexter.countUpdateAuditTrail({
      ...range.value,
      family,
      severity,
      codeOnly
    });

    if (requestId !== exportUpdateAuditPreviewRequestId) {
      return;
    }

    const plural = result.count === 1 ? 'evento' : 'eventos';
    const periodLabel = range.periodLabel;
    const selectedEstimate = format === 'csv' ? result.estimatedBytesCsv : result.estimatedBytesJson;
    const estimatesLabel = `estimativa: ${format} ${formatByteSize(selectedEstimate)} (json ${formatByteSize(result.estimatedBytesJson)} | csv ${formatByteSize(result.estimatedBytesCsv)})`;
    elements.exportUpdateAuditPreview.textContent =
      `Auditoria Update (${result.family}, ${result.severity}, codeOnly=${result.codeOnly ? 'on' : 'off'}): ${result.count} ${plural} | formato: ${format} | ${estimatesLabel} | periodo: ${periodLabel}`;
  } catch {
    if (requestId !== exportUpdateAuditPreviewRequestId) {
      return;
    }
    elements.exportUpdateAuditPreview.textContent = 'Auditoria Update: falha ao calcular.';
  }
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '--';
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatExportIntegritySuffix(payload: ExportPayload): string {
  const parts: string[] = [];

  if (typeof payload.sha256 === 'string' && payload.sha256) {
    parts.push(`sha256 ${payload.sha256.slice(0, 12)}...`);
  }

  if (typeof payload.contentBytes === 'number' && Number.isFinite(payload.contentBytes)) {
    parts.push(formatByteSize(payload.contentBytes));
  }

  if (parts.length === 0) {
    return '';
  }

  return ` (${parts.join(' | ')})`;
}

function describeExportPeriodForPreview(dateFromInput: string, dateToInput: string): string {
  const from = dateFromInput.trim();
  const to = dateToInput.trim();

  if (from && to) {
    return `${from}..${to}`;
  }

  if (from) {
    return `desde ${from}`;
  }

  if (to) {
    return `ate ${to}`;
  }

  return 'aberto';
}

function buildUpdateAuditTrailExportRange():
  | ({ ok: true; value: ExportDateRange; periodLabel: string })
  | ({ ok: false; message: string }) {
  const windowValue = parseUpdateAuditTrailRelativeWindow(elements.exportUpdateAuditWindowSelect.value);

  if (windowValue === 'custom') {
    const range = buildExportDateRange();
    if (!range.ok) {
      return range;
    }

    return {
      ok: true,
      value: range.value,
      periodLabel: describeExportPeriodForPreview(elements.exportDateFrom.value, elements.exportDateTo.value)
    };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const durationMs =
    windowValue === '24h'
      ? 24 * 60 * 60 * 1000
      : windowValue === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

  const from = new Date(nowMs - durationMs);
  const periodLabel = windowValue === '24h' ? 'ultimas 24h' : windowValue === '7d' ? 'ultimos 7d' : 'ultimos 30d';

  return {
    ok: true,
    value: {
      dateFrom: from.toISOString(),
      dateTo: now.toISOString()
    },
    periodLabel
  };
}

function parseUpdateAuditTrailFamily(value: string): UpdateAuditTrailFamily {
  if (
    value === 'check' ||
    value === 'download' ||
    value === 'apply' ||
    value === 'migration' ||
    value === 'rollback' ||
    value === 'other'
  ) {
    return value;
  }

  return 'all';
}

function parseUpdateAuditTrailSeverity(value: string): UpdateAuditTrailSeverity {
  return value === 'warn-error' ? 'warn-error' : 'all';
}

type UpdateAuditTrailRelativeWindow = 'custom' | '24h' | '7d' | '30d';

function parseUpdateAuditTrailRelativeWindow(value: string): UpdateAuditTrailRelativeWindow {
  if (value === '24h' || value === '7d' || value === '30d') {
    return value;
  }

  return 'custom';
}

function downloadExportPayload(payload: ExportPayload): void {
  const blob = new Blob([payload.content], { type: payload.mimeType || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = payload.fileName || 'dexter-export.txt';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function scheduleModelHistoryRefresh(): void {
  if (historyRefreshTimer !== null) {
    window.clearTimeout(historyRefreshTimer);
  }

  historyRefreshTimer = window.setTimeout(() => {
    historyRefreshTimer = null;
    void refreshModelHistory();
  }, 140);
}

function renderModelHistory(items: ModelHistoryRecord[]): void {
  elements.modelHistory.innerHTML = '';

  if (items.length === 0) {
    selectedHistoryId = null;
    renderHistoryDetail(null);
    const li = document.createElement('li');
    li.textContent = 'Sem operacoes no filtro atual.';
    elements.modelHistory.appendChild(li);
    return;
  }

  const firstItem = items[0];
  if (!firstItem) {
    selectedHistoryId = null;
    renderHistoryDetail(null);
    return;
  }

  if (!selectedHistoryId || !items.some((item) => item.id === selectedHistoryId)) {
    selectedHistoryId = firstItem.id;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = `history-item ${item.status}${item.id === selectedHistoryId ? ' active' : ''}`;
    li.setAttribute('role', 'button');
    li.tabIndex = 0;

    const status = historyStatusLabel(item.status);
    const percent = typeof item.percent === 'number' ? ` ${Math.round(item.percent)}%` : '';
    const started = formatClock(item.startedAt);
    const duration = item.durationMs !== null ? `, duracao ${formatEta(item.durationMs)}` : '';

    li.textContent = `${status} ${item.operation.toUpperCase()} ${item.model}${percent} (${started}${duration})`;
    li.title = item.message;
    li.addEventListener('click', () => {
      selectedHistoryId = item.id;
      renderModelHistory(items);
    });
    li.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      selectedHistoryId = item.id;
      renderModelHistory(items);
    });
    elements.modelHistory.appendChild(li);
  }

  const selected = items.find((item) => item.id === selectedHistoryId) ?? firstItem;
  renderHistoryDetail(selected);
}

function historyStatusLabel(status: ModelHistoryRecord['status']): string {
  if (status === 'running') {
    return 'EM ANDAMENTO';
  }

  if (status === 'done') {
    return 'CONCLUIDO';
  }

  if (status === 'blocked') {
    return 'BLOQUEADO';
  }

  return 'ERRO';
}

function formatClock(timestampIso: string): string {
  const date = new Date(timestampIso);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderHistoryDetail(item: ModelHistoryRecord | null): void {
  if (!item) {
    elements.historyDetailTitle.textContent = 'Detalhes da operacao';
    elements.historyDetailMessage.textContent = 'Selecione uma operacao para ver os detalhes.';
    elements.historyDetailMeta.textContent = '-';
    return;
  }

  const status = historyStatusLabel(item.status);
  const operation = item.operation.toUpperCase();
  const percent = typeof item.percent === 'number' ? ` ${Math.round(item.percent)}%` : '';
  elements.historyDetailTitle.textContent = `${status} ${operation} ${item.model}${percent}`;
  elements.historyDetailMessage.textContent = item.message || 'Sem mensagem.';

  const startedAt = formatDateTime(item.startedAt);
  const finishedAt = item.finishedAt ? formatDateTime(item.finishedAt) : 'em andamento';
  const duration = item.durationMs !== null ? formatEta(item.durationMs) : '--';
  elements.historyDetailMeta.textContent = `Inicio: ${startedAt} | Fim: ${finishedAt} | Duracao: ${duration}`;
}

function formatDateTime(timestampIso: string): string {
  const date = new Date(timestampIso);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function updateProgressClasses(phase: ModelProgressEvent['phase'], percent: number | null): void {
  elements.modelProgressTrack.classList.remove('indeterminate', 'success', 'error');

  if (phase === 'done') {
    elements.modelProgressTrack.classList.add('success');
    return;
  }

  if (phase === 'error') {
    elements.modelProgressTrack.classList.add('error');
    return;
  }

  if (percent === null || percent <= 0) {
    elements.modelProgressTrack.classList.add('indeterminate');
  }
}

function formatEta(ms: number): string {
  if (ms < 1000) {
    return '<1s';
  }

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m ${remSeconds}s`;
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function parseHistoryOperation(value: string): ModelHistoryQuery['operation'] {
  if (value === 'pull' || value === 'remove' || value === 'all') {
    return value;
  }

  return 'all';
}

function parseHistoryStatus(value: string): ModelHistoryQuery['status'] {
  if (value === 'running' || value === 'done' || value === 'error' || value === 'blocked' || value === 'all') {
    return value;
  }

  return 'all';
}

function parseExportFormat(value: string): ExportFormat {
  return value === 'csv' ? 'csv' : 'json';
}

function parseLogExportScope(value: string): LogExportScope {
  return value === 'updates' ? 'updates' : 'all';
}

function formatUpdateSummary(state: UpdateState): string {
  if (state.phase === 'checking') {
    return 'Verificando updates...';
  }

  if (state.phase === 'up-to-date') {
    return 'Dexter esta atualizado no canal configurado.';
  }

  if (state.phase === 'available') {
    return state.available ? `Update ${state.available.version} disponivel para download.` : 'Update disponivel.';
  }

  if (state.phase === 'downloading') {
    return 'Baixando update...';
  }

  if (state.phase === 'staged') {
    return state.stagedVersion
      ? `Update ${state.stagedVersion} staged. Solicite "Aplicar no Reinicio".`
      : 'Update staged para aplicar no reinicio.';
  }

  if (state.phase === 'error') {
    return state.lastError || 'Falha no fluxo de update.';
  }

  return 'Sem verificacao recente.';
}

function hydrateExportLogScope(): void {
  const persisted = readExportLogScope();
  elements.exportLogScopeSelect.value = persisted;
}

function hydrateUpdateAuditTrailFilterControls(): void {
  elements.exportUpdateAuditFamilySelect.value = readUpdateAuditTrailFamily();
  elements.exportUpdateAuditSeveritySelect.value = readUpdateAuditTrailSeverity();
  elements.exportUpdateAuditWindowSelect.value = readUpdateAuditTrailWindow();
  elements.exportUpdateAuditCodeOnly.checked = readUpdateAuditTrailCodeOnly();
}

function readExportLogScope(): LogExportScope {
  try {
    const value = window.localStorage.getItem(EXPORT_LOG_SCOPE_STORAGE_KEY);
    return value === 'updates' ? 'updates' : 'all';
  } catch {
    return 'all';
  }
}

function persistExportLogScope(scope: LogExportScope): void {
  try {
    window.localStorage.setItem(EXPORT_LOG_SCOPE_STORAGE_KEY, scope);
  } catch {
    // no-op when storage is unavailable
  }
}

function persistUpdateAuditTrailFilterControls(): void {
  try {
    window.localStorage.setItem(
      EXPORT_UPDATE_AUDIT_FAMILY_STORAGE_KEY,
      parseUpdateAuditTrailFamily(elements.exportUpdateAuditFamilySelect.value)
    );
    window.localStorage.setItem(
      EXPORT_UPDATE_AUDIT_SEVERITY_STORAGE_KEY,
      parseUpdateAuditTrailSeverity(elements.exportUpdateAuditSeveritySelect.value)
    );
    window.localStorage.setItem(
      EXPORT_UPDATE_AUDIT_WINDOW_STORAGE_KEY,
      parseUpdateAuditTrailRelativeWindow(elements.exportUpdateAuditWindowSelect.value)
    );
    window.localStorage.setItem(
      EXPORT_UPDATE_AUDIT_CODE_ONLY_STORAGE_KEY,
      elements.exportUpdateAuditCodeOnly.checked ? '1' : '0'
    );
  } catch {
    // no-op when storage is unavailable
  }
}

function readUpdateAuditTrailFamily(): UpdateAuditTrailFamily {
  try {
    return parseUpdateAuditTrailFamily(window.localStorage.getItem(EXPORT_UPDATE_AUDIT_FAMILY_STORAGE_KEY) ?? 'all');
  } catch {
    return 'all';
  }
}

function readUpdateAuditTrailSeverity(): UpdateAuditTrailSeverity {
  try {
    return parseUpdateAuditTrailSeverity(window.localStorage.getItem(EXPORT_UPDATE_AUDIT_SEVERITY_STORAGE_KEY) ?? 'all');
  } catch {
    return 'all';
  }
}

function readUpdateAuditTrailWindow(): UpdateAuditTrailRelativeWindow {
  try {
    return parseUpdateAuditTrailRelativeWindow(window.localStorage.getItem(EXPORT_UPDATE_AUDIT_WINDOW_STORAGE_KEY) ?? 'custom');
  } catch {
    return 'custom';
  }
}

function readUpdateAuditTrailCodeOnly(): boolean {
  try {
    return window.localStorage.getItem(EXPORT_UPDATE_AUDIT_CODE_ONLY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function formatUpdateErrorCode(code: NonNullable<UpdateState['lastErrorCode']>): string {
  if (code === 'schema_migration_unavailable') {
    return 'schema_migration_unavailable';
  }
  if (code === 'ipc_incompatible') {
    return 'ipc_incompatible';
  }
  if (code === 'remote_schema_incompatible') {
    return 'remote_schema_incompatible';
  }
  if (code === 'check_failed') {
    return 'check_failed';
  }
  if (code === 'download_failed') {
    return 'download_failed';
  }
  if (code === 'restart_failed') {
    return 'restart_failed';
  }
  if (code === 'restart_unavailable') {
    return 'restart_unavailable';
  }
  if (code === 'no_update_available_for_download') {
    return 'no_update_available_for_download';
  }

  return 'no_staged_update';
}

function classifyUpdateErrorKind(code: UpdateState['lastErrorCode']): 'none' | 'compatibility' | 'operation' {
  if (!code) {
    return 'none';
  }

  if (
    code === 'ipc_incompatible' ||
    code === 'remote_schema_incompatible' ||
    code === 'schema_migration_unavailable'
  ) {
    return 'compatibility';
  }

  return 'operation';
}

function buildExportDateRange(): { ok: true; value: ExportDateRange } | { ok: false; message: string } {
  return buildExportDateRangeFromInputs(elements.exportDateFrom.value, elements.exportDateTo.value);
}

function applyExportPreset(preset: 'today' | '7d' | '30d' | 'clear'): void {
  setActiveExportPreset(preset);

  if (preset === 'clear') {
    elements.exportDateFrom.value = '';
    elements.exportDateTo.value = '';
    void refreshAuditExportPreviews();
    return;
  }

  const now = new Date();
  const end = toDateInputValue(now);
  let start = end;

  if (preset === '7d') {
    start = toDateInputValue(addDays(now, -6));
  } else if (preset === '30d') {
    start = toDateInputValue(addDays(now, -29));
  }

  elements.exportDateFrom.value = start;
  elements.exportDateTo.value = end;
  void refreshAuditExportPreviews();
}

function setActiveExportPreset(preset: 'today' | '7d' | '30d' | 'clear' | null): void {
  const map = [
    { key: 'today' as const, button: elements.exportPresetTodayBtn },
    { key: '7d' as const, button: elements.exportPreset7dBtn },
    { key: '30d' as const, button: elements.exportPreset30dBtn },
    { key: 'clear' as const, button: elements.exportPresetClearBtn }
  ];

  for (const item of map) {
    const isActive = item.key === preset;
    item.button.dataset.active = isActive ? 'true' : 'false';
    item.button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function addDays(source: Date, days: number): Date {
  const next = new Date(source);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInputValue(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function requestPermission(
  scope: PermissionScope,
  action: string
): Promise<{ allowed: boolean; approvedPrompt: boolean }> {
  const check = await window.dexter.checkPermission(scope, action);

  if (check.allowed) {
    return {
      allowed: true,
      approvedPrompt: false
    };
  }

  if (!check.requiresPrompt) {
    appendMessage('assistant', check.message, 'fallback');
    return {
      allowed: false,
      approvedPrompt: false
    };
  }

  const approved = window.confirm(`${check.message}\\n\\nEscopo: ${scope}`);
  if (!approved) {
    appendMessage('assistant', `Acao cancelada: ${action}.`, 'command');
    return {
      allowed: false,
      approvedPrompt: false
    };
  }

  return {
    allowed: true,
    approvedPrompt: true
  };
}
