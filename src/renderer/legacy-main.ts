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
  MemoryClearScope,
  MemoryLiveSnapshot,
  MemorySnapshot,
  ModelHistoryFilter,
  ModelHistoryPage,
  ModelHistoryQuery,
  ModelHistoryRecord,
  ModelOperationResult,
  ModelProgressEvent,
  PermissionMode,
  PermissionPolicy,
  PermissionScope,
  RuntimeInstallProgressEvent,
  RuntimeInstallResult,
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
import {
  ACTIVE_VIEW_META,
  type ActiveView
} from '@renderer/state/active-view';
import type { ModuleManagerAction } from '@renderer/components/modules/ModuleManager';
import { setActiveView, subscribeActiveView, type ActiveViewChangeOptions } from '@renderer/state/active-view-store';
import { subscribeUiIntent, type LegacyUiCommand, type UiIntent } from '@renderer/state/ui-intents';

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
type RepairSetupOrigin = 'onboarding' | 'health-card' | 'unknown';
type SetupChecklistItemState = 'done' | 'active' | 'pending' | 'blocked';
type SetupActionTarget =
  | 'installRuntime'
  | 'startRuntime'
  | 'repairRuntime'
  | 'repairSetup'
  | 'pullRecommendedModel'
  | 'selectInstalledModel'
  | 'runHealth'
  | 'insertHelp'
  | 'copyInstallCommand'
  | 'focusRuntimeInstallPermission'
  | 'focusSystemExecPermission';
