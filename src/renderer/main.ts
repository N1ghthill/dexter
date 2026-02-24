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
  UpdateArtifact,
  UpdateAuditTrailFamily,
  UpdateAuditTrailSeverity,
  UpdatePolicy,
  UpdateState
} from '@shared/contracts';
import { buildExportDateRangeFromInputs } from '@renderer/utils/export-date-range';
import { buildCommandCardBody } from '@renderer/ui/command-cards';
import { createLiveAnnouncer } from '@renderer/ui/live-announcer';
import {
  insertPromptShortcutIntoTextarea,
  resizeTextareaToContent,
  syncChatEmptyStateUi
} from '@renderer/ui/chat-ui';
import {
  appendMessageSessionSeparator,
  applyMessageGrouping,
  clearUnreadMessageSeparator,
  ensureMessageDaySeparator,
  ensureUnreadMessageSeparator,
  formatMessageDayKey,
  syncAssistantTypingIndicator
} from '@renderer/ui/message-timeline';

const sessionId = crypto.randomUUID();
type CommandSuggestion = {
  command: string;
  description: string;
  effectPreview: string;
  tone?: 'warn';
};
type RankedCommandSuggestion = CommandSuggestion & {
  contextualScore: number;
  contextualReason: string | null;
};
type ComposerContextAction = {
  label: string;
  detail: string;
  target: 'updateRestart' | 'updateDownload' | 'updateCheck' | 'runtimeStart' | 'health';
  tone?: 'warn';
};
type UiThemeMode = 'system' | 'dark' | 'light';
type UiResolvedTheme = 'dark' | 'light';
const COMMAND_SUGGESTIONS: ReadonlyArray<CommandSuggestion> = [
  {
    command: '/help',
    description: 'Lista comandos rapidos e orientacoes',
    effectPreview: 'Mostra comandos disponiveis e dicas de uso no chat.'
  },
  {
    command: '/health',
    description: 'Resumo de saude dos servicos locais',
    effectPreview: 'Renderiza um card de saude com status de runtime e componentes.'
  },
  {
    command: '/env',
    description: 'Ambiente atual e informacoes do runtime',
    effectPreview: 'Renderiza um card com distribuicao, shell e contexto do ambiente.'
  },
  {
    command: '/mem',
    description: 'Resumo da memoria local da sessao',
    effectPreview: 'Mostra estatisticas de memoria local em formato visual.'
  },
  {
    command: '/history',
    description: 'Historico recente de operacoes e modelos',
    effectPreview: 'Mostra historico recente em card, com fallback para texto bruto.'
  },
  {
    command: '/clear',
    description: 'Limpa a conversa local atual',
    effectPreview: 'Reseta a conversa exibida localmente e inicia uma nova sessao visual.',
    tone: 'warn'
  },
  {
    command: '/model',
    description: 'Mostra ou ajusta contexto do modelo ativo',
    effectPreview: 'Consulta ou altera o modelo ativo conforme o comando enviado.'
  },
  {
    command: '/remember',
    description: 'Registra memoria local explicitamente',
    effectPreview: 'Persiste memoria local para reaproveitar contexto depois.'
  }
];
const DEFAULT_COMPOSER_QUICK_COMMANDS = ['/help', '/health', '/env'] as const;
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
let currentHealthReport: HealthReport | null = null;
let currentRuntimeStatus: RuntimeStatus | null = null;
let currentMemorySnapshot: MemorySnapshot | null = null;
let localChatSessionCounter = 0;
const EXPORT_LOG_SCOPE_STORAGE_KEY = 'dexter.export.logScope';
const EXPORT_UPDATE_AUDIT_FAMILY_STORAGE_KEY = 'dexter.export.updateAudit.family';
const EXPORT_UPDATE_AUDIT_SEVERITY_STORAGE_KEY = 'dexter.export.updateAudit.severity';
const EXPORT_UPDATE_AUDIT_WINDOW_STORAGE_KEY = 'dexter.export.updateAudit.window';
const EXPORT_UPDATE_AUDIT_CODE_ONLY_STORAGE_KEY = 'dexter.export.updateAudit.codeOnly';
const UI_THEME_MODE_STORAGE_KEY = 'dexter.ui.themeMode';
let exportLogsPreviewRequestId = 0;
let exportUpdateAuditPreviewRequestId = 0;
const ASSISTANT_AVATAR_SRC = '../../assets/illustrations/mascot/hero-grin-ui-320.webp';
const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 52;
const CHAT_STICKY_CONTEXT_SCROLL_THRESHOLD_PX = 64;
const LIVE_REGION_CLEAR_MS = {
  composerFeedback: 1200,
  chatAction: 1200,
  panelAction: 1400
} as const;
const LIVE_REGION_DEDUPE_MS = {
  composerFeedback: 900,
  chatAction: 900,
  panelAction: 1000
} as const;
let activeCommandSuggestions: RankedCommandSuggestion[] = [];
let activeCommandSuggestionIndex = 0;
let currentThemeMode: UiThemeMode = 'system';
let composerContextActionFeedback:
  | { target: ComposerContextAction['target']; label: string; detail: string }
  | null = null;
let composerContextActionFeedbackTimer: number | null = null;
let chatPendingNewAssistantItems = 0;

const elements = {
  messagesShell: required<HTMLDivElement>('messagesShell'),
  messages: required<HTMLDivElement>('messages'),
  chatStickyContextBar: required<HTMLDivElement>('chatStickyContextBar'),
  chatStickyModelPill: required<HTMLElement>('chatStickyModelPill'),
  chatStickyRuntimePill: required<HTMLElement>('chatStickyRuntimePill'),
  chatStickyUpdatePill: required<HTMLElement>('chatStickyUpdatePill'),
  chatScrollToBottomBtn: required<HTMLButtonElement>('chatScrollToBottomBtn'),
  chatScrollToBottomCount: required<HTMLSpanElement>('chatScrollToBottomCount'),
  chatEmptyState: required<HTMLElement>('chatEmptyState'),
  chatActionLive: required<HTMLSpanElement>('chatActionLive'),
  chatHeroCard: required<HTMLElement>('chatHeroCard'),
  chatHeroModelPill: required<HTMLElement>('chatHeroModelPill'),
  chatHeroRuntimePill: required<HTMLElement>('chatHeroRuntimePill'),
  chatHeroUpdatePill: required<HTMLElement>('chatHeroUpdatePill'),
  composerShell: required<HTMLDivElement>('composerShell'),
  composerBusyIndicator: required<HTMLSpanElement>('composerBusyIndicator'),
  composerFeedbackLive: required<HTMLSpanElement>('composerFeedbackLive'),
  composerContextActionLive: required<HTMLSpanElement>('composerContextActionLive'),
  promptInput: required<HTMLTextAreaElement>('promptInput'),
  composerContextActionBtn: required<HTMLButtonElement>('composerContextActionBtn'),
  commandSuggest: required<HTMLDivElement>('commandSuggest'),
  commandSuggestList: required<HTMLDivElement>('commandSuggestList'),
  commandSuggestPreview: required<HTMLDivElement>('commandSuggestPreview'),
  sendBtn: required<HTMLButtonElement>('sendBtn'),
  attachBtn: required<HTMLButtonElement>('attachBtn'),
  insertHelpBtn: required<HTMLButtonElement>('insertHelpBtn'),
  insertHealthBtn: required<HTMLButtonElement>('insertHealthBtn'),
  insertEnvBtn: required<HTMLButtonElement>('insertEnvBtn'),
  themeModeSelect: required<HTMLSelectElement>('themeModeSelect'),
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
  updateNotes: required<HTMLParagraphElement>('updateNotes'),
  panelActionLive: required<HTMLSpanElement>('panelActionLive')
};

const liveAnnouncers = {
  composerFeedback: createLiveAnnouncer(elements.composerFeedbackLive, {
    clearAfterMs: LIVE_REGION_CLEAR_MS.composerFeedback,
    dedupeWindowMs: LIVE_REGION_DEDUPE_MS.composerFeedback
  }),
  chatAction: createLiveAnnouncer(elements.chatActionLive, {
    clearAfterMs: LIVE_REGION_CLEAR_MS.chatAction,
    dedupeWindowMs: LIVE_REGION_DEDUPE_MS.chatAction
  }),
  panelAction: createLiveAnnouncer(elements.panelActionLive, {
    clearAfterMs: LIVE_REGION_CLEAR_MS.panelAction,
    dedupeWindowMs: LIVE_REGION_DEDUPE_MS.panelAction
  })
};

initThemeModeUi();
void bootstrap();

elements.sendBtn.addEventListener('click', () => {
  void sendPrompt();
});

elements.promptInput.addEventListener('keydown', (event) => {
  if (handleCommandSuggestionKeydown(event)) {
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void sendPrompt();
  }
});

elements.promptInput.addEventListener('input', () => {
  resizeTextareaToContent(elements.promptInput);
  syncCommandSuggestions();
});

elements.messages.addEventListener('scroll', () => {
  syncChatScrollToBottomButton();
});

elements.chatScrollToBottomBtn.addEventListener('click', () => {
  scrollChatToBottom({ smooth: true, resetUnread: true, announce: true });
});

elements.commandSuggest.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

elements.commandSuggest.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>('.command-suggest-item[data-command]');
  const command = button?.dataset.command?.trim();
  if (!button || !command) {
    return;
  }

  applyCommandSuggestion(command);
});

document.addEventListener('keydown', (event) => {
  if (handleGlobalShortcuts(event)) {
    event.preventDefault();
  }
});

window.addEventListener('resize', () => {
  syncChatScrollToBottomButton();
});

elements.themeModeSelect.addEventListener('change', () => {
  applyThemeMode(parseUiThemeMode(elements.themeModeSelect.value), { persist: true, announce: true });
});

elements.attachBtn.addEventListener('click', () => {
  appendMessage('assistant', 'Anexos ainda nao estao disponiveis nesta versao da UI.', 'fallback');
});

for (const quickBtn of composerQuickCommandButtons()) {
  quickBtn.addEventListener('click', () => {
    const command = quickBtn.dataset.command?.trim() || quickBtn.textContent?.trim() || '';
    if (!command) {
      return;
    }
    insertPromptShortcutIntoComposer(command);
  });
}

elements.composerContextActionBtn.addEventListener('click', () => {
  activateComposerContextAction();
});

elements.chatEmptyState.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>('.chat-empty-chip[data-command]');
  const command = button?.dataset.command?.trim();
  if (!button || !command) {
    return;
  }

  void applyEmptyStateCommandSuggestion(command);
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
  setChatHeroPill(elements.chatHeroModelPill, 'modelo', '--', 'busy');
  setChatHeroPill(elements.chatHeroRuntimePill, 'runtime', 'verificando', 'busy');
  setChatHeroPill(elements.chatHeroUpdatePill, 'updates', 'sem leitura', 'idle');
  syncComposerQuickCommandChips();
  syncChatEmptyStateUi(elements.messages, elements.chatEmptyState, elements.chatHeroCard);
  resizeTextareaToContent(elements.promptInput);
  window.dexter.onModelProgress((event) => {
    renderModelProgress(event);
    scheduleModelHistoryRefresh();
  });
  resetModelProgressUi();
  renderModelHistory([]);
  renderHistoryDetail(null);

  const config = await window.dexter.getConfig();
  elements.modelInput.value = config.model;
  setChatHeroPill(elements.chatHeroModelPill, 'modelo', config.model, 'ok');

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
  try {
    await window.dexter.reportBootHealthy();
  } catch {
    // Handshake de boot saudavel e best-effort.
  }
}

async function sendPrompt(): Promise<void> {
  const input = elements.promptInput.value.trim();
  if (!input) {
    return;
  }

  elements.promptInput.value = '';
  resizeTextareaToContent(elements.promptInput);
  hideCommandSuggestions();
  appendMessage('user', input, 'command');
  setComposerBusy(true);
  setStatus('Pensando...', 'busy');

  try {
    const reply = await window.dexter.chat({
      sessionId,
      input
    });

    appendMessage('assistant', reply.content, reply.source);
    if (input === '/clear' && reply.source === 'command') {
      appendSessionResetMarker();
    }
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
    announcePanelActionLive(
      `Politica de update atualizada para canal ${policy.channel} com auto-check ${policy.autoCheck ? 'ligado' : 'desligado'}.`
    );
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
      announcePanelActionLive(`Update disponivel: versao ${state.available.version}.`);
      appendMessage('assistant', `Update disponivel: ${state.available.version}.`, 'command');
      return;
    }

    if (state.phase === 'up-to-date') {
      announcePanelActionLive('Verificacao de update concluida: nenhum update disponivel.');
      appendMessage('assistant', 'Nenhum update disponivel no canal configurado.', 'command');
      return;
    }

    if (state.phase === 'error') {
      announcePanelActionLive(`Falha ao verificar updates. ${state.lastError || ''}`.trim());
      appendMessage('assistant', state.lastError || 'Falha ao verificar updates.', 'fallback');
      return;
    }
  } catch {
    announcePanelActionLive('Falha ao verificar updates.');
    appendMessage('assistant', 'Falha ao verificar updates.', 'fallback');
  } finally {
    resetUpdateButtonLabels();
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
      const applyMode = describeUpdateApplyMode(state);
      announcePanelActionLive(
        applyMode === 'assistido-deb'
          ? `Update ${state.stagedVersion} baixado em formato deb. Instalador pronto para abrir.`
          : `Update ${state.stagedVersion} staged e pronto para aplicar no reinicio.`
      );
      appendMessage(
        'assistant',
        applyMode === 'assistido-deb'
          ? `Update ${state.stagedVersion} staged em .deb. Use o botao para abrir o instalador e concluir a instalacao.`
          : `Update ${state.stagedVersion} pronto para aplicar no proximo reinicio do Dexter.`,
        'command'
      );
      return;
    }

    announcePanelActionLive(`Falha ao baixar update. ${state.lastError || ''}`.trim());
    appendMessage('assistant', state.lastError || 'Falha ao baixar update.', 'fallback');
  } catch {
    announcePanelActionLive('Falha ao baixar update.');
    appendMessage('assistant', 'Falha ao baixar update.', 'fallback');
  } finally {
    resetUpdateButtonLabels();
    syncUpdateControls();
    void refreshAuditExportPreviews();
  }
}