type SetupAction = {
  label: string;
  target: SetupActionTarget;
  detail?: string;
  tone?: 'ok' | 'warn' | 'busy';
  disabled?: boolean;
};
type SetupChecklistItem = {
  title: string;
  detail: string;
  state: SetupChecklistItemState;
};
const COMMAND_SUGGESTIONS: ReadonlyArray<CommandSuggestion> = [
  {
    command: '/help',
    description: 'Lista comandos rapidos e orientacoes',
    effectPreview: 'Mostra comandos disponiveis e dicas de uso no chat.'
  },
  {
    command: '/whoami',
    description: 'Identidade operacional e contexto local',
    effectPreview: 'Exibe usuario detectado, foco atual e protocolo de seguranca ativo.'
  },
  {
    command: '/now',
    description: 'Referencia temporal e situacional em tempo real',
    effectPreview: 'Mostra hora/data/fuso e contexto do host no instante atual.'
  },
  {
    command: '/name',
    description: 'Define nome de chamada persistente',
    effectPreview: 'Atualiza como Dexter deve te chamar como padrao entre sessoes.'
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
    command: '/doctor',
    description: 'Diagnostico operacional completo',
    effectPreview: 'Consolida ambiente, runtime, privilegios e proximos passos em um unico relatorio.'
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
const DEFAULT_COMPOSER_QUICK_COMMANDS = ['/help', '/health', '/doctor'] as const;
let runtimeOfflineNoticeShown = false;
let activeProgress: {
  operation: ModelProgressEvent['operation'];
  model: string;
  startedAtMs: number;
  lastPercent: number | null;
} | null = null;
let activeRuntimeInstallProgress: {
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
let currentMemoryLiveSnapshot: MemoryLiveSnapshot | null = null;
let currentCuratedModels: CuratedModel[] = [];
let currentInstalledModels: InstalledModel[] = [];
let localChatSessionCounter = 0;
const EXPORT_LOG_SCOPE_STORAGE_KEY = 'dexter.export.logScope';
const RUNTIME_HELPER_DETAILS_OPEN_STORAGE_KEY = 'dexter.runtime.helperDetails.open';
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
let currentSetupPrimaryAction: SetupAction | null = null;
let currentSetupSecondaryAction: SetupAction | null = null;
let modelButtonsBusy = false;
let runtimeHelperDetailsPanelPreference: boolean | null = null;
let runtimeHelperDetailsPanelSyncing = false;
let memoryActionsBusy = false;

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
  setupBadge: required<HTMLSpanElement>('setupBadge'),
  setupSummary: required<HTMLParagraphElement>('setupSummary'),
  setupChecklist: required<HTMLUListElement>('setupChecklist'),
  setupPrivilegeNote: required<HTMLParagraphElement>('setupPrivilegeNote'),
  setupPrimaryActionBtn: required<HTMLButtonElement>('setupPrimaryActionBtn'),
  setupSecondaryActionBtn: required<HTMLButtonElement>('setupSecondaryActionBtn'),
  healthSummary: required<HTMLParagraphElement>('healthSummary'),
  healthRepairSetupBtn: required<HTMLButtonElement>('healthRepairSetupBtn'),
  memoryStats: required<HTMLUListElement>('memoryStats'),
  memoryLivePanel: required<HTMLDetailsElement>('memoryLivePanel'),
  memorySessionFacts: required<HTMLUListElement>('memorySessionFacts'),
  memoryPreferenceFacts: required<HTMLUListElement>('memoryPreferenceFacts'),
  memoryProfileFacts: required<HTMLUListElement>('memoryProfileFacts'),
  memoryNotes: required<HTMLUListElement>('memoryNotes'),
  memoryClearSessionBtn: required<HTMLButtonElement>('memoryClearSessionBtn'),
  memoryClearPreferencesBtn: required<HTMLButtonElement>('memoryClearPreferencesBtn'),
  memoryClearProfileBtn: required<HTMLButtonElement>('memoryClearProfileBtn'),
  memoryClearNotesBtn: required<HTMLButtonElement>('memoryClearNotesBtn'),
  runtimeSummary: required<HTMLParagraphElement>('runtimeSummary'),
  runtimeHelperSummary: required<HTMLParagraphElement>('runtimeHelperSummary'),
  runtimeHelperDetailsPanel: required<HTMLDetailsElement>('runtimeHelperDetailsPanel'),
  runtimeHelperDetails: required<HTMLParagraphElement>('runtimeHelperDetails'),
  runtimeCommand: required<HTMLElement>('runtimeCommand'),
  startRuntimeBtn: required<HTMLButtonElement>('startRuntimeBtn'),
  installRuntimeBtn: required<HTMLButtonElement>('installRuntimeBtn'),
  repairRuntimeBtn: required<HTMLButtonElement>('repairRuntimeBtn'),
  runtimeInstallProgressTrack: required<HTMLDivElement>('runtimeInstallProgressTrack'),
  runtimeInstallProgressFill: required<HTMLDivElement>('runtimeInstallProgressFill'),
  runtimeInstallProgressText: required<HTMLParagraphElement>('runtimeInstallProgressText'),
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
  exportUiAuditLogsBtn: required<HTMLButtonElement>('exportUiAuditLogsBtn'),
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

initActiveViewBridge();
initUiIntentBridge();
initThemeModeUi();
void bootstrap();

setActiveExportPreset(null);
hydrateExportLogScope();
hydrateRuntimeHelperDetailsPanelPreference();
hydrateUpdateAuditTrailFilterControls();

async function bootstrap(): Promise<void> {
  setStatus('Sincronizando...', 'idle');
  setChatHeroPill(elements.chatHeroModelPill, 'modelo', '--', 'busy');
  setChatHeroPill(elements.chatHeroRuntimePill, 'runtime', 'verificando', 'busy');
  setChatHeroPill(elements.chatHeroUpdatePill, 'updates', 'sem leitura', 'idle');
  syncComposerQuickCommandChips();
  syncChatEmptyStateUi(elements.messages, elements.chatEmptyState, elements.chatHeroCard);
  renderSetupOnboarding();
  resizeTextareaToContent(elements.promptInput);
  window.dexter.onModelProgress((event) => {
    renderModelProgress(event);
    scheduleModelHistoryRefresh();
  });
  window.dexter.onRuntimeInstallProgress((event) => {
    renderRuntimeInstallProgress(event);
  });
  resetRuntimeInstallProgressUi();
  resetModelProgressUi();
  renderModelHistory([]);
  renderHistoryDetail(null);

  const config = await window.dexter.getConfig();
  elements.modelInput.value = config.model;
  setChatHeroPill(elements.chatHeroModelPill, 'modelo', config.model, 'ok');
  renderSetupOnboarding();

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

  if (modelButtonsBusy) {
    appendMessage('assistant', 'Aguarde a operacao atual de runtime/modelo terminar antes de aplicar outro modelo.', 'fallback');
    return;
  }

  const runtime = currentRuntimeStatus;
  const runtimeLocalAndOnline = Boolean(runtime?.ollamaReachable) && isLocalRuntimeEndpoint(runtime?.endpoint ?? '');
  const desiredModelKey = desiredModel.toLowerCase();
  const installedLocally = currentInstalledModels.some((item) => item.name.toLowerCase() === desiredModelKey);

  if (runtimeLocalAndOnline && !installedLocally) {
    setStatus('Modelo nao instalado', 'warn');
    appendMessage(
      'assistant',
      `O modelo ${desiredModel} ainda nao esta instalado localmente. Use "Baixar Modelo" no painel antes de aplicar.`,
      'fallback'
    );
    return;
  }

  setStatus('Atualizando modelo...', 'idle');
  try {
    const config = await window.dexter.setModel(desiredModel);
    elements.modelInput.value = config.model;

    appendMessage('assistant', `Modelo ativo atualizado para ${config.model}.`, 'command');
    await refreshHealth();
  } catch {
    setStatus('Falha ao aplicar modelo', 'warn');
    appendMessage('assistant', 'Falha ao aplicar o modelo selecionado. Tente novamente.', 'fallback');
  }
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
    currentHealthReport = null;
    elements.healthSummary.textContent = 'Nao foi possivel consultar a saude do sistema.';
    syncHealthCardActions();
    renderSetupOnboarding();
  }
}

async function refreshMemory(): Promise<void> {
  const memoryLive = await window.dexter.memoryLiveSnapshot(sessionId);
  renderMemory(memoryLive.summary, memoryLive);
}

async function clearMemoryScope(scope: MemoryClearScope): Promise<void> {
  if (memoryActionsBusy) {
    return;
  }

  setMemoryActionsBusy(true);

  try {
    const result = await window.dexter.clearMemoryScope(scope, sessionId);
    announcePanelActionLive(result.message);
    appendMessage('assistant', result.message, result.ok ? 'command' : 'fallback');
    renderMemory(result.snapshot, await window.dexter.memoryLiveSnapshot(sessionId));
  } catch {
    const fallback = 'Falha ao limpar escopo de memoria.';
    announcePanelActionLive(fallback);
    appendMessage('assistant', fallback, 'fallback');
  } finally {
    setMemoryActionsBusy(false);
  }
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
  resetRuntimeInstallProgressUi();
  renderRuntimeInstallProgress({
    phase: 'start',
    percent: 0,
    message: 'Iniciando instalacao do runtime local.',
    timestamp: new Date().toISOString()
  });

  try {
    const result = await window.dexter.installRuntime(permission.approvedPrompt);

    if (result.ok) {
      const afterInstall = await ensureRuntimeOnlineAfterInstall();
      appendMessage('assistant', buildRuntimeInstallSuccessMessage(afterInstall), 'command');
      return;
    }

    const detail = summarizeInstallResult(result);
    appendMessage(
      'assistant',
      result.manualRequired
        ? `Instalacao automatica do runtime nao foi concluida neste ambiente.\n${detail}`
        : `Falha na instalacao do runtime.\n${detail}`,
      'fallback'
    );
  } finally {
    setModelButtonsBusy(false);
    await refreshRuntime();
    await refreshHealth();
  }
}

async function ensureRuntimeOnlineAfterInstall(): Promise<{
  attemptedAutoStart: boolean;
  runtimeOnline: boolean;
  requiresManualStart: boolean;
  blockedByPermission: boolean;
  reason: string | null;
}> {
  const afterInstallStatus = await window.dexter.runtimeStatus();
  renderRuntime(afterInstallStatus);

  if (afterInstallStatus.ollamaReachable) {
    return {
      attemptedAutoStart: false,
      runtimeOnline: true,
      requiresManualStart: false,
      blockedByPermission: false,
      reason: null
    };
  }

  if (!afterInstallStatus.binaryFound) {
    return {
      attemptedAutoStart: false,
      runtimeOnline: false,
      requiresManualStart: true,
      blockedByPermission: false,
      reason: 'binary-missing'
    };
  }

  if (!isLocalRuntimeEndpoint(afterInstallStatus.endpoint)) {
    return {
      attemptedAutoStart: false,
      runtimeOnline: false,
      requiresManualStart: true,
      blockedByPermission: false,
      reason: 'remote-endpoint'
    };
  }

  const permission = await requestPermission('tools.system.exec', 'Iniciar runtime local apos instalacao', {
    silentDenied: true,
    silentCancel: true
  });

  if (!permission.allowed) {
    return {
      attemptedAutoStart: false,
      runtimeOnline: false,
      requiresManualStart: true,
      blockedByPermission: true,
      reason: 'permission'
    };
  }

  const status = await window.dexter.startRuntime(permission.approvedPrompt);
  renderRuntime(status);

  return {
    attemptedAutoStart: true,
    runtimeOnline: status.ollamaReachable,
    requiresManualStart: !status.ollamaReachable,
    blockedByPermission: false,
    reason: status.ollamaReachable ? null : 'start-failed'
  };
}

function buildRuntimeInstallSuccessMessage(input: {
  attemptedAutoStart: boolean;
  runtimeOnline: boolean;
  requiresManualStart: boolean;
  blockedByPermission: boolean;
  reason: string | null;
}): string {
  if (input.runtimeOnline) {
    return input.attemptedAutoStart
      ? 'Runtime instalado e iniciado com sucesso. Ambiente pronto para baixar/aplicar modelos.'
      : 'Runtime instalado com sucesso. Runtime local ja estava online.';
  }

  if (input.blockedByPermission) {
    return [
      'Runtime instalado com sucesso.',
      'Falta concluir o inicio do runtime local (permissao tools.system.exec).',
      'Use "Iniciar Runtime" no painel para finalizar o setup.'
    ].join('\n');
  }

  if (input.reason === 'remote-endpoint') {
    return [
      'Runtime instalado com sucesso.',
      'O endpoint configurado e remoto; o inicio automatico local foi ignorado.',
      'Valide o host remoto e depois rode /health.'
    ].join('\n');
  }

  if (input.reason === 'binary-missing') {
    return [
      'Runtime instalado com sucesso, mas o binario nao foi detectado no PATH local.',
      'Atualize o terminal/sessao e use "Iniciar Runtime" para revalidar.'
    ].join('\n');
  }

  return [
    'Runtime instalado com sucesso.',
    'Nao consegui iniciar o runtime automaticamente.',
    'Use "Iniciar Runtime" no painel para concluir o setup.'
  ].join('\n');
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

async function repairRuntime(): Promise<void> {
  const permission = await requestPermission('tools.system.exec', 'Reparar runtime local');
  if (!permission.allowed) {
    return;
  }

  setModelButtonsBusy(true);
  elements.repairRuntimeBtn.textContent = 'Reparando...';
  setStatus('Reparando runtime...', 'busy');

  try {
    const status = await window.dexter.repairRuntime(permission.approvedPrompt);
    renderRuntime(status);

    if (status.ollamaReachable) {
      appendMessage('assistant', 'Runtime reparado/reiniciado com sucesso.', 'command');
    } else {
      appendMessage(
        'assistant',
        'Nao consegui reparar o runtime automaticamente. Verifique o painel Runtime Local e tente o fluxo manual.',
        'fallback'
      );
    }
  } finally {
    setModelButtonsBusy(false);
    await refreshRuntime();
    await refreshHealth();
  }
}

async function repairSetup(origin: RepairSetupOrigin = 'unknown'): Promise<void> {
  const beforeRuntime = currentRuntimeStatus;
  const shouldAttemptRuntimeRepair =
    Boolean(beforeRuntime?.binaryFound) &&
    !Boolean(beforeRuntime?.ollamaReachable) &&
    isLocalRuntimeEndpoint(beforeRuntime?.endpoint ?? '');

  let approvedPrompt = false;
  if (shouldAttemptRuntimeRepair) {
    const permission = await requestPermission('tools.system.exec', 'Reparar setup local');
    if (!permission.allowed) {
      void recordRepairSetupAuditEvent({
        origin,
        result: 'permission_not_granted',
        attemptedRuntimeRepair: shouldAttemptRuntimeRepair,
        beforeRuntime,
        afterRuntime: currentRuntimeStatus,
        afterHealth: currentHealthReport,
        nextStep: 'Conceda permissao tools.system.exec (allow/ask) e tente novamente.'
      });
      return;
    }
    approvedPrompt = permission.approvedPrompt;
  }

  setModelButtonsBusy(true);
  setStatus('Reparando setup...', 'busy');

  try {
    if (shouldAttemptRuntimeRepair) {
      const repairedStatus = await window.dexter.repairRuntime(approvedPrompt);
      renderRuntime(repairedStatus);
    }

    await refreshRuntime();
    await refreshHealth();

    const feedback = buildSetupRepairFeedback({
      beforeRuntime,
      afterRuntime: currentRuntimeStatus,
      afterHealth: currentHealthReport,
      attemptedRuntimeRepair: shouldAttemptRuntimeRepair
    });

    void recordRepairSetupAuditEvent({
      origin,
      result: feedback.outcomeCode,
      attemptedRuntimeRepair: shouldAttemptRuntimeRepair,
      beforeRuntime,
      afterRuntime: currentRuntimeStatus,
      afterHealth: currentHealthReport,
      nextStep: feedback.nextStep
    });
    appendMessage('assistant', feedback.message, feedback.tone);
  } catch {
    void recordRepairSetupAuditEvent({
      origin,
      result: 'unexpected_error',
      attemptedRuntimeRepair: shouldAttemptRuntimeRepair,
      beforeRuntime,
      afterRuntime: currentRuntimeStatus,
      afterHealth: currentHealthReport,
      nextStep: 'Revise o painel Runtime Local e rode /health para diagnostico.'
    });
    appendMessage(
      'assistant',
      'Falha ao executar o reparo guiado do setup. Verifique o painel Runtime Local e rode /health para diagnostico.',
      'fallback'
    );
  } finally {
    setModelButtonsBusy(false);
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
      appendMessage('assistant', buildModelOperationFailureMessage('pull', selected, result), 'fallback');
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
      result.ok ? `Modelo ${selected} removido.` : buildModelOperationFailureMessage('remove', selected, result),
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
  syncHealthCardActions();
  renderSetupOnboarding();
  syncCommandSuggestions();
}

function renderMemory(memory: MemorySnapshot, liveSnapshot?: MemoryLiveSnapshot): void {
  currentMemorySnapshot = memory;
  if (liveSnapshot) {
    currentMemoryLiveSnapshot = liveSnapshot;
  }

  const currentLive = liveSnapshot ?? currentMemoryLiveSnapshot;
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

  renderMemoryLiveDetails(currentLive);
  syncCommandSuggestions();
}

function renderMemoryLiveDetails(snapshot: MemoryLiveSnapshot | null): void {
  if (!snapshot) {
    renderSimpleMemoryList(elements.memorySessionFacts, ['Sem leitura da sessao atual.']);
    renderSimpleMemoryList(elements.memoryPreferenceFacts, ['Nenhuma preferencia persistente registrada.']);
    renderSimpleMemoryList(elements.memoryProfileFacts, ['Nenhum fato de perfil persistente registrado.']);
    renderSimpleMemoryList(elements.memoryNotes, ['Nenhuma nota persistente registrada.']);
    return;
  }

  renderSimpleMemoryList(elements.memorySessionFacts, [
    `Sessao: ${snapshot.session.sessionId}`,
    `Turnos ativos: ${snapshot.session.shortTermTurns}`,
    `Usuario inferido: ${snapshot.session.inferredUserName ?? 'nao inferido'}`,
    ...formatPromptPreviewRows(snapshot.session.recentUserPrompts)
  ]);

  renderKeyValueMemoryList(elements.memoryPreferenceFacts, snapshot.longTerm.preferences, 'Nenhuma preferencia persistente registrada.');
  renderKeyValueMemoryList(elements.memoryProfileFacts, snapshot.longTerm.profile, 'Nenhum fato de perfil persistente registrado.');
  renderSimpleMemoryList(
    elements.memoryNotes,
    snapshot.longTerm.notes.length > 0
      ? snapshot.longTerm.notes.slice(-8).map((note, index) => `Nota ${index + 1}: ${note}`)
      : ['Nenhuma nota persistente registrada.']
  );
}

function renderSimpleMemoryList(target: HTMLUListElement, rows: string[]): void {
  target.innerHTML = '';

  for (const row of rows) {
    const item = document.createElement('li');
    item.textContent = row;
    target.appendChild(item);
  }
}

function renderKeyValueMemoryList(
  target: HTMLUListElement,
  input: Record<string, string>,
  emptyMessage: string
): void {
  const entries = Object.entries(input).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    renderSimpleMemoryList(target, [emptyMessage]);
    return;
  }

  renderSimpleMemoryList(
    target,
    entries.map(([key, value]) => `${key}: ${value}`)
  );
}

function formatPromptPreviewRows(prompts: string[]): string[] {
  if (prompts.length === 0) {
    return ['Prompts recentes: nenhum.'];
  }

  return prompts.map((prompt, index) => `Prompt ${index + 1}: ${prompt}`);
}

function renderRuntime(status: RuntimeStatus): void {
  currentRuntimeStatus = status;
  const summary = status.ollamaReachable
    ? `Runtime online em ${status.endpoint}. Modelos instalados: ${status.installedModelCount}.`
    : `Runtime offline. Endpoint esperado: ${status.endpoint}.`;

  const notes = status.notes.filter((note) => !isRuntimeHelperStatusNote(note));
  const notesText = notes.length > 0 ? ` ${notes.join(' ')}` : '';
  elements.runtimeSummary.textContent = `${summary}${notesText}`;
  elements.runtimeHelperSummary.textContent = formatRuntimeHelperSummary(status);
  elements.runtimeHelperDetails.textContent = formatRuntimeHelperDetails(status);
  syncRuntimeHelperDetailsPanel(status);
  elements.runtimeCommand.textContent = status.suggestedInstallCommand || '-';
  syncRuntimeActionButtons(status);
  syncHealthCardActions();
  setChatHeroPill(
    elements.chatHeroRuntimePill,
    'runtime',
    status.ollamaReachable ? `online (${status.installedModelCount} modelos)` : 'offline',
    status.ollamaReachable ? 'ok' : 'warn'
  );
  renderSetupOnboarding();
  syncCommandSuggestions();
}

function isRuntimeHelperStatusNote(note: string): boolean {
  return (
    note.startsWith('Helper privilegiado Linux') ||
    note.startsWith('Helper Linux:') ||
    note.startsWith('Nao foi possivel ler capacidades do helper') ||
    note.startsWith('Resposta de status do helper')
  );
}

function formatRuntimeHelperSummary(status: RuntimeStatus): string {
  const helper = status.privilegedHelper;
  if (!helper) {
    return 'Sem diagnostico de helper.';
  }

  if (!helper.configured) {
    return 'Nao configurado para este ambiente/build.';
  }

  if (!helper.available) {
    return helper.statusProbeOk
      ? 'Configurado, mas indisponivel.'
      : `Configurado, mas arquivo ausente${helper.path ? ` (${helper.path})` : ''}.`;
  }

  if (!helper.agentOperationalReady) {
    return `Modo operacional bloqueado (${helper.agentOperationalReason}).`;
  }

  if (helper.agentOperationalLevel === 'assisted') {
    return `Modo assistido ativo (${helper.agentOperationalReason}).`;
  }

  if (!helper.statusProbeOk || !helper.capabilities) {
    const mode = helper.agentOperationalMode === 'sudo-noninteractive' ? 'sudo -n' : 'pkexec';
    return `Disponivel via ${mode}${helper.path ? ` (${helper.path})` : ''}, mas sem leitura de capacidades agora.`;
  }

  const serviceManager = helper.capabilities.systemctl ? 'systemctl' : helper.capabilities.service ? 'service' : 'nenhum';
  const mode = helper.agentOperationalMode === 'sudo-noninteractive' ? 'sudo -n' : 'pkexec';
  return `Disponivel via ${mode} (${serviceManager}; curl ${helper.capabilities.curl ? 'ok' : 'ausente'}).`;
}

function formatRuntimeHelperDetails(status: RuntimeStatus): string {
  const helper = status.privilegedHelper;
  if (!helper) {
    return 'Sem dados de helper para este ambiente.';
  }

  const lines: string[] = [];
  lines.push(`pkexec: ${helper.pkexecAvailable ? 'ok' : 'ausente'} • sudo: ${helper.sudoAvailable ? 'ok' : 'ausente'}`);
  lines.push(
    `sudo -n: ${helper.sudoNonInteractiveAvailable ? 'ok' : 'indisponivel'} • sudo/TTY: ${
      helper.sudoRequiresTty ? 'requerido' : 'nao'
    } • sudo policy: ${helper.sudoPolicyDenied ? 'bloqueada' : 'ok'}`
  );
  lines.push(`Prompt grafico: ${helper.desktopPrivilegePromptAvailable ? 'ok' : 'ausente'}`);
  lines.push(
    `Agente Linux: ${helper.agentOperationalMode} (${helper.agentOperationalLevel}) • ${
      helper.agentOperationalReady ? 'pronto' : 'bloqueado'
    }`
  );
  lines.push(`Motivo: ${helper.agentOperationalReason}`);

  if (!helper.configured) {
    if (helper.sudoAvailable && isLinuxInstallCommand(status.suggestedInstallCommand)) {
      lines.push(`Fallback: terminal com sudo (${toLinuxSudoInstallExample(status.suggestedInstallCommand)}).`);
    } else {
      lines.push('Fallback: use o terminal do host para instalar/iniciar manualmente e revalide com /health.');
    }
    return lines.join('\n');
  }

  if (!helper.available) {
    lines.push(helper.path ? `Helper configurado, mas arquivo ausente: ${helper.path}` : 'Helper configurado, mas ausente no host.');
    if (!helper.pkexecAvailable || !helper.desktopPrivilegePromptAvailable) {
      lines.push('Fallback: use terminal com sudo (ou fluxo manual equivalente da distro).');
    }
    return lines.join('\n');
  }

  if (!helper.statusProbeOk || !helper.capabilities) {
    lines.push('Capacidades do helper indisponiveis agora; tente novamente apos validar o ambiente local.');
    if (!helper.privilegeEscalationReady && helper.sudoAvailable) {
      lines.push('Fallback: terminal com sudo.');
    }
    return lines.join('\n');
  }

  const serviceManager = helper.capabilities.systemctl ? 'systemctl' : helper.capabilities.service ? 'service' : 'nenhum';
  lines.push(`Service manager: ${serviceManager} • curl: ${helper.capabilities.curl ? 'ok' : 'ausente'}`);

  if (!helper.agentOperationalReady) {
    if (helper.sudoPolicyDenied) {
      lines.push('Fallback recomendado: solicitar permissao administrativa do host (sudo/polkit).');
    } else if (helper.sudoAvailable) {
      lines.push('Fallback recomendado: terminal com sudo (sem caminho automatizado neste ambiente).');
    } else {
      lines.push('Fallback recomendado: terminal manual (sem pkexec/sudo detectado).');
    }
  } else if (helper.agentOperationalLevel === 'assisted') {
    lines.push('Fluxo operacional: assistido via terminal (sudo interativo).');
  } else if (!helper.privilegeEscalationReady) {
    if (helper.sudoAvailable) {
      lines.push('Fallback recomendado: terminal com sudo (sem prompt grafico/pkexec).');
    } else {
      lines.push('Fallback recomendado: terminal manual (sem pkexec/sudo detectado).');
    }
  } else if (!helper.capabilities.systemctl && !helper.capabilities.service) {
    lines.push('Hint: sem systemctl/service; o Dexter pode precisar de fallback para `ollama serve` no terminal local.');
  } else {
    lines.push('Fluxo GUI: helper privilegiado via pkexec pronto para uso (quando acao exigir privilegio).');
  }

  return lines.join('\n');
}

function syncRuntimeHelperDetailsPanel(status: RuntimeStatus): void {
  const helper = status.privilegedHelper;
  if (!helper) {
    const nextOpen = runtimeHelperDetailsPanelPreference ?? false;
    runtimeHelperDetailsPanelSyncing = true;
    elements.runtimeHelperDetailsPanel.open = nextOpen;
    runtimeHelperDetailsPanelSyncing = false;
    return;
  }

  const shouldOpen =
    !helper.configured ||
    !helper.available ||
    !helper.agentOperationalReady ||
    helper.agentOperationalLevel === 'assisted' ||
    !helper.statusProbeOk ||
    (helper.capabilities ? !helper.capabilities.systemctl && !helper.capabilities.service : false);

  const nextOpen = runtimeHelperDetailsPanelPreference ?? shouldOpen;
  runtimeHelperDetailsPanelSyncing = true;
  elements.runtimeHelperDetailsPanel.open = nextOpen;
  runtimeHelperDetailsPanelSyncing = false;
}

function renderCuratedModels(models: CuratedModel[]): void {
  currentCuratedModels = [...models];
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
  renderSetupOnboarding();
}

function renderInstalledModels(models: InstalledModel[]): void {
  currentInstalledModels = [...models];
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
  renderSetupOnboarding();
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
  syncHealthCardActions();
  renderSetupOnboarding();
}

function renderSetupOnboarding(): void {
  const view = deriveSetupOnboardingView();
  currentSetupPrimaryAction = view.primaryAction;
  currentSetupSecondaryAction = view.secondaryAction;

  elements.setupBadge.textContent = view.badgeLabel;
  elements.setupBadge.dataset.tone = view.badgeTone;
  elements.setupSummary.textContent = view.summary;
  elements.setupPrivilegeNote.innerHTML = '';
  elements.setupPrivilegeNote.append(...buildSetupPrivilegeNoteNodes(view.privilegeNote));

  renderSetupChecklist(view.checklist);
  renderSetupActionButton(elements.setupPrimaryActionBtn, view.primaryAction, { hiddenWhenEmpty: false });
  renderSetupActionButton(elements.setupSecondaryActionBtn, view.secondaryAction, { hiddenWhenEmpty: true });
}

function deriveSetupOnboardingView(): {
  badgeLabel: string;
  badgeTone: 'ok' | 'warn' | 'busy';
  summary: string;
  privilegeNote: string;
  checklist: SetupChecklistItem[];
  primaryAction: SetupAction | null;
  secondaryAction: SetupAction | null;
} {
  const runtime = currentRuntimeStatus;
  const health = currentHealthReport;
  const runtimeInstallMode = readPermissionModeFromUi('runtime.install');
  const systemExecMode = readPermissionModeFromUi('tools.system.exec');
  const runtimeInstallBlocked = runtimeInstallMode === 'deny';
  const systemExecBlocked = systemExecMode === 'deny';
  const installedCount = Math.max(currentInstalledModels.length, runtime?.installedModelCount ?? 0);
  const hasInstalledModel = installedCount > 0;
  const runtimeOnline = runtime?.ollamaReachable ?? false;
  const binaryFound = runtime?.binaryFound ?? false;
  const healthOk = health?.ok ?? false;
  const modelAvailable = health?.modelAvailable ?? false;
  const firstInstalledModel = currentInstalledModels[0]?.name ?? null;
  const helper = runtime?.privilegedHelper;
  const helperCapabilities = helper?.statusProbeOk ? helper.capabilities : null;
  const helperServiceManager = helperCapabilities
    ? helperCapabilities.systemctl
      ? 'systemctl'
      : helperCapabilities.service
        ? 'service'
        : 'nenhum'
    : null;
  const helperCapabilityHint = helperCapabilities
    ? `Helper Linux: service manager ${helperServiceManager}; curl ${helperCapabilities.curl ? 'ok' : 'ausente'}.`
    : helper?.configured
      ? helper.available
        ? 'Helper Linux configurado, mas sem leitura de capacidades agora.'
        : 'Helper Linux configurado, mas indisponivel no host.'
      : 'Helper Linux nao configurado neste ambiente/build.';
  const helperOperationalHint = helper
    ? `Modo operacional Linux: ${helper.agentOperationalMode} (${helper.agentOperationalLevel}). ${helper.agentOperationalReason}`
    : 'Sem diagnostico operacional de privilegio para este ambiente.';
  const helperModeLabel = helper ? `${helper.agentOperationalMode}/${helper.agentOperationalLevel}` : 'n/d';
  const helperPrivilegeBlocked = Boolean(helper && !helper.agentOperationalReady);
  const canOfferSetupRepair = binaryFound && !systemExecBlocked && isLocalRuntimeEndpoint(runtime?.endpoint ?? '');

  const checklist: SetupChecklistItem[] = [
    {
      title: 'Permissoes locais do Dexter',
      detail: `runtime.install=${runtimeInstallMode ?? '--'} • tools.system.exec=${systemExecMode ?? '--'} • agent=${helperModeLabel}`,
      state: runtimeInstallBlocked || systemExecBlocked || helperPrivilegeBlocked ? 'blocked' : 'done'
    },
    {
      title: 'Runtime Ollama instalado (binario no PATH)',
      detail: binaryFound
        ? `Detectado${runtime?.binaryPath ? ` em ${runtime.binaryPath}` : '.'}`
        : `O Dexter ainda nao encontrou o comando \`ollama\` no host local. ${helperCapabilityHint}`,
      state: binaryFound ? 'done' : runtimeInstallBlocked ? 'blocked' : runtime ? 'active' : 'pending'
    },
    {
      title: 'Runtime Ollama online',
      detail: runtimeOnline
        ? `Endpoint respondendo em ${runtime?.endpoint ?? '--'}.`
        : binaryFound
          ? `Runtime offline. Endpoint esperado: ${runtime?.endpoint ?? '--'}. ${helperCapabilityHint}`
          : 'Aguardando instalacao do runtime para iniciar o servico.',
      state: runtimeOnline ? 'done' : binaryFound ? (systemExecBlocked ? 'blocked' : 'active') : 'pending'
    },
    {
      title: 'Modelo local instalado',
      detail: hasInstalledModel
        ? `${installedCount} modelo(s) detectado(s).`
        : runtimeOnline
          ? 'Nenhum modelo local instalado ainda.'
          : 'Aguardando runtime online para baixar o primeiro modelo.',
      state: hasInstalledModel ? 'done' : runtimeOnline ? (systemExecBlocked ? 'blocked' : 'active') : 'pending'
    },
    {
      title: 'Health validado',
      detail: health
        ? healthOk
          ? 'Saude local validada: runtime, modelo e componentes principais ok.'
          : health.details.length > 0
            ? health.details.join(' ')
            : 'Health com alertas. Revise o painel e execute /health novamente.'
        : 'Aguardando coleta inicial de health.',
      state: healthOk ? 'done' : runtimeOnline && hasInstalledModel ? 'active' : 'pending'
    }
  ];

  if (!runtime) {
    return {
      badgeLabel: 'Detectando',
      badgeTone: 'busy',
      summary: 'Detectando runtime, modelos e saude do ambiente...',
      privilegeNote: 'Permissao do Dexter nao substitui privilegio do sistema. Em Linux, o runtime pode exigir pkexec/sudo.',
      checklist,
      primaryAction: {
        label: 'Aguarde...',
        target: 'runHealth',
        disabled: true,
        tone: 'busy'
      },
      secondaryAction: null
    };
  }

  if (!binaryFound) {
    return {
      badgeLabel: runtimeInstallBlocked ? 'Bloqueado' : 'Instalar',
      badgeTone: runtimeInstallBlocked ? 'warn' : 'busy',
      summary: runtimeInstallBlocked
        ? 'O runtime Ollama nao esta instalado e a permissao runtime.install esta em deny.'
        : 'Instale o runtime Ollama para habilitar o setup guiado. Em Linux, a instalacao pode exigir pkexec/sudo.',
      privilegeNote:
        runtimeInstallBlocked
          ? 'Libere `runtime.install` em Permissoes para o Dexter tentar instalar. Mesmo com allow, o Linux ainda pode exigir pkexec/sudo.'
          : `Se nao houver prompt grafico de privilegio (polkit/pkexec), o Dexter tenta sudo -n e orienta o fallback no terminal quando necessario. ${helperCapabilityHint} ${helperOperationalHint}`,
      checklist,
      primaryAction: runtimeInstallBlocked
        ? {
            label: 'Revisar Permissoes',
            target: 'focusRuntimeInstallPermission',
            tone: 'warn'
          }
        : {
            label: 'Instalar Runtime',
            target: 'installRuntime',
            disabled: elements.installRuntimeBtn.disabled,
            tone: 'busy'
          },
      secondaryAction: runtime.suggestedInstallCommand
        ? {
            label: 'Copiar Comando',
            target: 'copyInstallCommand'
          }
        : null
    };
  }

  if (!runtimeOnline) {
    return {
      badgeLabel: systemExecBlocked ? 'Bloqueado' : 'Iniciar',
      badgeTone: systemExecBlocked ? 'warn' : 'busy',
      summary: systemExecBlocked
        ? 'O runtime esta instalado, mas a permissao tools.system.exec esta em deny para iniciar o servico.'
        : 'Runtime instalado, mas offline. Inicie o runtime local para continuar o onboarding.',
      privilegeNote:
        `Permissao do Dexter controla a tentativa de iniciar o runtime. Se o servico falhar, use os detalhes do painel Runtime Local para diagnosticar endpoint, PATH e ambiente. ${helperCapabilityHint} ${helperOperationalHint}`,
      checklist,
      primaryAction: systemExecBlocked
        ? {
            label: 'Revisar Permissoes',
            target: 'focusSystemExecPermission',
            tone: 'warn'
          }
        : {
            label: 'Iniciar Runtime',
            target: 'startRuntime',
            disabled: elements.startRuntimeBtn.disabled,
            tone: 'busy'
          },
      secondaryAction: canOfferSetupRepair
        ? {
            label: 'Reparar Setup',
            target: 'repairSetup',
            disabled: elements.startRuntimeBtn.disabled,
            detail:
              'Tenta reparar o runtime local (helper privilegiado quando disponivel) e valida runtime/health em sequencia.'
          }
        : {
            label: 'Rodar Health',
            target: 'runHealth'
          }
    };
  }

  if (!hasInstalledModel) {
    return {
      badgeLabel: systemExecBlocked ? 'Bloqueado' : 'Baixar Modelo',
      badgeTone: systemExecBlocked ? 'warn' : 'busy',
      summary: systemExecBlocked
        ? 'Runtime online, mas a permissao tools.system.exec esta em deny para baixar modelos.'
        : 'Runtime online. Baixe um modelo local para concluir o setup minimo e usar o chat com resposta real.',
      privilegeNote:
        'Baixar modelos (`ollama pull`) normalmente nao exige sudo, mas depende de runtime online e permissao tools.system.exec no Dexter.',
      checklist,
      primaryAction: systemExecBlocked
        ? {
            label: 'Revisar Permissoes',
            target: 'focusSystemExecPermission',
            tone: 'warn'
          }
        : {
            label: 'Baixar Modelo',
            target: 'pullRecommendedModel',
            disabled: elements.pullModelBtn.disabled,
            tone: 'busy'
          },
      secondaryAction: {
        label: 'Rodar Health',
        target: 'runHealth'
      }
    };
  }

  if (!modelAvailable && firstInstalledModel) {
    return {
      badgeLabel: 'Ajustar Modelo',
      badgeTone: 'warn',
      summary: `Existe modelo local instalado, mas o modelo ativo atual nao esta disponivel. Ajuste para ${firstInstalledModel} ou outro modelo instalado.`,
      privilegeNote:
        'Esse passo nao exige privilegio do sistema. E apenas alinhamento do modelo configurado com os modelos presentes no host.',
      checklist,
      primaryAction: {
        label: 'Usar Modelo Instalado',
        target: 'selectInstalledModel'
      },
      secondaryAction: {
        label: 'Rodar Health',
        target: 'runHealth'
      }
    };
  }

  if (!healthOk) {
    return {
      badgeLabel: 'Validar',
      badgeTone: 'warn',
      summary: 'Runtime e modelos parecem prontos, mas o health ainda reporta alertas. Rode uma validacao e revise os detalhes.',
      privilegeNote:
        'Use o painel lateral e /health para validar o estado real. O Dexter mostra diagnostico local acionavel antes de sugerir passos sensiveis.',
      checklist,
      primaryAction: {
        label: 'Rodar Health',
        target: 'runHealth'
      },
      secondaryAction: canOfferSetupRepair
        ? {
            label: 'Reparar Setup',
            target: 'repairSetup',
            disabled: elements.startRuntimeBtn.disabled,
            detail: 'Executa diagnostico guiado (runtime + health) e tenta reparo do runtime se ele estiver offline.'
          }
        : {
            label: 'Ajuda Rapida',
            target: 'insertHelp'
      }
    };
  }

  if (helper && !helper.agentOperationalReady) {
    return {
      badgeLabel: 'Limitado',
      badgeTone: 'warn',
      summary:
        'Setup funcional, mas o Agent Mode Linux esta bloqueado por falta de caminho confiavel de privilegio (pkexec/sudo).',
      privilegeNote:
        `${helperOperationalHint} Sem privilegio operacional, o Dexter fica limitado para automacoes profundas no host.`,
      checklist,
      primaryAction: runtime.suggestedInstallCommand
        ? {
            label: 'Copiar Comando',
            target: 'copyInstallCommand',
            tone: 'warn'
          }
        : {
            label: 'Rodar Health',
            target: 'runHealth'
          },
      secondaryAction: {
        label: 'Ajuda Rapida',
        target: 'insertHelp'
      }
    };
  }

  if (helper && helper.agentOperationalLevel === 'assisted') {
    return {
      badgeLabel: 'Assistido',
      badgeTone: 'warn',
      summary:
        'Setup concluido em modo assistido: acoes privilegiadas do Agent Linux ainda dependem de terminal interativo (sudo).',
      privilegeNote:
        `${helperOperationalHint} Para automacao total sem prompt, prefira ambiente com pkexec/polkit ou sudo NOPASSWD controlado.`,
      checklist,
      primaryAction: {
        label: 'Ajuda Rapida',
        target: 'insertHelp',
        tone: 'ok'
      },
      secondaryAction: {
        label: 'Rodar Health',
        target: 'runHealth'
      }
    };
  }

  return {
    badgeLabel: 'Pronto',
    badgeTone: 'ok',
    summary: 'Setup minimo concluido. Runtime online, modelo local disponivel e health validado. Dexter pronto para uso operacional.',
    privilegeNote:
      'Para manutencao futura (reinstalar runtime, updates, diagnosticos), o fluxo continua guiado pelo painel com permissao interna do Dexter + privilegio do sistema quando necessario.',
    checklist,
    primaryAction: {
      label: 'Ajuda Rapida',
      target: 'insertHelp',
      tone: 'ok'
    },
    secondaryAction: {
      label: 'Rodar Health',
      target: 'runHealth'
    }
  };
}

function renderSetupChecklist(items: SetupChecklistItem[]): void {
  elements.setupChecklist.replaceChildren();

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'setup-checklist-item';
    li.dataset.state = item.state;

    const dot = document.createElement('span');
    dot.className = 'setup-checklist-dot';
    dot.textContent = setupChecklistDotLabel(item.state);
    dot.setAttribute('aria-hidden', 'true');
    li.appendChild(dot);

    const copy = document.createElement('div');
    copy.className = 'setup-checklist-copy';

    const title = document.createElement('div');
    title.className = 'setup-checklist-title';
    title.textContent = item.title;
    copy.appendChild(title);

    const detail = document.createElement('div');
    detail.className = 'setup-checklist-detail';
    detail.textContent = item.detail;
    copy.appendChild(detail);

    li.appendChild(copy);
    elements.setupChecklist.appendChild(li);
  }
}

function setupChecklistDotLabel(state: SetupChecklistItemState): string {
  if (state === 'done') {
    return 'OK';
  }
  if (state === 'active') {
    return '>';
  }
  if (state === 'blocked') {
    return '!';
  }
  return '•';
}

function renderSetupActionButton(
  button: HTMLButtonElement,
  action: SetupAction | null,
  options: { hiddenWhenEmpty: boolean }
): void {
  if (!action) {
    button.disabled = true;
    button.textContent = '';
    if (options.hiddenWhenEmpty) {
      button.hidden = true;
    }
    delete button.dataset.tone;
    button.title = '';
    return;
  }

  button.hidden = false;
  button.textContent = action.label;
  button.disabled = Boolean(action.disabled);
  button.title = action.detail ?? '';
  if (action.tone) {
    button.dataset.tone = action.tone;
  } else {
    delete button.dataset.tone;
  }
}

function buildSetupPrivilegeNoteNodes(text: string): (Node | string)[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const parts = normalized.split(/(`[^`]+`)/g).filter(Boolean);
  const nodes: (Node | string)[] = [];
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 3) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      nodes.push(code);
      continue;
    }
    nodes.push(part);
  }
  return nodes;
}

async function triggerSetupAction(slot: 'primary' | 'secondary'): Promise<void> {
  const action = slot === 'primary' ? currentSetupPrimaryAction : currentSetupSecondaryAction;
  if (!action || action.disabled) {
    return;
  }

  await performSetupAction(action);
}

async function performSetupAction(action: SetupAction): Promise<void> {
  switch (action.target) {
    case 'installRuntime':
      await installRuntime();
      return;
    case 'startRuntime':
      await startRuntime();
      return;
    case 'repairRuntime':
      await repairRuntime();
      return;
    case 'repairSetup':
      await repairSetup('onboarding');
      return;
    case 'pullRecommendedModel': {
      const chosen = chooseRecommendedSetupModel();
      if (chosen) {
        if (currentCuratedModels.some((item) => item.name === chosen)) {
          elements.curatedModelSelect.value = chosen;
        }
        elements.modelInput.value = chosen;
      }
      await pullSelectedModel();
      return;
    }
    case 'selectInstalledModel': {
      const chosen = currentInstalledModels[0]?.name ?? null;
      if (!chosen) {
        announcePanelActionLive('Nenhum modelo instalado disponivel para selecionar.');
        return;
      }
      elements.modelInput.value = chosen;
      await applyModel();
      return;
    }
    case 'runHealth':
      await refreshHealth(true);
      return;
    case 'insertHelp':
      if (insertPromptShortcutIntoComposer('/help')) {
        elements.promptInput.focus();
        announceComposerFeedbackLive('Comando /help inserido no composer.');
      }
      return;
    case 'copyInstallCommand':
      await copyRuntimeInstallCommandFromPanel();
      return;
    case 'focusRuntimeInstallPermission':
      setActiveView('governance', { announce: false, focus: false, smooth: false, source: 'legacy' });
      window.requestAnimationFrame(() => {
        focusModuleNavigationTarget(elements.permRuntimeInstall);
        announcePanelActionLive('Permissao runtime.install em foco.');
      });
      return;
    case 'focusSystemExecPermission':
      setActiveView('governance', { announce: false, focus: false, smooth: false, source: 'legacy' });
      window.requestAnimationFrame(() => {
        focusModuleNavigationTarget(elements.permSystemExec);
        announcePanelActionLive('Permissao tools.system.exec em foco.');
      });
      return;
    default:
      return;
  }
}

function chooseRecommendedSetupModel(): string | null {
  if (currentCuratedModels.length === 0) {
    return elements.modelInput.value.trim() || null;
  }

  const firstNotInstalledRecommended = currentCuratedModels.find((item) => item.recommended && !item.installed);
  if (firstNotInstalledRecommended) {
    return firstNotInstalledRecommended.name;
  }

  const firstNotInstalled = currentCuratedModels.find((item) => !item.installed);
  if (firstNotInstalled) {
    return firstNotInstalled.name;
  }

  return currentCuratedModels[0]?.name ?? null;
}

async function copyRuntimeInstallCommandFromPanel(): Promise<void> {
  const command = elements.runtimeCommand.textContent?.trim() || '';
  if (!command || command === '-') {
    announcePanelActionLive('Nenhum comando de instalacao disponivel para copiar.');
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command);
      announcePanelActionLive('Comando de instalacao copiado.');
      appendMessage('assistant', `Comando de instalacao copiado: ${command}`, 'command');
      return;
    }
  } catch {
    // Fallback de UX abaixo.
  }

  announcePanelActionLive('Falha ao copiar comando de instalacao.');
  appendMessage('assistant', `Nao consegui copiar automaticamente. Comando sugerido:\n${command}`, 'fallback');
}

function readPermissionModeFromUi(scope: PermissionScope): PermissionMode | null {
  switch (scope) {
    case 'runtime.install':
      return isPermissionModeValue(elements.permRuntimeInstall.value) ? elements.permRuntimeInstall.value : null;
    case 'tools.filesystem.read':
      return isPermissionModeValue(elements.permFsRead.value) ? elements.permFsRead.value : null;
    case 'tools.filesystem.write':
      return isPermissionModeValue(elements.permFsWrite.value) ? elements.permFsWrite.value : null;
    case 'tools.system.exec':
      return isPermissionModeValue(elements.permSystemExec.value) ? elements.permSystemExec.value : null;
    default:
      return null;
  }
}

function isPermissionModeValue(value: string): value is PermissionMode {
  return value === 'allow' || value === 'ask' || value === 'deny';
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

function renderRuntimeInstallProgress(event: RuntimeInstallProgressEvent): void {
  if (!activeRuntimeInstallProgress || event.phase === 'start') {
    activeRuntimeInstallProgress = {
      startedAtMs: Date.now(),
      lastPercent: typeof event.percent === 'number' ? clampPercent(event.percent) : null
    };
  }

  if (typeof event.percent === 'number' && activeRuntimeInstallProgress) {
    activeRuntimeInstallProgress.lastPercent = clampPercent(event.percent);
  }

  const tracker = activeRuntimeInstallProgress;
  if (!tracker) {
    return;
  }

  const percentValue =
    event.phase === 'done'
      ? 100
      : typeof event.percent === 'number'
        ? clampPercent(event.percent)
        : tracker.lastPercent;

  updateRuntimeInstallProgressClasses(event.phase, percentValue);
  elements.runtimeInstallProgressFill.style.width = `${percentValue ?? 0}%`;

  const percentText = typeof percentValue === 'number' ? ` (${formatProgressPercent(percentValue)})` : '';
  elements.runtimeInstallProgressText.textContent = `${event.message}${percentText}`;
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

  const percentText = typeof percentValue === 'number' ? ` (${formatProgressPercent(percentValue)})` : '';
  const statusLabel = event.operation.toUpperCase();
  const progressLabel = typeof percentValue === 'number' ? `${statusLabel} ${formatProgressPercent(percentValue)}` : statusLabel;
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
    elements.modelProgressEta.textContent = `ETA: ${formatEta(remaining)} (${progressLabel})`;
    return;
  }

  elements.modelProgressEta.textContent = `ETA: calculando... (${progressLabel})`;
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
  useBtn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    useMessageContentInComposer(content, useBtn);
  };
  actions.appendChild(useBtn);

  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'message-copy-btn';
    copyBtn.textContent = 'Copiar';
    copyBtn.setAttribute('aria-label', 'Copiar mensagem');
    copyBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyMessageContent(content, copyBtn);
    };
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
  modelButtonsBusy = busy;
  elements.pullModelBtn.disabled = busy;
  elements.removeModelBtn.disabled = busy;
  elements.installRuntimeBtn.disabled = busy;
  elements.startRuntimeBtn.disabled = busy;
  elements.repairRuntimeBtn.disabled = busy;

  if (!busy) {
    elements.pullModelBtn.textContent = 'Baixar Modelo';
    elements.removeModelBtn.textContent = 'Remover Modelo';
    elements.installRuntimeBtn.textContent = 'Instalar Runtime';
    elements.startRuntimeBtn.textContent = 'Iniciar Runtime';
    elements.repairRuntimeBtn.textContent = 'Reparar Runtime';
  }

  syncRuntimeActionButtons();
  syncHealthCardActions();
  renderSetupOnboarding();
  syncComposerContextActionChip();
}

function setMemoryActionsBusy(busy: boolean): void {
  memoryActionsBusy = busy;
  elements.memoryClearSessionBtn.disabled = busy;
  elements.memoryClearPreferencesBtn.disabled = busy;
  elements.memoryClearProfileBtn.disabled = busy;
  elements.memoryClearNotesBtn.disabled = busy;

  if (!busy) {
    elements.memoryClearSessionBtn.textContent = 'Limpar Sessao';
    elements.memoryClearPreferencesBtn.textContent = 'Limpar Preferencias';
    elements.memoryClearProfileBtn.textContent = 'Limpar Perfil';
    elements.memoryClearNotesBtn.textContent = 'Limpar Notas';
    return;
  }

  elements.memoryClearSessionBtn.textContent = 'Limpando...';
  elements.memoryClearPreferencesBtn.textContent = 'Limpando...';
  elements.memoryClearProfileBtn.textContent = 'Limpando...';
  elements.memoryClearNotesBtn.textContent = 'Limpando...';
}

function syncRuntimeActionButtons(status: RuntimeStatus | null = currentRuntimeStatus): void {
  if (!status) {
    elements.repairRuntimeBtn.disabled = true;
    elements.repairRuntimeBtn.textContent = 'Reparar Runtime';
    elements.repairRuntimeBtn.title = 'Aguardando diagnostico de runtime.';
    return;
  }

  const localEndpoint = isLocalRuntimeEndpoint(status.endpoint);
  const canRepair = status.binaryFound && localEndpoint;
  const label = status.ollamaReachable ? 'Reiniciar Runtime' : 'Reparar Runtime';

  elements.repairRuntimeBtn.textContent = modelButtonsBusy && elements.repairRuntimeBtn.textContent === 'Reparando...'
    ? elements.repairRuntimeBtn.textContent
    : label;
  elements.repairRuntimeBtn.disabled = modelButtonsBusy || !canRepair;

  if (!status.binaryFound) {
    elements.repairRuntimeBtn.title = 'Instale o runtime antes de tentar reparar/reiniciar.';
    return;
  }

  if (!localEndpoint) {
    elements.repairRuntimeBtn.title = 'Reparo local indisponivel: o endpoint configurado aponta para host remoto.';
    return;
  }

  const helperSummary = formatRuntimeHelperSummary(status);
  elements.repairRuntimeBtn.title = status.ollamaReachable
    ? `Tenta reiniciar o runtime local. ${helperSummary}`
    : `Tenta reparar/iniciar o runtime local. ${helperSummary}`;
}

function syncHealthCardActions(): void {
  const health = currentHealthReport;
  const runtime = currentRuntimeStatus;

  if (!health || health.ok) {
    elements.healthRepairSetupBtn.hidden = true;
    elements.healthRepairSetupBtn.disabled = true;
    elements.healthRepairSetupBtn.textContent = 'Reparar Setup';
    elements.healthRepairSetupBtn.title = '';
    return;
  }

  elements.healthRepairSetupBtn.hidden = false;
  elements.healthRepairSetupBtn.textContent = 'Reparar Setup';
  elements.healthRepairSetupBtn.disabled = modelButtonsBusy;

  if (!runtime) {
    elements.healthRepairSetupBtn.title = 'Executa validacao guiada do setup e tenta coletar runtime/health novamente.';
    return;
  }

  if (!runtime.binaryFound) {
    elements.healthRepairSetupBtn.title = 'Executa diagnostico guiado e indica instalacao do runtime quando necessario.';
    return;
  }

  if (!isLocalRuntimeEndpoint(runtime.endpoint)) {
    elements.healthRepairSetupBtn.title = 'Executa diagnostico guiado; reparo local nao e aplicado para endpoint remoto.';
    return;
  }

  elements.healthRepairSetupBtn.title = runtime.ollamaReachable
    ? 'Executa diagnostico guiado do setup (runtime + health) e sugere o proximo passo.'
    : 'Tenta reparar o runtime local e valida o setup em seguida.';
}

function setExportLogButtonsBusy(busy: boolean): void {
  elements.exportLogsBtn.disabled = busy;
  elements.exportUpdateLogsBtn.disabled = busy;
  elements.exportUiAuditLogsBtn.disabled = busy;
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

function handleCommandSuggestionKeyIntent(key: string, shiftKey: boolean): boolean {
  if (activeCommandSuggestions.length === 0) {
    return false;
  }

  if (key === 'ArrowDown') {
    activeCommandSuggestionIndex = (activeCommandSuggestionIndex + 1) % activeCommandSuggestions.length;
    renderCommandSuggestions();
    return true;
  }

  if (key === 'ArrowUp') {
    activeCommandSuggestionIndex =
      (activeCommandSuggestionIndex - 1 + activeCommandSuggestions.length) % activeCommandSuggestions.length;
    renderCommandSuggestions();
    return true;
  }

  if (key === 'Tab') {
    commitActiveCommandSuggestion();
    return true;
  }

  if (key === 'Enter' && !shiftKey && shouldCompleteCommandSuggestionOnEnter()) {
    commitActiveCommandSuggestion();
    return true;
  }

  if (key === 'Escape') {
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

  const focusTarget = (): void => {
    const target = resolveComposerContextActionTarget(action.target);
    if (!target) {
      return;
    }

    focusModuleNavigationTarget(target);
    showComposerContextActionFeedback(action);
  };

  const targetView = resolveComposerContextActionView(action.target);
  if (targetView) {
    setActiveView(targetView, { announce: false, focus: false, smooth: false, source: 'legacy' });
    window.requestAnimationFrame(() => {
      focusTarget();
    });
    return;
  }

  focusTarget();
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

function resolveComposerContextActionView(target: ComposerContextAction['target']): ActiveView | null {
  switch (target) {
    case 'runtimeStart':
      return 'modules';
    case 'updateRestart':
    case 'updateDownload':
    case 'updateCheck':
      return 'governance';
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

function initActiveViewBridge(): void {
  subscribeActiveView((view, options) => {
    handleActiveViewChange(view, options);
  });
}

function initUiIntentBridge(): void {
  subscribeUiIntent((intent) => {
    switch (intent.type) {
      case 'prompt-keydown':
        void handlePromptKeydownIntent(intent);
        return;
      case 'global-keydown':
        handleGlobalShortcutIntent(intent);
        return;
      case 'send-prompt':
        void sendPrompt();
        return;
      case 'apply-model':
        void applyModel();
        return;
      case 'refresh-health':
        void refreshHealth(intent.notify);
        return;
      case 'insert-command': {
        const inserted = insertPromptShortcutIntoComposer(intent.command);
        if (inserted) {
          announceComposerFeedbackLive(`Comando ${intent.command} inserido no composer.`);
        }
        return;
      }
      case 'apply-command-suggestion':
        applyCommandSuggestion(intent.command);
        return;
      case 'apply-empty-state-command':
        void applyEmptyStateCommandSuggestion(intent.command);
        return;
      case 'module-action':
        handleModuleManagerAction(intent.action);
        return;
      case 'run-legacy-command':
        void runLegacyUiCommand(intent.command);
        return;
      default:
        return;
    }
  });
}

async function handlePromptKeydownIntent(intent: Extract<UiIntent, { type: 'prompt-keydown' }>): Promise<void> {
  if (handleCommandSuggestionKeyIntent(intent.key, intent.shiftKey)) {
    return;
  }

  if (intent.key === 'Enter' && !intent.shiftKey) {
    await sendPrompt();
  }
}

function handleGlobalShortcutIntent(intent: Extract<UiIntent, { type: 'global-keydown' }>): boolean {
  if (intent.defaultPrevented || intent.altKey || intent.shiftKey) {
    return false;
  }

  if (!(intent.ctrlKey || intent.metaKey)) {
    return false;
  }

  if (intent.key.toLowerCase() === 'n') {
    void triggerNewSessionShortcut();
    return true;
  }

  if (intent.key === ',' || intent.code === 'Comma') {
    focusTopbarModelEditor();
    return true;
  }

  return false;
}

function handleActiveViewChange(view: ActiveView, options: ActiveViewChangeOptions = {}): void {
  const shouldAnnounce = options.announce ?? true;
  const shouldFocus = options.focus ?? true;
  const scrollBehavior: ScrollBehavior = options.smooth === false ? 'auto' : 'smooth';

  if (view === 'chat') {
    if (shouldFocus) {
      document.getElementById('chatPanel')?.scrollIntoView({ behavior: scrollBehavior, block: 'nearest', inline: 'nearest' });
      elements.promptInput.focus();
    }
    if (shouldAnnounce) {
      announcePanelActionLive(ACTIVE_VIEW_META.chat.focusAnnouncement);
    }
    return;
  }

  if (view === 'modules') {
    if (shouldFocus) {
      focusModuleNavigationTarget(elements.startRuntimeBtn);
    }
    if (shouldAnnounce) {
      announcePanelActionLive(ACTIVE_VIEW_META.modules.focusAnnouncement);
    }
    return;
  }

  if (view === 'settings') {
    const setupCard = document.getElementById('setupCard');
    if (shouldFocus && setupCard instanceof HTMLElement) {
      focusModuleNavigationTarget(setupCard);
    }
    if (shouldAnnounce) {
      announcePanelActionLive(ACTIVE_VIEW_META.settings.focusAnnouncement);
    }
    return;
  }

  if (shouldFocus) {
    focusModuleNavigationTarget(elements.permRuntimeInstall);
  }
  if (shouldAnnounce) {
    announcePanelActionLive(ACTIVE_VIEW_META.governance.focusAnnouncement);
  }
}

function handleModuleManagerAction(action: ModuleManagerAction): void {
  if (action.actionId.startsWith('toggle-')) {
    const stateLabel = action.enabled === null ? 'inalterado' : action.enabled ? 'ativo' : 'desativado';
    const message = `Modulo ${action.moduleId} marcado como ${stateLabel} no painel visual.`;
    announcePanelActionLive(message);
    appendMessage('assistant', message, 'command');
    return;
  }

  if (action.actionId === 'config-memory-layered') {
    setActiveView('chat', { announce: false, focus: false, smooth: false, source: 'legacy' });
    window.requestAnimationFrame(() => {
      focusModuleNavigationTarget(elements.memoryLivePanel);
      announcePanelActionLive('Configuracao de memoria em foco.');
    });
    return;
  }

  if (action.actionId === 'config-update-guard') {
    setActiveView('governance', { announce: false, focus: false, smooth: false, source: 'legacy' });
    window.requestAnimationFrame(() => {
      focusModuleNavigationTarget(elements.updateChannelSelect);
      announcePanelActionLive('Politica de update em foco.');
    });
    return;
  }

  if (action.actionId === 'config-audit-logs') {
    setActiveView('governance', { announce: false, focus: false, smooth: false, source: 'legacy' });
    window.requestAnimationFrame(() => {
      focusModuleNavigationTarget(elements.exportLogScopeSelect);
      announcePanelActionLive('Filtros de auditoria em foco.');
    });
    return;
  }

  if (action.actionId.startsWith('install-')) {
    const message = `Instalacao de ${action.moduleId} sera adicionada em um fluxo futuro de marketplace/local feed.`;
    announcePanelActionLive(message);
    appendMessage('assistant', message, 'command');
  }
}

async function runLegacyUiCommand(command: LegacyUiCommand): Promise<void> {
  switch (command) {
    case 'prompt-input': {
      const shouldStickToBottom = isChatScrolledNearBottom(elements.messages);
      resizeTextareaToContent(elements.promptInput);
      syncCommandSuggestions();
      if (shouldStickToBottom) {
        scrollChatToBottom({ smooth: false });
      } else {
        syncChatScrollToBottomButton();
      }
      return;
    }
    case 'window-resize':
      syncChatScrollToBottomButton();
      return;
    case 'system-theme-change':
      if (currentThemeMode === 'system') {
        applyThemeMode('system', { persist: false, announce: false });
      }
      return;
    case 'messages-scroll':
      syncChatScrollToBottomButton();
      return;
    case 'messages-shell-scroll':
      syncChatScrollToBottomButton();
      return;
    case 'chat-scroll-bottom':
      scrollChatToBottom({ smooth: true, resetUnread: true, announce: true });
      return;
    case 'attach':
      appendMessage('assistant', 'Anexos ainda nao estao disponiveis nesta versao da UI.', 'fallback');
      return;
    case 'composer-context-action':
      activateComposerContextAction();
      return;
    case 'theme-mode-change':
      applyThemeMode(parseUiThemeMode(elements.themeModeSelect.value), { persist: true, announce: true });
      return;
    case 'runtime-helper-details-toggle':
      if (runtimeHelperDetailsPanelSyncing) {
        return;
      }
      runtimeHelperDetailsPanelPreference = elements.runtimeHelperDetailsPanel.open;
      persistRuntimeHelperDetailsPanelPreference(elements.runtimeHelperDetailsPanel.open);
      return;
    case 'repair-setup-health':
      await repairSetup('health-card');
      return;
    case 'memory-clear-session':
      await clearMemoryScope('session.short');
      return;
    case 'memory-clear-preferences':
      await clearMemoryScope('long.preferences');
      return;
    case 'memory-clear-profile':
      await clearMemoryScope('long.profile');
      return;
    case 'memory-clear-notes':
      await clearMemoryScope('long.notes');
      return;
    case 'window-minimize':
      await window.dexter.minimize();
      return;
    case 'window-toggle-tray':
      await window.dexter.toggleVisibility();
      return;
    case 'runtime-install':
      await installRuntime();
      return;
    case 'runtime-start':
      await startRuntime();
      return;
    case 'runtime-repair':
      await repairRuntime();
      return;
    case 'setup-primary':
      await triggerSetupAction('primary');
      return;
    case 'setup-secondary':
      await triggerSetupAction('secondary');
      return;
    case 'model-pull':
      await pullSelectedModel();
      return;
    case 'model-remove':
      await removeSelectedModel();
      return;
    case 'update-check':
      await checkForUpdatesAction();
      return;
    case 'update-download':
      await downloadUpdateAction();
      return;
    case 'update-restart':
      await restartToApplyUpdateAction();
      return;
    case 'update-channel-change':
      await applyUpdatePolicy();
      return;
    case 'update-auto-check-change':
      await applyUpdatePolicy();
      return;
    case 'permission-runtime-install-change':
      await applyPermission(elements.permRuntimeInstall);
      return;
    case 'permission-fs-read-change':
      await applyPermission(elements.permFsRead);
      return;
    case 'permission-fs-write-change':
      await applyPermission(elements.permFsWrite);
      return;
    case 'permission-system-exec-change':
      await applyPermission(elements.permSystemExec);
      return;
    case 'history-prev':
      if (historyPage > 1) {
        historyPage -= 1;
        await refreshModelHistory();
      }
      return;
    case 'history-next':
      if (!currentHistoryPage || historyPage < currentHistoryPage.totalPages) {
        historyPage += 1;
        await refreshModelHistory();
      }
      return;
    case 'history-operation-filter-change':
      historyOperationFilter = parseHistoryOperation(elements.historyOperationFilter.value);
      historyPage = 1;
      await refreshModelHistory();
      return;
    case 'history-status-filter-change':
      historyStatusFilter = parseHistoryStatus(elements.historyStatusFilter.value);
      historyPage = 1;
      await refreshModelHistory();
      return;
    case 'export-history':
      await exportHistoryAudit();
      return;
    case 'export-logs':
      await exportLogsAudit();
      return;
    case 'export-update-logs':
      elements.exportLogScopeSelect.value = 'updates';
      persistExportLogScope('updates');
      await exportLogsAudit('updates');
      return;
    case 'export-ui-audit-logs':
      announcePanelActionLive('Exportando logs de auditoria de UI usando o periodo atual selecionado...');
      elements.exportLogScopeSelect.value = 'ui';
      persistExportLogScope('ui');
      await exportLogsAudit('ui');
      return;
    case 'export-update-audit-trail':
      await exportUpdateAuditTrail();
      return;
    case 'export-update-audit-errors':
      elements.exportUpdateAuditFamilySelect.value = 'all';
      elements.exportUpdateAuditSeveritySelect.value = 'warn-error';
      elements.exportUpdateAuditCodeOnly.checked = true;
      elements.exportLogScopeSelect.value = 'updates';
      persistExportLogScope('updates');
      persistUpdateAuditTrailFilterControls();
      await exportUpdateAuditTrail();
      return;
    case 'export-update-audit-family-change':
      persistUpdateAuditTrailFilterControls();
      await refreshAuditExportPreviews();
      return;
    case 'export-update-audit-severity-change':
      persistUpdateAuditTrailFilterControls();
      await refreshAuditExportPreviews();
      return;
    case 'export-update-audit-window-change':
      persistUpdateAuditTrailFilterControls();
      await refreshAuditExportPreviews();
      return;
    case 'export-update-audit-code-only-change':
      persistUpdateAuditTrailFilterControls();
      await refreshAuditExportPreviews();
      return;
    case 'export-log-scope-change':
      persistExportLogScope(parseLogExportScope(elements.exportLogScopeSelect.value));
      await refreshExportLogsPreview();
      return;
    case 'export-format-change':
      await refreshAuditExportPreviews();
      return;
    case 'export-date-from-change':
      setActiveExportPreset(null);
      await refreshAuditExportPreviews();
      return;
    case 'export-date-to-change':
      setActiveExportPreset(null);
      await refreshAuditExportPreviews();
      return;
    case 'export-preset-today':
      applyExportPreset('today');
      return;
    case 'export-preset-7d':
      applyExportPreset('7d');
      return;
    case 'export-preset-30d':
      applyExportPreset('30d');
      return;
    case 'export-preset-clear':
      applyExportPreset('clear');
      return;
    default:
      return;
  }
}

function focusModuleNavigationTarget(target: HTMLElement): void {
  openAncestorDetails(target);
  const card = target.closest<HTMLElement>('.card');
  const focusTarget = isElementKeyboardFocusable(target) ? target : card ?? target;
  const shouldSetTabIndex =
    !isElementKeyboardFocusable(focusTarget) && !(focusTarget instanceof HTMLButtonElement) && !(focusTarget instanceof HTMLInputElement);

  focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  if (shouldSetTabIndex && focusTarget.tabIndex < 0) {
    focusTarget.tabIndex = -1;
  }
  focusTarget.focus({ preventScroll: true });
}

function openAncestorDetails(target: HTMLElement): void {
  let current: HTMLElement | null = target;
  while (current) {
    if (current instanceof HTMLDetailsElement && !current.open) {
      current.open = true;
    }
    current = current.parentElement;
  }
}

function isElementKeyboardFocusable(element: HTMLElement): boolean {
  return (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLAnchorElement ||
    element.tabIndex >= 0
  );
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

function summarizeInstallResult(result: RuntimeInstallResult): string {
  const lines: string[] = [];

  if (result.strategy) {
    lines.push(`Estrategia: ${describeRuntimeInstallStrategy(result.strategy)}.`);
  }

  if (result.errorCode) {
    lines.push(`Codigo: ${result.errorCode}.`);
  }

  if (result.command) {
    lines.push(`Comando: ${result.command}.`);
  }

  lines.push(`Exit: ${result.exitCode ?? 'n/a'}${result.timedOut ? ' (timeout)' : ''}.`);

  const excerpt = clipRuntimeInstallOutput(result.errorOutput || result.output || '');
  if (excerpt) {
    lines.push(`Saida: ${excerpt}`);
  }

  if (Array.isArray(result.nextSteps) && result.nextSteps.length > 0) {
    lines.push('Proximos passos:');
    for (const step of result.nextSteps.slice(0, 4)) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join('\n');
}

function buildModelOperationFailureMessage(
  operation: 'pull' | 'remove',
  model: string,
  result: ModelOperationResult
): string {
  const actionLabel = operation === 'pull' ? 'baixar' : 'remover';
  const lines: string[] = [`Nao foi possivel ${actionLabel} ${model}.`];

  if (result.errorCode) {
    lines.push(`Codigo: ${result.errorCode}.`);
  }

  if (result.strategy) {
    lines.push(`Estrategia: ${describeModelOperationStrategy(result.strategy)}.`);
  }

  if (result.command) {
    lines.push(`Comando: ${result.command}.`);
  }

  const excerpt = clipRuntimeInstallOutput(result.errorOutput || result.output || result.message || '');
  if (excerpt) {
    lines.push(`Saida: ${excerpt}`);
  }

  if (Array.isArray(result.nextSteps) && result.nextSteps.length > 0) {
    lines.push('Proximos passos:');
    for (const step of result.nextSteps.slice(0, 4)) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join('\n');
}

function describeModelOperationStrategy(strategy: ModelOperationResult['strategy']): string {
  if (strategy === 'ollama-cli-local') {
    return 'ollama/cli local';
  }
  if (strategy === 'assist') {
    return 'assistido';
  }
  return 'desconhecida';
}

function clipRuntimeInstallOutput(value: string): string {
  const compact = value
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!compact) {
    return '';
  }

  const limit = 520;
  return compact.length > limit ? `...${compact.slice(compact.length - limit)}` : compact;
}

function isLocalRuntimeEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function buildSetupRepairFeedback(input: {
  beforeRuntime: RuntimeStatus | null;
  afterRuntime: RuntimeStatus | null;
  afterHealth: HealthReport | null;
  attemptedRuntimeRepair: boolean;
}): {
  message: string;
  tone: 'command' | 'fallback';
  outcomeCode:
    | 'health_ok'
    | 'runtime_recovered_health_alerts'
    | 'runtime_offline_after_repair'
    | 'health_alerts'
    | 'health_unavailable';
  nextStep: string | null;
} {
  const runtime = input.afterRuntime;
  const health = input.afterHealth;
  const runtimeRecovered = Boolean(
    input.attemptedRuntimeRepair && !input.beforeRuntime?.ollamaReachable && input.afterRuntime?.ollamaReachable
  );
  const lines: string[] = [];
  let nextStep: string | null = null;

  const pushNextStep = (step: string): void => {
    if (!nextStep) {
      nextStep = step;
    }
    lines.push(step);
  };
  let outcomeCode:
    | 'health_ok'
    | 'runtime_recovered_health_alerts'
    | 'runtime_offline_after_repair'
    | 'health_alerts'
    | 'health_unavailable' = 'health_alerts';

  if (health?.ok) {
    outcomeCode = 'health_ok';
    lines.push(
      input.attemptedRuntimeRepair
        ? 'Reparo de setup concluido: runtime validado e health OK.'
        : 'Validacao guiada do setup concluida: health OK.'
    );
  } else if (runtimeRecovered) {
    outcomeCode = 'runtime_recovered_health_alerts';
    lines.push('Runtime voltou a responder, mas o setup ainda tem alertas de health.');
  } else if (input.attemptedRuntimeRepair) {
    outcomeCode = 'runtime_offline_after_repair';
    lines.push('Tentei reparar o setup, mas o runtime ainda nao ficou online.');
  } else {
    outcomeCode = health ? 'health_alerts' : 'health_unavailable';
    lines.push('Diagnostico guiado do setup concluido com alertas.');
  }

  if (runtime) {
    lines.push(`Runtime: ${runtime.ollamaReachable ? 'online' : 'offline'} (${runtime.endpoint}).`);
    const helperSummary = formatRuntimeHelperSummary(runtime);
    if (helperSummary && helperSummary !== 'Sem diagnostico de helper.') {
      lines.push(`Helper: ${helperSummary}`);
    }
  } else {
    lines.push('Runtime: sem status atualizado no momento.');
  }

  if (health) {
    if (health.ok) {
      lines.push('Health: OK.');
    } else {
      const alertTags = [
        health.ollamaReachable ? null : 'runtime',
        health.modelAvailable ? null : 'modelo',
        health.memoryHealthy ? null : 'memoria',
        health.loggingHealthy ? null : 'logs'
      ].filter(Boolean);
      lines.push(`Health: alertas (${alertTags.length > 0 ? alertTags.join(', ') : 'detalhes no painel'}).`);

      if (health.details.length > 0) {
        lines.push(`Detalhes: ${clipRuntimeInstallOutput(health.details.join(' '))}`);
      }
    }
  } else {
    lines.push('Health: nao foi possivel coletar agora.');
  }

  if (runtime && !runtime.binaryFound) {
    pushNextStep(`Proximo passo: instale o runtime (${runtime.suggestedInstallCommand || 'consulte docs do host'}).`);
  } else if (runtime && !runtime.ollamaReachable) {
    if (!isLocalRuntimeEndpoint(runtime.endpoint)) {
      pushNextStep('Proximo passo: o endpoint configurado e remoto; valide o host remoto fora do Dexter.');
    } else if (runtime.privilegedHelper?.statusProbeOk && runtime.privilegedHelper.capabilities) {
      const helperCaps = runtime.privilegedHelper.capabilities;
      if (!helperCaps.systemctl && !helperCaps.service) {
        pushNextStep(
          'Proximo passo: o host nao expoe `systemctl`/`service`; tente iniciar com `ollama serve` em terminal local e revalide com /health.'
        );
      } else {
        pushNextStep('Proximo passo: revise o painel Runtime Local e tente iniciar/reparar novamente; use o fluxo manual se necessario.');
      }
    } else {
      pushNextStep('Proximo passo: revise o painel Runtime Local e tente iniciar/reparar novamente; use o fluxo manual se necessario.');
    }
  } else if (health && !health.modelAvailable) {
    const installedCount = Math.max(currentInstalledModels.length, runtime?.installedModelCount ?? 0);
    const configuredModel = elements.modelInput.value.trim();
    if (installedCount > 0) {
      const firstInstalled = currentInstalledModels[0]?.name;
      if (firstInstalled && configuredModel && configuredModel !== firstInstalled) {
        pushNextStep(`Proximo passo: selecione um modelo instalado (ex.: ${firstInstalled}) ou ajuste o modelo ativo no topo.`);
      } else {
        pushNextStep('Proximo passo: selecione um modelo local instalado no painel Modelos e rode /health novamente.');
      }
    } else {
      pushNextStep('Proximo passo: baixe um modelo local no painel Modelos.');
    }
  } else if (health && (!health.memoryHealthy || !health.loggingHealthy)) {
    const components = [health.memoryHealthy ? null : 'memoria', health.loggingHealthy ? null : 'logs'].filter(Boolean);
    pushNextStep(`Proximo passo: revise os componentes com alerta (${components.join(', ')}) e rode /health novamente.`);
  }

  const tone: 'command' | 'fallback' = health?.ok || runtimeRecovered ? 'command' : 'fallback';
  return {
    message: lines.join('\n'),
    tone,
    outcomeCode,
    nextStep
  };
}

async function recordRepairSetupAuditEvent(input: {
  origin: RepairSetupOrigin;
  result:
    | 'health_ok'
    | 'runtime_recovered_health_alerts'
    | 'runtime_offline_after_repair'
    | 'health_alerts'
    | 'health_unavailable'
    | 'permission_not_granted'
    | 'unexpected_error';
  attemptedRuntimeRepair: boolean;
  beforeRuntime: RuntimeStatus | null;
  afterRuntime: RuntimeStatus | null;
  afterHealth: HealthReport | null;
  nextStep: string | null;
}): Promise<void> {
  try {
    const runtime = input.afterRuntime;
    const health = input.afterHealth;
    await window.dexter.recordUiAuditEvent('setup.repair.finish', {
      origin: input.origin,
      sessionId,
      result: input.result,
      attemptedRuntimeRepair: input.attemptedRuntimeRepair,
      nextStepSuggested: input.nextStep,
      runtime: runtime
        ? {
            endpoint: runtime.endpoint,
            binaryFound: runtime.binaryFound,
            reachable: runtime.ollamaReachable,
            installedModelCount: runtime.installedModelCount,
            helperSummary: formatRuntimeHelperSummary(runtime)
          }
        : null,
      health: health
        ? {
            ok: health.ok,
            ollamaReachable: health.ollamaReachable,
            modelAvailable: health.modelAvailable,
            memoryHealthy: health.memoryHealthy,
            loggingHealthy: health.loggingHealthy
          }
        : null,
      beforeRuntimeReachable: input.beforeRuntime?.ollamaReachable ?? null
    });
  } catch {
    // Nao interromper UX por falha de auditoria local.
  }
}

function isLinuxInstallCommand(command: string): boolean {
  return command.trim() === 'curl -fsSL https://ollama.com/install.sh | sh';
}

function toLinuxSudoInstallExample(command: string): string {
  if (!command.trim()) {
    return 'consulte a documentacao da sua distro';
  }
  if (isLinuxInstallCommand(command)) {
    return 'curl -fsSL https://ollama.com/install.sh | sudo sh';
  }
  return `sudo bash -lc '${command.replace(/'/g, "'\\''")}'`;
}

function describeRuntimeInstallStrategy(strategy: RuntimeInstallResult['strategy']): string {
  if (strategy === 'linux-pkexec-helper') {
    return 'linux/pkexec-helper';
  }
  if (strategy === 'linux-pkexec') {
    return 'linux/pkexec';
  }
  if (strategy === 'linux-sudo-noninteractive') {
    return 'linux/sudo-noninteractive';
  }
  if (strategy === 'linux-shell') {
    return 'linux/shell';
  }
  if (strategy === 'linux-assist') {
    return 'linux/assistido';
  }
  if (strategy === 'darwin-shell') {
    return 'macOS/shell';
  }
  if (strategy === 'win32-manual') {
    return 'windows/manual';
  }
  if (strategy === 'unsupported') {
    return 'nao suportado';
  }
  return 'desconhecida';
}

function resetModelProgressUi(): void {
  activeProgress = null;
  elements.modelProgressTrack.classList.remove('indeterminate', 'success', 'error');
  elements.modelProgressFill.style.width = '0%';
  elements.modelProgressText.textContent = 'Sem operacao em andamento.';
  elements.modelProgressEta.textContent = 'ETA: --';
}

function resetRuntimeInstallProgressUi(): void {
  activeRuntimeInstallProgress = null;
  elements.runtimeInstallProgressTrack.classList.remove('indeterminate', 'success', 'error');
  elements.runtimeInstallProgressFill.style.width = '0%';
  elements.runtimeInstallProgressText.textContent = 'Sem instalacao em andamento.';
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
    const scopeLabel = describeLogExportScope(scope);
    announcePanelActionLive(`${scopeLabel} exportados em ${format}: ${payload.fileName}.`);
    appendMessage(
      'assistant',
      `${scopeLabel} exportados: ${payload.fileName}${formatExportIntegritySuffix(payload)}.`,
      'command'
    );
  } catch {
    announcePanelActionLive(`Falha ao exportar ${describeLogExportScope(scope).toLowerCase()}.`);
    appendMessage('assistant', `Falha ao exportar ${describeLogExportScope(scope).toLowerCase()}.`, 'fallback');
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

    const scopeLabel = result.scope;
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
    li.onclick = () => {
      selectedHistoryId = item.id;
      renderModelHistory(items);
    };
    li.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      selectedHistoryId = item.id;
      renderModelHistory(items);
    };
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

function updateRuntimeInstallProgressClasses(
  phase: RuntimeInstallProgressEvent['phase'],
  percent: number | null
): void {
  elements.runtimeInstallProgressTrack.classList.remove('indeterminate', 'success', 'error');

  if (phase === 'done') {
    elements.runtimeInstallProgressTrack.classList.add('success');
    return;
  }

  if (phase === 'error') {
    elements.runtimeInstallProgressTrack.classList.add('error');
    return;
  }

  if (phase === 'start' || typeof percent !== 'number' || percent <= 0 || percent >= 100) {
    elements.runtimeInstallProgressTrack.classList.add('indeterminate');
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

function formatProgressPercent(value: number): string {
  const clamped = clampPercent(value);
  return Number.isInteger(clamped) ? `${clamped}%` : `${clamped.toFixed(1)}%`;
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
  return value === 'updates' || value === 'ui' ? value : 'all';
}

function describeLogExportScope(scope: LogExportScope): string {
  if (scope === 'updates') {
    return 'Logs de update';
  }
  if (scope === 'ui') {
    return 'Logs de auditoria de UI';
  }
  return 'Logs';
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

function hydrateRuntimeHelperDetailsPanelPreference(): void {
  runtimeHelperDetailsPanelPreference = readRuntimeHelperDetailsPanelPreference();
  if (runtimeHelperDetailsPanelPreference === null) {
    return;
  }

  runtimeHelperDetailsPanelSyncing = true;
  elements.runtimeHelperDetailsPanel.open = runtimeHelperDetailsPanelPreference;
  runtimeHelperDetailsPanelSyncing = false;
}

function initThemeModeUi(): void {
  applyThemeMode(readUiThemeMode(), { persist: false, announce: false });
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
    return value === 'updates' || value === 'ui' ? value : 'all';
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

function readRuntimeHelperDetailsPanelPreference(): boolean | null {
  try {
    const value = window.localStorage.getItem(RUNTIME_HELPER_DETAILS_OPEN_STORAGE_KEY);
    if (value === '1') {
      return true;
    }
    if (value === '0') {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

function persistRuntimeHelperDetailsPanelPreference(open: boolean): void {
  try {
    window.localStorage.setItem(RUNTIME_HELPER_DETAILS_OPEN_STORAGE_KEY, open ? '1' : '0');
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
  action: string,
  options?: {
    silentDenied?: boolean;
    silentCancel?: boolean;
  }
): Promise<{ allowed: boolean; approvedPrompt: boolean }> {
  const check = await window.dexter.checkPermission(scope, action);

  if (check.allowed) {
    return {
      allowed: true,
      approvedPrompt: false
    };
  }

  if (!check.requiresPrompt) {
    if (!options?.silentDenied) {
      appendMessage('assistant', check.message, 'fallback');
    }
    return {
      allowed: false,
      approvedPrompt: false
    };
  }

  const approved = window.confirm(`${check.message}\\n\\nEscopo: ${scope}`);
  if (!approved) {
    if (!options?.silentCancel) {
      appendMessage('assistant', `Acao cancelada: ${action}.`, 'command');
    }
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