async function restartToApplyUpdateAction(): Promise<void> {
  elements.updateRestartBtn.textContent = 'Aplicando...';
  syncUpdateControls(true);

  try {
    const result = await window.dexter.restartToApplyUpdate();
    renderUpdateState(result.state);
    announcePanelActionLive(result.message);
    appendMessage('assistant', result.message, result.ok ? 'command' : 'fallback');
  } catch {
    announcePanelActionLive('Falha ao solicitar reinicio para aplicar update.');
    appendMessage('assistant', 'Falha ao solicitar reinicio para aplicar update.', 'fallback');
  } finally {
    resetUpdateButtonLabels();
    syncUpdateControls();
    void refreshAuditExportPreviews();
  }
}

function renderHealth(health: HealthReport): void {
  currentHealthReport = health;
  const label = health.ok ? 'Sistema saudavel.' : 'Sistema com alertas.';
  const detail = health.details.length > 0 ? ` ${health.details.join(' ')}` : '';
  elements.healthSummary.textContent = `${label}${detail}`;
  syncCommandSuggestions();
}

function renderMemory(memory: MemorySnapshot): void {
  currentMemorySnapshot = memory;
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
  syncCommandSuggestions();
}

function renderRuntime(status: RuntimeStatus): void {
  currentRuntimeStatus = status;
  const summary = status.ollamaReachable
    ? `Runtime online em ${status.endpoint}. Modelos instalados: ${status.installedModelCount}.`
    : `Runtime offline. Endpoint esperado: ${status.endpoint}.`;

  const notes = status.notes.length > 0 ? ` ${status.notes.join(' ')}` : '';
  elements.runtimeSummary.textContent = `${summary}${notes}`;
  elements.runtimeCommand.textContent = status.suggestedInstallCommand || '-';
  setChatHeroPill(
    elements.chatHeroRuntimePill,
    'runtime',
    status.ollamaReachable ? `online (${status.installedModelCount} modelos)` : 'offline',
    status.ollamaReachable ? 'ok' : 'warn'
  );
  syncCommandSuggestions();
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
  syncCommandSuggestions();
  syncChatHeroUpdate(state);

  elements.updateSummary.dataset.phase = state.phase;
  elements.updateSummary.dataset.errorKind = state.phase === 'error' ? classifyUpdateErrorKind(state.lastErrorCode) : 'none';
  elements.updateSummary.textContent = formatUpdateSummary(state);

  if (!state.available) {
    elements.updateAvailableVersion.textContent = state.stagedVersion ? `Staged: ${state.stagedVersion}` : '-';
    elements.updateCompatibility.textContent = state.stagedVersion
      ? `Update staged localmente; aplicacao: ${formatUpdateApplyModeLabel(describeUpdateApplyMode(state))}.`
      : '-';
    elements.updateNotes.textContent =
      state.lastError ??
      (state.stagedVersion
        ? describeUpdateApplyMode(state) === 'assistido-deb'
          ? 'Use "Abrir Instalador (.deb)" para concluir a instalacao do update.'
          : 'Use "Aplicar no Reinicio" para solicitar relaunch controlado.'
        : 'Sem dados de update.');
    syncUpdateControls();
    return;
  }

  const manifest = state.available;
  const selectedArtifact = getSelectedUpdateArtifact(state);
  const artifactLabel = selectedArtifact ? `, ${formatUpdateArtifactLabel(selectedArtifact)}` : '';
  elements.updateAvailableVersion.textContent = `${manifest.version} (${manifest.channel}, ${manifest.provider}${artifactLabel})`;
  const localBlocked = state.phase === 'error' && typeof state.lastError === 'string' && state.lastError.trim().length > 0;
  const applyMode = describeUpdateApplyMode(state);
  const compatibilityBase =
    `Estrategia ${manifest.compatibility.strategy}; reinicio ${manifest.compatibility.requiresRestart ? 'sim' : 'nao'}; ` +
    `IPC ${manifest.compatibility.ipcContractCompatible ? 'ok' : 'incompativel'}; ` +
    `Schema ${manifest.compatibility.userDataSchemaCompatible ? 'ok' : 'incompativel'}; ` +
    `Aplicacao ${formatUpdateApplyModeLabel(applyMode)}`;
  elements.updateCompatibility.textContent = localBlocked ? `${compatibilityBase}; bloqueio local: sim` : compatibilityBase;
  elements.updateNotes.textContent = [
    localBlocked
      ? `Bloqueio${state.lastErrorCode ? ` [${formatUpdateErrorCode(state.lastErrorCode)}]` : ''}: ${state.lastError}`
      : '',
    selectedArtifact
      ? `Artefato selecionado: ${formatUpdateArtifactLabel(selectedArtifact)}.`
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
  const shouldStickToBottom = role === 'user' || isChatScrolledNearBottom(elements.messages);
  const now = new Date();
  const dayKey = formatMessageDayKey(now);
  ensureMessageDaySeparator(elements.messages, now);
  ensureChatSessionMarker(now);
  if (role === 'assistant' && !shouldStickToBottom && chatPendingNewAssistantItems === 0) {
    ensureUnreadMessageSeparator(elements.messages);
  }

  const article = document.createElement('article');
  article.className = `message ${role}`;
  article.dataset.role = role;
  article.dataset.source = source;
  article.dataset.dayKey = dayKey;
  article.dataset.ts = String(now.getTime());

  if (role === 'user' && content.trim().startsWith('/')) {
    article.classList.add('command');
  }

  const head = document.createElement('div');
  head.className = 'message-head';
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.className = 'message-avatar';
    avatar.src = ASSISTANT_AVATAR_SRC;
    avatar.alt = '';
    avatar.decoding = 'async';
    head.appendChild(avatar);
  } else {
    const badge = document.createElement('span');
    badge.className = 'message-avatar user';
    badge.textContent = 'VO';
    head.appendChild(badge);
  }

  const headLabel = document.createElement('span');
  headLabel.textContent = role === 'user' ? 'Voce' : `Dexter (${source})`;
  head.appendChild(headLabel);

  const body = buildMessageBody(role, content, source);

  const timestamp = document.createElement('span');
  timestamp.className = 'message-time';
  timestamp.textContent = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const foot = document.createElement('div');
  foot.className = 'message-foot';
  foot.appendChild(timestamp);

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const useBtn = document.createElement('button');
  useBtn.type = 'button';
  useBtn.className = 'message-action-btn';
  useBtn.textContent = role === 'user' ? 'Editar' : 'Usar';
  useBtn.setAttribute('aria-label', role === 'user' ? 'Usar mensagem no composer' : 'Usar resposta no composer');
  useBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    useMessageContentInComposer(content, useBtn);
  });
  actions.appendChild(useBtn);

  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'message-copy-btn';
    copyBtn.textContent = 'Copiar';
    copyBtn.setAttribute('aria-label', 'Copiar mensagem');
    copyBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyMessageContent(content, copyBtn);
    });
    actions.appendChild(copyBtn);
  }

  if (actions.childElementCount > 0) {
    foot.appendChild(actions);
  }

  applyMessageGrouping(elements.messages, article);
  article.append(head, body, foot);
  elements.messages.appendChild(article);
  syncChatEmptyStateUi(elements.messages, elements.chatEmptyState, elements.chatHeroCard);
  syncCommandSuggestions();

  if (shouldStickToBottom) {
    scrollChatToBottom({ smooth: false, resetUnread: role === 'assistant' });
    return;
  }

  if (role === 'assistant') {
    chatPendingNewAssistantItems += 1;
  }
  syncChatScrollToBottomButton();
}

function appendSessionResetMarker(): void {
  appendMessageSessionSeparator(elements.messages, buildSessionMarkerLabel('apos /clear'));
  syncCommandSuggestions();
  scrollChatToBottom({ smooth: false });
}

function isChatScrolledNearBottom(container: HTMLElement, thresholdPx = CHAT_SCROLL_BOTTOM_THRESHOLD_PX): boolean {
  const distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
  return distanceToBottom <= thresholdPx;
}

function syncChatScrollToBottomButton(): void {
  syncChatStickyContextBar();
  const hasOverflow = elements.messages.scrollHeight > elements.messages.clientHeight + 8;
  const nearBottom = isChatScrolledNearBottom(elements.messages);
  const shouldShow = hasOverflow && !nearBottom;

  elements.chatScrollToBottomBtn.hidden = !shouldShow;

  if (!shouldShow) {
    chatPendingNewAssistantItems = 0;
    clearUnreadMessageSeparator(elements.messages);
    elements.chatScrollToBottomBtn.dataset.hasUnread = 'false';
    elements.chatScrollToBottomCount.hidden = true;
    elements.chatScrollToBottomCount.textContent = '';
    return;
  }

  const hasUnread = chatPendingNewAssistantItems > 0;
  elements.chatScrollToBottomBtn.dataset.hasUnread = hasUnread ? 'true' : 'false';
  elements.chatScrollToBottomCount.hidden = !hasUnread;
  elements.chatScrollToBottomCount.textContent = hasUnread ? String(Math.min(chatPendingNewAssistantItems, 99)) : '';
}

function syncChatStickyContextBar(): void {
  const hasUserMessage = elements.messages.querySelector('.message.user') !== null;
  const showSticky = hasUserMessage && elements.messages.scrollTop >= CHAT_STICKY_CONTEXT_SCROLL_THRESHOLD_PX;
  elements.chatStickyContextBar.hidden = !showSticky;
  elements.chatStickyContextBar.setAttribute('aria-hidden', showSticky ? 'false' : 'true');
  elements.messagesShell.dataset.sticky = showSticky ? 'true' : 'false';
}

function scrollChatToBottom(options?: { smooth?: boolean; resetUnread?: boolean; announce?: boolean }): void {
  elements.messages.scrollTo({
    top: elements.messages.scrollHeight,
    behavior: options?.smooth ? 'smooth' : 'auto'
  });

  if (options?.resetUnread) {
    chatPendingNewAssistantItems = 0;
    clearUnreadMessageSeparator(elements.messages);
  }
  syncChatScrollToBottomButton();

  if (options?.announce) {
    announceChatActionLive('Chat rolado para o fim.');
  }
}

function ensureChatSessionMarker(now: Date): void {
  if (elements.messages.querySelector('.message-session-separator')) {
    return;
  }
  appendMessageSessionSeparator(elements.messages, buildSessionMarkerLabel('iniciada', now));
}

function buildSessionMarkerLabel(reason: 'iniciada' | 'apos /clear', date = new Date()): string {
  localChatSessionCounter += 1;
  const sessionLabel = `Sessao ${localChatSessionCounter}`;
  const timeLabel = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return reason === 'iniciada'
    ? `${sessionLabel} iniciada as ${timeLabel}`
    : `${sessionLabel} iniciada as ${timeLabel} (apos /clear)`;
}

async function copyMessageContent(content: string, button: HTMLButtonElement): Promise<void> {
  const fallbackLabel = button.textContent || 'Copiar';
  button.disabled = true;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
    } else {
      throw new Error('clipboard indisponivel');
    }
    button.textContent = 'Copiado';
    button.dataset.state = 'ok';
    announceChatActionLive('Mensagem copiada para a area de transferencia.');
  } catch {
    button.textContent = 'Falha';
    button.dataset.state = 'error';
    announceChatActionLive('Falha ao copiar mensagem.');
  }

  window.setTimeout(() => {
    button.disabled = false;
    button.textContent = fallbackLabel;
    delete button.dataset.state;
  }, 1200);
}

function useMessageContentInComposer(content: string, button: HTMLButtonElement): void {
  if (elements.promptInput.disabled) {
    return;
  }

  const fallbackLabel = button.textContent || 'Usar';
  const nextChunk = content.trim();
  if (!nextChunk) {
    return;
  }

  const current = elements.promptInput.value;
  const hasText = current.trim().length > 0;
  const separator = hasText ? (current.endsWith('\n') ? '\n' : '\n\n') : '';
  elements.promptInput.value = `${current}${separator}${nextChunk}`;
  resizeTextareaToContent(elements.promptInput);
  elements.promptInput.focus();
  const end = elements.promptInput.value.length;
  elements.promptInput.setSelectionRange(end, end);

  button.disabled = true;
  button.textContent = 'Inserido';
  button.dataset.state = 'ok';
  announceComposerFeedbackLive('Mensagem inserida no composer.');
  window.setTimeout(() => {
    button.disabled = false;
    button.textContent = fallbackLabel;
    delete button.dataset.state;
  }, 1000);
}

function buildMessageBody(role: 'user' | 'assistant', content: string, source: ChatReply['source']): HTMLElement {
  if (role === 'assistant' && source === 'command') {
    const commandCard = buildCommandCardBody(content);
    if (commandCard) {
      return commandCard;
    }
  }

  const body = document.createElement('p');
  body.className = 'message-body';
  body.textContent = content;
  return body;
}

function setComposerBusy(busy: boolean): void {
  const shouldStickToBottom = isChatScrolledNearBottom(elements.messages);
  elements.sendBtn.disabled = busy;
  elements.attachBtn.disabled = true;
  elements.insertHelpBtn.disabled = busy;
  elements.insertHealthBtn.disabled = busy;
  elements.insertEnvBtn.disabled = busy;
  elements.promptInput.disabled = busy;
  if (busy) {
    hideCommandSuggestions();
  } else {
    syncCommandSuggestions();
  }
  elements.sendBtn.textContent = busy ? 'Enviando...' : 'Enviar';
  elements.composerShell.dataset.busy = busy ? 'true' : 'false';
  elements.composerBusyIndicator.hidden = !busy;
  syncAssistantTypingIndicator(elements.messages, {
    visible: busy,
    avatarSrc: ASSISTANT_AVATAR_SRC,
    label: 'Dexter analisando...'
  });
  if (busy && shouldStickToBottom) {
    scrollChatToBottom({ smooth: false });
  }
  syncChatScrollToBottomButton();
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

  syncComposerContextActionChip();
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

  if (!forceBusy) {
    resetUpdateButtonLabels();
  }

  elements.updateCheckBtn.disabled = busy || lockedByStaged;
  elements.updateDownloadBtn.disabled = !canDownload;
  elements.updateRestartBtn.disabled = !canRestart;
  elements.updateChannelSelect.disabled = busy || lockedByStaged;
  elements.updateAutoCheckInput.disabled = busy || lockedByStaged;
  syncComposerContextActionChip();
}

function resetUpdateButtonLabels(): void {
  const state = currentUpdateState;
  const selectedArtifact = getSelectedUpdateArtifact(state);
  elements.updateCheckBtn.textContent = 'Verificar Update';
  elements.updateDownloadBtn.textContent = selectedArtifact?.packageType === 'deb' ? 'Baixar Update (.deb)' : 'Baixar Update';

  if (describeUpdateApplyMode(state) === 'assistido-deb') {
    elements.updateRestartBtn.textContent = 'Abrir Instalador (.deb)';
    return;
  }

  elements.updateRestartBtn.textContent = 'Aplicar no Reinicio';
}

function setStatus(label: string, tone: 'ok' | 'warn' | 'busy' | 'idle'): void {
  elements.statusChip.textContent = label;
  elements.statusChip.dataset.tone = tone;
}

function insertPromptShortcutIntoComposer(command: string): boolean {
  const inserted = insertPromptShortcutIntoTextarea(elements.promptInput, command);
  if (inserted) {
    syncCommandSuggestions();
  }
  return inserted;
}

async function applyEmptyStateCommandSuggestion(command: string): Promise<void> {
  if (!command || elements.promptInput.disabled) {
    return;
  }

  const shouldSendImmediately = elements.promptInput.value.trim().length === 0;
  const inserted = insertPromptShortcutIntoComposer(command);
  if (!inserted) {
    return;
  }

  if (shouldSendImmediately) {
    await sendPrompt();
  }
}

function handleGlobalShortcuts(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.shiftKey) {
    return false;
  }

  if (!(event.ctrlKey || event.metaKey)) {
    return false;
  }

  if (event.key.toLowerCase() === 'n') {
    void triggerNewSessionShortcut();
    return true;
  }

  if (event.key === ',' || event.code === 'Comma') {
    focusTopbarModelEditor();
    return true;
  }

  return false;
}

async function triggerNewSessionShortcut(): Promise<void> {
  if (elements.promptInput.disabled || elements.sendBtn.disabled) {
    return;
  }

  elements.promptInput.value = '/clear';
  resizeTextareaToContent(elements.promptInput);
  hideCommandSuggestions();
  await sendPrompt();
}

function focusTopbarModelEditor(): void {
  elements.modelInput.focus();
  elements.modelInput.select();
  elements.modelInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function handleCommandSuggestionKeydown(event: KeyboardEvent): boolean {
  if (activeCommandSuggestions.length === 0) {
    return false;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeCommandSuggestionIndex = (activeCommandSuggestionIndex + 1) % activeCommandSuggestions.length;
    renderCommandSuggestions();
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeCommandSuggestionIndex =
      (activeCommandSuggestionIndex - 1 + activeCommandSuggestions.length) % activeCommandSuggestions.length;
    renderCommandSuggestions();
    return true;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    commitActiveCommandSuggestion();
    return true;
  }

  if (event.key === 'Enter' && !event.shiftKey && shouldCompleteCommandSuggestionOnEnter()) {
    event.preventDefault();
    commitActiveCommandSuggestion();
    return true;
  }

  if (event.key === 'Escape') {
    hideCommandSuggestions();
    return false;
  }

  return false;
}

function syncCommandSuggestions(): void {
  syncComposerQuickCommandChips();
  syncComposerContextActionChip();
  if (elements.promptInput.disabled) {
    hideCommandSuggestions();
    return;
  }

  const query = readCommandSuggestionQuery(elements.promptInput.value);
  if (!query) {
    hideCommandSuggestions();
    return;
  }

  const filtered = rankCommandSuggestionsByContext(COMMAND_SUGGESTIONS.filter((item) => item.command.startsWith(query)));
  if (filtered.length === 0) {
    hideCommandSuggestions();
    return;
  }

  activeCommandSuggestions = filtered.slice();
  activeCommandSuggestionIndex = Math.min(activeCommandSuggestionIndex, activeCommandSuggestions.length - 1);
  renderCommandSuggestions();
}

function syncComposerQuickCommandChips(): void {
  const ranked = rankCommandSuggestionsByContext(COMMAND_SUGGESTIONS);
  const picked: RankedCommandSuggestion[] = [];
  const seen = new Set<string>();

  for (const suggestion of ranked) {
    if (picked.length >= 3) {
      break;
    }
    if (seen.has(suggestion.command)) {
      continue;
    }
    if (suggestion.contextualScore <= 0) {
      continue;
    }
    seen.add(suggestion.command);
    picked.push(suggestion);
  }

  for (const fallbackCommand of DEFAULT_COMPOSER_QUICK_COMMANDS) {
    if (picked.length >= 3) {
      break;
    }
    if (seen.has(fallbackCommand)) {
      continue;
    }
    const fallback = COMMAND_SUGGESTIONS.find((item) => item.command === fallbackCommand);
    if (!fallback) {
      continue;
    }
    const contextual = scoreCommandSuggestion(fallback);
    picked.push({
      ...fallback,
      contextualScore: contextual.score,
      contextualReason: contextual.reason
    });
    seen.add(fallbackCommand);
  }

  const buttons = composerQuickCommandButtons();
  buttons.forEach((button, index) => {
    const suggestion = picked[index];
    if (!suggestion) {
      button.hidden = true;
      button.dataset.command = '';
      button.textContent = '';
      button.removeAttribute('title');
      delete button.dataset.contextual;
      return;
    }

    button.hidden = false;
    button.dataset.command = suggestion.command;
    button.textContent = suggestion.command;
    button.setAttribute('aria-label', `Inserir comando ${suggestion.command}`);
    button.title = suggestion.contextualReason
      ? `${suggestion.description}. Contexto: ${suggestion.contextualReason}.`
      : suggestion.description;
    button.dataset.contextual = suggestion.contextualScore > 0 ? 'true' : 'false';
  });
}

function syncComposerContextActionChip(): void {
  const action = deriveComposerContextAction();
  const button = elements.composerContextActionBtn;
  if (!action) {
    clearComposerContextActionFeedback();
    button.hidden = true;
    button.textContent = '';
    button.title = '';
    button.dataset.action = '';
    delete button.dataset.tone;
    delete button.dataset.state;
    elements.composerContextActionLive.textContent = '';
    return;
  }

  if (composerContextActionFeedback && composerContextActionFeedback.target !== action.target) {
    clearComposerContextActionFeedback();
  }

  button.hidden = false;
  const feedback = composerContextActionFeedback?.target === action.target ? composerContextActionFeedback : null;
  button.textContent = feedback?.label ?? action.label;
  button.dataset.action = action.target;
  button.title = feedback?.detail ?? action.detail;
  button.setAttribute('aria-label', `${button.textContent}: ${button.title}`);
  if (action.tone) {
    button.dataset.tone = action.tone;
  } else {
    delete button.dataset.tone;
  }
  if (feedback) {
    button.dataset.state = 'ok';
  } else {
    delete button.dataset.state;
  }
}

function deriveComposerContextAction(): ComposerContextAction | null {
  if (currentUpdateState?.phase === 'staged' && !elements.updateRestartBtn.disabled) {
    return {
      label: describeUpdateApplyMode(currentUpdateState) === 'assistido-deb' ? 'Abrir Instalador' : 'Aplicar Update',
      detail:
        describeUpdateApplyMode(currentUpdateState) === 'assistido-deb'
          ? 'Update staged em .deb; foca a acao para abrir o instalador.'
          : 'Update staged; foca a acao de aplicar no reinicio.',
      target: 'updateRestart'
    };
  }

  if (currentUpdateState?.phase === 'available') {
    if (!elements.updateDownloadBtn.disabled) {
      return {
        label: 'Baixar Update',
        detail: 'Update disponivel; foca a acao de download no painel de updates.',
        target: 'updateDownload'
      };
    }
    if (!elements.updateCheckBtn.disabled) {
      return {
        label: 'Verificar Update',
        detail: 'Foca a verificacao de updates para atualizar o estado atual.',
        target: 'updateCheck'
      };
    }
  }

  if (currentRuntimeStatus && !currentRuntimeStatus.ollamaReachable && !elements.startRuntimeBtn.disabled) {
    return {
      label: 'Iniciar Runtime',
      detail: 'Runtime offline; foca a acao de iniciar runtime local.',
      target: 'runtimeStart',
      tone: 'warn'
    };
  }

  if (currentHealthReport && !currentHealthReport.ok) {
    return {
      label: 'Ver Saude',
      detail: 'Sistema com alertas; foca o health check para revisar o estado atual.',
      target: 'health',
      tone: 'warn'
    };
  }

  return null;
}

function activateComposerContextAction(): void {
  const action = deriveComposerContextAction();
  if (!action) {
    return;
  }

  const target = resolveComposerContextActionTarget(action.target);
  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  if (!target.hasAttribute('tabindex') && target.tabIndex < 0) {
    target.tabIndex = 0;
  }
  target.focus();
  showComposerContextActionFeedback(action);
}

function resolveComposerContextActionTarget(target: ComposerContextAction['target']): HTMLElement | null {
  switch (target) {
    case 'updateRestart':
      return elements.updateRestartBtn;
    case 'updateDownload':
      return elements.updateDownloadBtn;
    case 'updateCheck':
      return elements.updateCheckBtn;
    case 'runtimeStart':
      return elements.startRuntimeBtn;
    case 'health':
      return elements.healthBtn;
    default:
      return null;
  }
}

function showComposerContextActionFeedback(action: ComposerContextAction): void {
  composerContextActionFeedback = {
    target: action.target,
    label: mapComposerContextActionSuccessLabel(action),
    detail: `Foco aplicado: ${action.detail}`
  };

  if (composerContextActionFeedbackTimer !== null) {
    window.clearTimeout(composerContextActionFeedbackTimer);
  }

  elements.composerContextActionLive.textContent = `Foco movido para ${action.label}.`;
  syncComposerContextActionChip();
  composerContextActionFeedbackTimer = window.setTimeout(() => {
    composerContextActionFeedbackTimer = null;
    composerContextActionFeedback = null;
    elements.composerContextActionLive.textContent = '';
    syncComposerContextActionChip();
  }, 1200);
}

function clearComposerContextActionFeedback(): void {
  if (composerContextActionFeedbackTimer !== null) {
    window.clearTimeout(composerContextActionFeedbackTimer);
    composerContextActionFeedbackTimer = null;
  }
  composerContextActionFeedback = null;
  elements.composerContextActionLive.textContent = '';
}

function announceComposerFeedbackLive(message: string): void {
  liveAnnouncers.composerFeedback.announce(message);
}

function announceChatActionLive(message: string): void {
  liveAnnouncers.chatAction.announce(message);
}

function announcePanelActionLive(message: string): void {
  liveAnnouncers.panelAction.announce(message);
}

function mapComposerContextActionSuccessLabel(action: ComposerContextAction): string {
  switch (action.target) {
    case 'updateRestart':
      return 'Pronto para aplicar';
    case 'updateDownload':
      return 'Pronto para baixar';
    case 'updateCheck':
      return 'Pronto para verificar';
    case 'runtimeStart':
      return 'Pronto para iniciar';
    case 'health':
      return 'Pronto para revisar';
    default:
      return action.label;
  }
}

function renderCommandSuggestions(): void {
  elements.commandSuggestList.replaceChildren();

  if (activeCommandSuggestions.length === 0) {
    hideCommandSuggestions();
    return;
  }

  activeCommandSuggestions.forEach((suggestion, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-suggest-item';
    button.dataset.command = suggestion.command;
    button.dataset.active = index === activeCommandSuggestionIndex ? 'true' : 'false';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', index === activeCommandSuggestionIndex ? 'true' : 'false');

    const commandLine = document.createElement('span');
    commandLine.className = 'command-suggest-command';
    commandLine.textContent = suggestion.command;
    button.appendChild(commandLine);

    const descLine = document.createElement('span');
    descLine.className = 'command-suggest-desc';
    descLine.textContent = suggestion.description;
    button.appendChild(descLine);

    elements.commandSuggestList.appendChild(button);
  });

  renderCommandSuggestionPreview();
  elements.commandSuggest.hidden = false;
}

function hideCommandSuggestions(): void {
  activeCommandSuggestions = [];
  activeCommandSuggestionIndex = 0;
  elements.commandSuggest.hidden = true;
  elements.commandSuggestList.replaceChildren();
  elements.commandSuggestPreview.replaceChildren();
}

function composerQuickCommandButtons(): HTMLButtonElement[] {
  return [elements.insertHelpBtn, elements.insertHealthBtn, elements.insertEnvBtn];
}

function commitActiveCommandSuggestion(): void {
  if (activeCommandSuggestions.length === 0) {
    return;
  }

  const suggestion = activeCommandSuggestions[activeCommandSuggestionIndex];
  if (!suggestion) {
    return;
  }

  applyCommandSuggestion(suggestion.command);
}

function shouldCompleteCommandSuggestionOnEnter(): boolean {
  const query = readCommandSuggestionQuery(elements.promptInput.value);
  if (!query) {
    return false;
  }

  const suggestion = activeCommandSuggestions[activeCommandSuggestionIndex];
  if (!suggestion) {
    return false;
  }

  return suggestion.command !== query;
}

function applyCommandSuggestion(command: string): void {
  replaceCommandSuggestionQuery(command);
  hideCommandSuggestions();
  resizeTextareaToContent(elements.promptInput);
  elements.promptInput.focus();
  const end = elements.promptInput.value.length;
  elements.promptInput.setSelectionRange(end, end);
  announceComposerFeedbackLive(`Comando ${command} inserido no composer.`);
}

function renderCommandSuggestionPreview(): void {
  elements.commandSuggestPreview.replaceChildren();
  const suggestion = activeCommandSuggestions[activeCommandSuggestionIndex];
  if (!suggestion) {
    return;
  }

  const label = document.createElement('div');
  label.className = 'command-suggest-preview-label';
  label.textContent = `Preview ${suggestion.command}`;
  elements.commandSuggestPreview.appendChild(label);

  const effect = document.createElement('div');
  effect.className = 'command-suggest-preview-effect';
  effect.textContent = suggestion.effectPreview;
  if (suggestion.tone) {
    effect.dataset.tone = suggestion.tone;
  }
  elements.commandSuggestPreview.appendChild(effect);

  if (suggestion.contextualReason) {
    const contextLine = document.createElement('div');
    contextLine.className = 'command-suggest-preview-context';
    contextLine.textContent = `Sugerido agora: ${suggestion.contextualReason}`;
    elements.commandSuggestPreview.appendChild(contextLine);
  }

  const hint = document.createElement('div');
  hint.className = 'command-suggest-preview-hint';
  hint.textContent = 'Tab ou Enter completam • Enter envia quando o comando ja estiver completo';
  elements.commandSuggestPreview.appendChild(hint);
}

function scoreCommandSuggestion(suggestion: CommandSuggestion): { score: number; reason: string | null } {
  let score = 0;
  let reason: string | null = null;
  const userMessageCount = elements.messages.querySelectorAll('.message.user').length;

  if (userMessageCount === 0 && suggestion.command === '/help') {
    score += 45;
    reason = reason ?? 'inicio da conversa';
  }

  if (currentRuntimeStatus && !currentRuntimeStatus.ollamaReachable) {
    if (suggestion.command === '/health') {
      score += 90;
      reason = reason ?? 'runtime offline';
    } else if (suggestion.command === '/env') {
      score += 45;
      reason = reason ?? 'diagnostico de ambiente com runtime offline';
    } else if (suggestion.command === '/model') {
      score += 15;
      reason = reason ?? 'verificar modelo enquanto runtime esta offline';
    }
  }

  if (currentHealthReport && !currentHealthReport.ok) {
    if (suggestion.command === '/health') {
      score += 70;
      reason = reason ?? 'saude do sistema com alertas';
    } else if (suggestion.command === '/env') {
      score += 20;
      reason = reason ?? 'coletar contexto do ambiente';
    }
  }

  if (currentUpdateState && ['available', 'staged', 'error'].includes(currentUpdateState.phase)) {
    if (suggestion.command === '/health') {
      score += 12;
      reason = reason ?? 'update exige diagnostico rapido';
    } else if (suggestion.command === '/env') {
      score += 8;
      reason = reason ?? 'contexto util para troubleshooting de update';
    }
  }

  if (userMessageCount >= 8 && suggestion.command === '/mem') {
    score += 28;
    reason = reason ?? 'conversa mais longa';
  }

  if (userMessageCount >= 14 && suggestion.command === '/clear') {
    score += 34;
    reason = reason ?? 'conversa longa; reset local pode ajudar';
  }

  if (currentMemorySnapshot && currentMemorySnapshot.shortTermTurns >= 8 && suggestion.command === '/mem') {
    score += 12;
    reason = reason ?? 'memoria de curto prazo com varios turnos';
  }

  return { score, reason };
}

function rankCommandSuggestionsByContext(suggestions: ReadonlyArray<CommandSuggestion>): RankedCommandSuggestion[] {
  return suggestions
    .map((item, index) => {
      const contextual = scoreCommandSuggestion(item);
      return {
        ...item,
        contextualScore: contextual.score,
        contextualReason: contextual.reason,
        _originalIndex: index
      };
    })
    .sort((a, b) => {
      if (b.contextualScore !== a.contextualScore) {
        return b.contextualScore - a.contextualScore;
      }
      if (a.command.length !== b.command.length) {
        return a.command.length - b.command.length;
      }
      if (a._originalIndex !== b._originalIndex) {
        return a._originalIndex - b._originalIndex;
      }
      return a.command.localeCompare(b.command);
    })
    .map(({ _originalIndex: _discarded, ...item }) => item);
}

function readCommandSuggestionQuery(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function replaceCommandSuggestionQuery(command: string): void {
  const current = elements.promptInput.value;
  const trimmed = current.trim();
  if (trimmed.startsWith('/') && !/\s/.test(trimmed)) {
    const leadingWhitespace = current.match(/^\s*/)?.[0] ?? '';
    const trailingWhitespace = current.match(/\s*$/)?.[0] ?? '';
    elements.promptInput.value = `${leadingWhitespace}${command}${trailingWhitespace}`;
    return;
  }

  insertPromptShortcutIntoComposer(command);
}

function setChatHeroPill(
  element: HTMLElement,
  label: string,
  value: string,
  tone: 'ok' | 'warn' | 'busy' | 'idle'
): void {
  element.textContent = `${label}: ${value}`;
  if (tone === 'idle') {
    delete element.dataset.tone;
  } else {
    element.dataset.tone = tone;
  }

  const mirroredElement = getMirroredChatStickyPill(element);
  if (!mirroredElement) {
    return;
  }
  mirroredElement.textContent = element.textContent;
  if (tone === 'idle') {
    delete mirroredElement.dataset.tone;
    return;
  }
  mirroredElement.dataset.tone = tone;
}

function getMirroredChatStickyPill(element: HTMLElement): HTMLElement | null {
  if (element === elements.chatHeroModelPill) {
    return elements.chatStickyModelPill;
  }
  if (element === elements.chatHeroRuntimePill) {
    return elements.chatStickyRuntimePill;
  }
  if (element === elements.chatHeroUpdatePill) {
    return elements.chatStickyUpdatePill;
  }
  return null;
}

function syncChatHeroUpdate(state: UpdateState): void {
  const artifact = getSelectedUpdateArtifact(state);
  if (state.phase === 'checking' || state.phase === 'downloading') {
    setChatHeroPill(elements.chatHeroUpdatePill, 'updates', state.phase === 'checking' ? 'verificando' : 'baixando', 'busy');
    return;
  }

  if (state.phase === 'staged' && state.stagedVersion) {
    const mode = describeUpdateApplyMode(state) === 'assistido-deb' ? 'staged .deb' : 'staged';
    setChatHeroPill(elements.chatHeroUpdatePill, 'updates', `${mode} ${state.stagedVersion}`, 'ok');
    return;
  }

  if (state.phase === 'error') {
    const code = state.lastErrorCode ? formatUpdateErrorCode(state.lastErrorCode) : 'erro';
    setChatHeroPill(elements.chatHeroUpdatePill, 'updates', code, 'warn');
    return;
  }

  if (state.available) {
    const suffix = artifact ? ` (${artifact.packageType})` : '';
    setChatHeroPill(elements.chatHeroUpdatePill, 'updates', `${state.available.version}${suffix}`, 'ok');
    return;
  }

  setChatHeroPill(elements.chatHeroUpdatePill, 'updates', 'sem update', 'idle');
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
    announcePanelActionLive(`Historico exportado em ${format}: ${payload.fileName}.`);
    appendMessage('assistant', `Historico exportado: ${payload.fileName}${formatExportIntegritySuffix(payload)}.`, 'command');
  } catch {
    announcePanelActionLive('Falha ao exportar historico.');
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
    announcePanelActionLive(
      scope === 'updates'
        ? `Logs de update exportados em ${format}: ${payload.fileName}.`
        : `Logs exportados em ${format}: ${payload.fileName}.`
    );
    appendMessage(
      'assistant',
      scope === 'updates'
        ? `Logs de update exportados: ${payload.fileName}${formatExportIntegritySuffix(payload)}.`
        : `Logs exportados: ${payload.fileName}${formatExportIntegritySuffix(payload)}.`,
      'command'
    );
  } catch {
    announcePanelActionLive(scope === 'updates' ? 'Falha ao exportar logs de update.' : 'Falha ao exportar logs.');
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
    announcePanelActionLive(
      `Auditoria de update exportada (${family}, ${severity}, codeOnly=${codeOnly ? 'on' : 'off'}) em ${format}: ${payload.fileName}.`
    );
    appendMessage(
      'assistant',
      `Auditoria de update exportada (${family}, ${severity}, codeOnly=${codeOnly ? 'on' : 'off'}): ${payload.fileName}${formatExportIntegritySuffix(payload)}.`,
      'command'
    );
  } catch {
    announcePanelActionLive('Falha ao exportar auditoria de update.');
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
      ? describeUpdateApplyMode(state) === 'assistido-deb'
        ? `Update ${state.stagedVersion} staged (.deb). Abra o instalador para concluir a atualizacao.`
        : `Update ${state.stagedVersion} staged. Solicite "Aplicar no Reinicio".`
      : 'Update staged para aplicar no reinicio.';
  }

  if (state.phase === 'error') {
    return state.lastError || 'Falha no fluxo de update.';
  }

  return 'Sem verificacao recente.';
}

function getSelectedUpdateArtifact(state: UpdateState | null | undefined): UpdateArtifact | null {
  const available = state?.available;
  if (available?.selectedArtifact) {
    return available.selectedArtifact;
  }

  const stagedPath = state?.stagedArtifactPath?.trim();
  if (stagedPath) {
    const packageType = inferUpdatePackageType(stagedPath);
    if (packageType) {
      return {
        platform: 'linux',
        arch: 'x64',
        packageType,
        downloadUrl: '',
        checksumSha256: ''
      };
    }
  }

  const url = available?.downloadUrl?.trim();
  const packageType = url ? inferUpdatePackageType(url) : null;
  if (!packageType) {
    return null;
  }

  return {
    platform: 'linux',
    arch: 'x64',
    packageType,
    downloadUrl: available?.downloadUrl ?? '',
    checksumSha256: available?.checksumSha256 ?? ''
  };
}

function inferUpdatePackageType(value: string): UpdateArtifact['packageType'] | null {
  const lower = value.toLowerCase();
  if (lower.endsWith('.appimage')) {
    return 'appimage';
  }
  if (lower.endsWith('.deb')) {
    return 'deb';
  }
  return null;
}

function formatUpdateArtifactLabel(artifact: Pick<UpdateArtifact, 'packageType' | 'arch'>): string {
  const packageLabel = artifact.packageType === 'deb' ? 'deb' : 'AppImage';
  return `${packageLabel}/${artifact.arch}`;
}

function describeUpdateApplyMode(state: UpdateState | null | undefined): 'automatico-appimage' | 'assistido-deb' | 'relaunch' {
  const artifact = getSelectedUpdateArtifact(state);
  if (artifact?.packageType === 'deb') {
    return 'assistido-deb';
  }
  if (artifact?.packageType === 'appimage') {
    return 'automatico-appimage';
  }

  return 'relaunch';
}

function formatUpdateApplyModeLabel(mode: ReturnType<typeof describeUpdateApplyMode>): string {
  if (mode === 'assistido-deb') {
    return 'assistida (.deb)';
  }
  if (mode === 'automatico-appimage') {
    return 'automatica (AppImage)';
  }

  return 'relaunch';
}

function hydrateExportLogScope(): void {
  const persisted = readExportLogScope();
  elements.exportLogScopeSelect.value = persisted;
}

function initThemeModeUi(): void {
  applyThemeMode(readUiThemeMode(), { persist: false, announce: false });

  if (typeof window.matchMedia !== 'function') {
    return;
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = (): void => {
    if (currentThemeMode !== 'system') {
      return;
    }
    applyThemeMode('system', { persist: false, announce: false });
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange);
    return;
  }

  mediaQuery.addListener(handleChange);
}

function applyThemeMode(
  mode: UiThemeMode,
  options?: {
    persist?: boolean;
    announce?: boolean;
  }
): void {
  currentThemeMode = mode;
  elements.themeModeSelect.value = mode;

  const resolved = resolveUiTheme(mode);
  document.body.dataset.themeMode = mode;
  document.body.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  if (options?.persist) {
    persistUiThemeMode(mode);
  }

  if (options?.announce) {
    announcePanelActionLive(`Tema da interface alterado para ${mode === 'system' ? `sistema (${resolved})` : mode}.`);
  }
}

function resolveUiTheme(mode: UiThemeMode): UiResolvedTheme {
  if (mode === 'dark' || mode === 'light') {
    return mode;
  }

  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return 'dark';
}

function parseUiThemeMode(value: string): UiThemeMode {
  if (value === 'light') {
    return 'light';
  }
  if (value === 'system') {
    return 'system';
  }
  return 'dark';
}

function readUiThemeMode(): UiThemeMode {
  try {
    return parseUiThemeMode(window.localStorage.getItem(UI_THEME_MODE_STORAGE_KEY) ?? 'dark');
  } catch {
    return 'dark';
  }
}

function persistUiThemeMode(mode: UiThemeMode): void {
  try {
    window.localStorage.setItem(UI_THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // no-op when storage is unavailable
  }
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
