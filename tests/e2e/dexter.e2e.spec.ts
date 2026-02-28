import path from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';

type DexterPage = Awaited<ReturnType<ElectronApplication['firstWindow']>>;

async function launchDexter(
  envOverrides: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: DexterPage }> {
  const repoRoot = path.resolve(__dirname, '../..');
  const electronArgs = [repoRoot];

  if (process.env.CI) {
    electronArgs.push('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage');
  }

  const app = await electron.launch({
    args: electronArgs,
    env: {
      ...process.env,
      DEXTER_MOCK_API: '1',
      ...envOverrides
    }
  });

  const page = await app.firstWindow();
  return { app, page };
}

type ActivityView = 'chat' | 'modules' | 'settings' | 'governance';

async function openActivityView(page: DexterPage, view: ActivityView): Promise<void> {
  const labelByView: Record<ActivityView, string> = {
    chat: 'Chat',
    modules: 'Modulos',
    settings: 'Configuracoes',
    governance: 'Governanca'
  };

  await page.getByRole('button', { name: labelByView[view], exact: true }).click();
  await expect(page.locator(`[data-sidepanel-view="${view}"]`)).toBeVisible();
}

async function setPermissionMode(
  page: DexterPage,
  selectId: '#permRuntimeInstall' | '#permSystemExec',
  scope: 'runtime.install' | 'tools.system.exec',
  mode: 'allow' | 'ask' | 'deny'
): Promise<void> {
  await openActivityView(page, 'governance');
  await page.locator(selectId).selectOption(mode);
  await expect(page.locator('.message.assistant').last()).toContainText(`Permissao ${scope} atualizada para ${mode}.`);
}

async function completeMockSetupToHealthy(page: DexterPage): Promise<void> {
  await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'allow');
  await openActivityView(page, 'modules');
  await page.selectOption('#curatedModelSelect', { index: 0 });
  await page.click('#startRuntimeBtn');
  await expect(page.locator('#runtimeSummary')).toContainText('Runtime online');
  await page.click('#pullModelBtn');
  await expect(page.locator('#modelProgressText')).toContainText('100%');
  await page.click('#healthBtn');
  await expect(page.locator('.message.assistant').last()).toContainText('Health check concluido');
}

async function useCustomModelInput(page: DexterPage, model: string): Promise<void> {
  await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('#curatedModelSelect');
    if (select) {
      select.value = '';
    }
  });
  await page.fill('#modelInput', model);
}

async function readDetailsOpenState(page: DexterPage, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((el) => (el as HTMLDetailsElement).open);
}

async function installExportLogsPayloadProbe(page: DexterPage): Promise<void> {
  await page.evaluate(() => {
    type WindowWithProbe = Window & {
      __dexterExportLogsProbeInstalled?: boolean;
      __dexterLastDownloadedExportPayload?: {
        fileName: string;
        mimeType: string;
        content: string;
      } | null;
    };

    const scopedWindow = window as unknown as WindowWithProbe;
    if (scopedWindow.__dexterExportLogsProbeInstalled) {
      scopedWindow.__dexterLastDownloadedExportPayload = null;
      return;
    }

    const blobByUrl = new Map<string, Blob>();
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;

    URL.createObjectURL = ((blob: Blob | MediaSource) => {
      const url = originalCreateObjectURL(blob);
      if (blob instanceof Blob) {
        blobByUrl.set(url, blob);
      }
      return url;
    }) as typeof URL.createObjectURL;

    URL.revokeObjectURL = ((url: string) => {
      blobByUrl.delete(url);
      return originalRevokeObjectURL(url);
    }) as typeof URL.revokeObjectURL;

    HTMLAnchorElement.prototype.click = function patchedAnchorClick(...args: unknown[]) {
      const href = this.href;
      const blob = blobByUrl.get(href);
      if (blob) {
        void blob.text().then((content) => {
          scopedWindow.__dexterLastDownloadedExportPayload = {
            fileName: this.download || 'dexter-export.txt',
            mimeType: blob.type || 'text/plain;charset=utf-8',
            content
          };
        });
      }

      return originalAnchorClick.apply(this, args as []);
    };

    scopedWindow.__dexterExportLogsProbeInstalled = true;
    scopedWindow.__dexterLastDownloadedExportPayload = null;
  });
}

async function readExportLogsPayloadProbe(page: DexterPage): Promise<{
  fileName: string;
  mimeType: string;
  content: string;
} | null> {
  return page.evaluate(() => {
    type WindowWithProbe = Window & {
      __dexterLastDownloadedExportPayload?: {
        fileName: string;
        mimeType: string;
        content: string;
      } | null;
    };
    return ((window as unknown as WindowWithProbe).__dexterLastDownloadedExportPayload ?? null) as
      | {
          fileName: string;
          mimeType: string;
          content: string;
        }
      | null;
  });
}

function parseCsvRows(content: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      currentCell += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }
    if (char === '\r') {
      continue;
    }
    if (char === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return [];
  }

  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return body
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((row) => {
      const entry: Record<string, string> = {};
      for (let i = 0; i < header.length; i += 1) {
        entry[header[i] ?? `col_${i}`] = row[i] ?? '';
      }
      return entry;
    });
}

test('carrega interface principal e responde chat em modo mock', async () => {
  const { app, page } = await launchDexter();

  try {
    await expect(page.getByRole('heading', { name: 'Dexter' })).toBeVisible();
    await expect(page.locator('#themeModeSelect')).toBeVisible();
    await expect(page.locator('#themeModeSelect')).toHaveValue('dark');
    await page.locator('#themeModeSelect').selectOption('light');
    await expect(page.locator('body')).toHaveAttribute('data-theme-mode', 'light');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('#themeModeSelect')).toHaveValue('light');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
    await page.locator('#themeModeSelect').selectOption('dark');

    await openActivityView(page, 'settings');
    await expect(page.locator('#setupTitle')).toHaveText('Primeiros Passos');
    await expect(page.locator('#setupPrimaryActionBtn')).toHaveText('Iniciar Runtime');
    await expect(page.locator('#setupSecondaryActionBtn')).toHaveText('Reparar Setup');
    await expect(page.locator('#setupChecklist')).toContainText('Runtime Ollama online');
    await expect(page.locator('#setupPrivilegeNote')).toContainText('Permissao do Dexter');

    await openActivityView(page, 'modules');
    await expect(page.locator('#repairRuntimeBtn')).toHaveText('Reparar Runtime');
    await expect(page.locator('#runtimeHelperDetailsPanel')).toBeVisible();

    await openActivityView(page, 'chat');
    await expect(page.locator('#healthRepairSetupBtn')).toBeVisible();
    await expect(page.locator('#healthRepairSetupBtn')).toHaveText('Reparar Setup');

    await openActivityView(page, 'governance');
    await expect(page.locator('#exportUiAuditLogsBtn')).toHaveText('Logs de UI');

    await expect(page.locator('.message-session-separator').first()).toContainText('Sessao 1 iniciada as');
    await openActivityView(page, 'settings');
    await expect(page.locator('#setupCard')).toBeVisible();
    await openActivityView(page, 'modules');
    await expect(page.locator('#startRuntimeBtn')).toBeVisible();
    await page.locator('#curatedModelSelect').click();
    await expect(page.locator('#curatedModelSelect')).toBeFocused();
    await openActivityView(page, 'governance');
    await expect(page.locator('#permRuntimeInstall')).toBeVisible();
    await openActivityView(page, 'chat');
    await expect(page.locator('#promptInput')).toBeVisible();
    await page.fill('#promptInput', '');
    await expect(page.locator('#composerContextActionBtn')).toBeVisible();
    await expect(page.locator('#composerContextActionBtn')).toHaveText('Iniciar Runtime');
    await page.locator('#composerContextActionBtn').click();
    await expect(page.locator('#composerContextActionBtn')).toHaveText('Pronto para iniciar');
    await expect(page.locator('#composerContextActionLive')).toContainText('Foco movido para Iniciar Runtime');
    await page.locator('#promptInput').focus();
    const composerQuickChips = page.locator(
      '.composer-toolbar .btn-chip:not(#composerContextActionBtn):not([hidden])'
    );
    await expect(composerQuickChips.first()).toHaveText('/health');
    await expect(composerQuickChips.first()).toHaveAttribute('title', /runtime offline/i);

    await page.fill('#promptInput', '/he');
    await expect(page.locator('#commandSuggest')).toBeVisible();
    await expect(page.locator('#commandSuggestList')).toContainText('/help');
    await expect(page.locator('#commandSuggestList')).toContainText('/health');
    await expect(page.locator('.command-suggest-command').first()).toHaveText('/health');
    await expect(page.locator('#commandSuggestPreview')).toContainText('runtime offline');
    await page.keyboard.press('Tab');
    await expect(page.locator('#promptInput')).toHaveValue('/health');
    await expect(page.locator('#composerFeedbackLive')).toContainText('Comando /health inserido no composer');

    await page.fill('#promptInput', '/cl');
    await expect(page.locator('#commandSuggestPreview')).toContainText('Preview /clear');
    await expect(page.locator('#commandSuggestPreview')).toContainText('Reseta a conversa exibida localmente');
    await page.keyboard.press('Enter');
    await expect(page.locator('#promptInput')).toHaveValue('/clear');

    await page.locator('#modelInput').focus();
    await expect(page.locator('#modelInput')).toBeFocused();
    await page.locator('#promptInput').focus();

    await page.fill('#promptInput', 'ola dexter');
    await page.click('#sendBtn');
    await expect(page.locator('#chatHeroCard')).toHaveAttribute('data-stage', 'active');
    await expect(page.locator('#chatHeroCard .chat-hero-art')).toBeHidden();

    const lastAssistantMessage = page.locator('.message.assistant', {
      hasText: 'Resposta mock para: ola dexter'
    });
    await expect(lastAssistantMessage).toContainText('Resposta mock para: ola dexter');
    const chatLayout = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('#messagesShell');
      const messages = document.querySelector<HTMLElement>('#messages');
      if (!shell || !messages) {
        return null;
      }

      const shellRect = shell.getBoundingClientRect();
      const messagesRect = messages.getBoundingClientRect();

      return {
        shellHeight: shellRect.height,
        messagesHeight: messagesRect.height,
        overflowY: window.getComputedStyle(messages).overflowY
      };
    });
    expect(chatLayout).not.toBeNull();
    expect(chatLayout?.overflowY).toBe('auto');
    expect(chatLayout?.messagesHeight ?? 0).toBeLessThanOrEqual((chatLayout?.shellHeight ?? 0) + 1);

    await page.evaluate(() => {
      const messages = document.querySelector<HTMLElement>('#messages');
      if (!messages) {
        return;
      }
      messages.style.height = '120px';
      messages.scrollTop = 0;
      messages.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(page.locator('#chatScrollToBottomBtn')).toBeVisible();
    await page.click('#healthBtn');
    await page.evaluate(() => {
      const messages = document.querySelector<HTMLElement>('#messages');
      if (!messages) {
        return;
      }
      messages.scrollTop = 80;
      messages.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(page.locator('#chatStickyContextBar')).toBeVisible();
    await expect(page.locator('#chatStickyRuntimePill')).toContainText('runtime:');
    await expect(page.locator('.message-unread-separator')).toContainText('Novas mensagens');
    await expect(page.locator('#chatScrollToBottomCount')).toHaveText('1');
    await page.locator('#chatScrollToBottomBtn').click();
    await expect(page.locator('#chatActionLive')).toContainText('Chat rolado para o fim.');
    await expect(page.locator('.message-unread-separator')).toHaveCount(0);
    await expect
      .poll(() => page.locator('#chatScrollToBottomBtn').isHidden())
      .toBe(true);

    const useReplyBtn = lastAssistantMessage.getByRole('button', { name: 'Usar resposta no composer' });
    await expect(useReplyBtn).toBeVisible();
    await useReplyBtn.click();
    await expect(page.locator('#promptInput')).toHaveValue(/Resposta mock para: ola dexter/);
    await expect(page.locator('#composerFeedbackLive')).toContainText('Mensagem inserida no composer');

    const copyReplyBtn = lastAssistantMessage.getByRole('button', { name: 'Copiar mensagem' });
    await copyReplyBtn.click();
    await expect(page.locator('#chatActionLive')).toContainText(/Mensagem copiada|Falha ao copiar mensagem/);

    await page.fill('#promptInput', '/clear');
    await page.click('#sendBtn');
    await expect(page.locator('.message.assistant').last()).toContainText('Resposta mock para: /clear');
  } finally {
    await app.close();
  }
});

test('executa download de modelo com prompt contextual e mostra progresso', async () => {
  const { app, page } = await launchDexter();

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  try {
    await openActivityView(page, 'modules');
    await expect(page.locator('#curatedModelSelect')).toBeVisible();
    await page.selectOption('#curatedModelSelect', { index: 0 });

    await page.click('#pullModelBtn');

    await expect(page.locator('#modelProgressText')).toContainText('100%');
    await expect(page.locator('#modelProgressEta')).toContainText('concluido');
    await expect
      .poll(async () => page.locator('#modelProgressFill').evaluate((el) => (el as HTMLElement).style.width))
      .toBe('100%');
    await expect(page.locator('#installedModels')).not.toContainText('Nenhum modelo instalado.');
    await expect(page.locator('#modelHistory')).toContainText('CONCLUIDO');
  } finally {
    await app.close();
  }
});

test('persiste estado do painel de detalhes do helper entre recargas', async () => {
  const { app, page } = await launchDexter();

  try {
    await openActivityView(page, 'modules');
    const panel = page.locator('#runtimeHelperDetailsPanel');
    const summary = page.locator('#runtimeHelperDetailsPanel > summary');

    await expect(panel).toBeVisible();

    if (!(await readDetailsOpenState(page, '#runtimeHelperDetailsPanel'))) {
      await summary.click();
    }
    await expect.poll(() => readDetailsOpenState(page, '#runtimeHelperDetailsPanel')).toBe(true);

    await page.reload();
    await openActivityView(page, 'modules');
    await expect(panel).toBeVisible();
    await expect.poll(() => readDetailsOpenState(page, '#runtimeHelperDetailsPanel')).toBe(true);

    await summary.click();
    await expect.poll(() => readDetailsOpenState(page, '#runtimeHelperDetailsPanel')).toBe(false);

    await page.reload();
    await openActivityView(page, 'modules');
    await expect(panel).toBeVisible();
    await expect.poll(() => readDetailsOpenState(page, '#runtimeHelperDetailsPanel')).toBe(false);
  } finally {
    await app.close();
  }
});

test('exporta logs de UI apos reparar setup e confirma no chat', async () => {
  const { app, page } = await launchDexter();

  try {
    await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'allow');

    await openActivityView(page, 'chat');
    await page.click('#healthRepairSetupBtn');

    const repairMessage = page.locator('.message.assistant').last();
    await expect(repairMessage).toContainText('Runtime voltou a responder');
    await expect(repairMessage).toContainText('Health: alertas');

    await openActivityView(page, 'governance');
    await page.click('#exportUiAuditLogsBtn');

    await expect(page.locator('#panelActionLive')).toContainText('Logs de auditoria de UI exportados');
    const exportMessage = page.locator('.message.assistant').last();
    await expect(exportMessage).toContainText('Logs de auditoria de UI exportados: dexter-logs-');
    await expect(exportMessage).toContainText('.json');
    await expect(page.locator('#exportLogScopeSelect')).toHaveValue('ui');
    await expect(page.locator('#exportLogsPreview')).toContainText('Logs no escopo ui:');
  } finally {
    await app.close();
  }
});

test('exporta logs de UI em csv apos reparar setup', async () => {
  const { app, page } = await launchDexter();

  try {
    await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'allow');

    await openActivityView(page, 'chat');
    await page.click('#healthRepairSetupBtn');
    await expect(page.locator('.message.assistant').last()).toContainText('Health: alertas');

    await openActivityView(page, 'governance');
    await page.selectOption('#exportFormatSelect', 'csv');
    await expect(page.locator('#exportLogsPreview')).toContainText('formato: csv');

    await page.click('#exportUiAuditLogsBtn');

    await expect(page.locator('#panelActionLive')).toContainText('Logs de auditoria de UI exportados em csv');
    const exportMessage = page.locator('.message.assistant').last();
    await expect(exportMessage).toContainText('Logs de auditoria de UI exportados: dexter-logs-');
    await expect(exportMessage).toContainText('.csv');
    await expect(page.locator('#exportLogScopeSelect')).toHaveValue('ui');
    await expect(page.locator('#exportLogsPreview')).toContainText('Logs no escopo ui:');
    await expect(page.locator('#exportLogsPreview')).toContainText('formato: csv');
  } finally {
    await app.close();
  }
});

test('payload exportado de logs de UI contem ui.audit.event e setup.repair.finish', async () => {
  const { app, page } = await launchDexter();

  try {
    await installExportLogsPayloadProbe(page);
    await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'allow');

    await openActivityView(page, 'chat');
    await page.click('#healthRepairSetupBtn');
    await expect(page.locator('.message.assistant').last()).toContainText('Health: alertas');

    await openActivityView(page, 'governance');
    await page.click('#exportUiAuditLogsBtn');
    await expect(page.locator('#panelActionLive')).toContainText('Logs de auditoria de UI exportados');

    await expect
      .poll(async () => await readExportLogsPayloadProbe(page), { timeout: 3000 })
      .not.toBeNull();
    const captured = await readExportLogsPayloadProbe(page);
    expect(captured?.fileName).toMatch(/^dexter-logs-.*\.json$/);
    expect(captured?.mimeType).toContain('json');

    const parsed = JSON.parse(captured?.content ?? '[]') as Array<{
      message?: string;
      meta?: { event?: string; payload?: unknown };
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((entry) => entry.message === 'ui.audit.event')).toBe(true);
    expect(parsed.some((entry) => entry.meta?.event === 'setup.repair.finish')).toBe(true);
  } finally {
    await app.close();
  }
});

test('payload csv exportado de logs de UI contem ui.audit.event e setup.repair.finish', async () => {
  const { app, page } = await launchDexter();

  try {
    await installExportLogsPayloadProbe(page);
    await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'allow');

    await openActivityView(page, 'chat');
    await page.click('#healthRepairSetupBtn');
    await expect(page.locator('.message.assistant').last()).toContainText('Health: alertas');

    await openActivityView(page, 'governance');
    await page.selectOption('#exportFormatSelect', 'csv');
    await page.click('#exportUiAuditLogsBtn');
    await expect(page.locator('#panelActionLive')).toContainText('Logs de auditoria de UI exportados em csv');

    await expect
      .poll(async () => await readExportLogsPayloadProbe(page), { timeout: 3000 })
      .not.toBeNull();
    const captured = await readExportLogsPayloadProbe(page);
    expect(captured?.fileName).toMatch(/^dexter-logs-.*\.csv$/);
    expect(captured?.mimeType).toContain('csv');

    const rows = parseCsvRows(captured?.content ?? '');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.message === 'ui.audit.event')).toBe(true);
    expect(rows.some((row) => (row.meta ?? '').includes('setup.repair.finish'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('mostra diagnostico estruturado quando instalacao de runtime exige fluxo assistido', async () => {
  const { app, page } = await launchDexter({
    DEXTER_MOCK_RUNTIME_INSTALL_MODE: 'manual-required'
  });

  try {
    await setPermissionMode(page, '#permRuntimeInstall', 'runtime.install', 'allow');
    await openActivityView(page, 'modules');
    await page.click('#installRuntimeBtn');

    const lastAssistantMessage = page.locator('.message.assistant').last();
    await expect(lastAssistantMessage).toContainText(
      'Instalacao automatica do runtime nao foi concluida neste ambiente.'
    );
    await expect(lastAssistantMessage).toContainText('Codigo: privilege_required.');
    await expect(lastAssistantMessage).toContainText('Estrategia: linux/assistido.');
    await expect(lastAssistantMessage).toContainText('Comando: curl -fsSL https://ollama.com/install.sh | sh.');
    await expect(lastAssistantMessage).toContainText('Proximos passos:');
    await expect(page.locator('#runtimeSummary')).toContainText('Runtime offline.');
  } finally {
    await app.close();
  }
});

test('onboarding mostra badge Assistido quando privilegio operacional exige terminal', async () => {
  const { app, page } = await launchDexter({
    DEXTER_MOCK_RUNTIME_PRIVILEGE_MODE: 'sudo-terminal'
  });

  try {
    await completeMockSetupToHealthy(page);
    await openActivityView(page, 'settings');
    await expect(page.locator('#setupBadge')).toHaveText('Assistido');
    await expect(page.locator('#setupSummary')).toContainText('modo assistido');
    await expect(page.locator('#setupPrivilegeNote')).toContainText('terminal interativo');
  } finally {
    await app.close();
  }
});

test('onboarding mostra badge Limitado quando nao ha caminho de privilegio operacional', async () => {
  const { app, page } = await launchDexter({
    DEXTER_MOCK_RUNTIME_PRIVILEGE_MODE: 'none'
  });

  try {
    await completeMockSetupToHealthy(page);
    await openActivityView(page, 'settings');
    await expect(page.locator('#setupBadge')).toHaveText('Limitado');
    await expect(page.locator('#setupSummary')).toContainText('Agent Mode Linux esta bloqueado');
    await expect(page.locator('#setupPrivilegeNote')).toContainText('Sem privilegio operacional');
  } finally {
    await app.close();
  }
});

test('mostra bloqueio de permissao antes de baixar modelo', async () => {
  const { app, page } = await launchDexter();

  try {
    await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'deny');
    await openActivityView(page, 'modules');
    await page.click('#pullModelBtn');

    const lastAssistantMessage = page.locator('.message.assistant').last();
    await expect(lastAssistantMessage).toContainText('Bloqueado por politica: tools.system.exec.');
    await expect(page.locator('#modelProgressText')).toContainText('Sem operacao em andamento.');
  } finally {
    await app.close();
  }
});

test('mostra diagnostico estruturado em falhas simuladas de pull/remove de modelo', async () => {
  const { app, page } = await launchDexter();

  try {
    await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'allow');
    await openActivityView(page, 'modules');

    await useCustomModelInput(page, 'model-fail:1');
    await page.click('#pullModelBtn');

    let lastAssistantMessage = page.locator('.message.assistant').last();
    await expect(lastAssistantMessage).toContainText('Nao foi possivel baixar model-fail:1.');
    await expect(lastAssistantMessage).toContainText('Codigo: command_failed.');
    await expect(lastAssistantMessage).toContainText('Estrategia: ollama/cli local.');
    await expect(lastAssistantMessage).toContainText('Proximos passos:');

    await useCustomModelInput(page, 'remove-error:1');
    await page.click('#removeModelBtn');

    lastAssistantMessage = page.locator('.message.assistant').last();
    await expect(lastAssistantMessage).toContainText('Nao foi possivel remover remove-error:1.');
    await expect(lastAssistantMessage).toContainText('Codigo: command_failed.');
    await expect(lastAssistantMessage).toContainText('Estrategia: ollama/cli local.');
    await expect(lastAssistantMessage).toContainText('Proximos passos:');
  } finally {
    await app.close();
  }
});

test('verifica e baixa update no painel de updates em modo mock', async () => {
  const { app, page } = await launchDexter();

  try {
    await openActivityView(page, 'governance');
    const checkBtn = page.locator('#updateCheckBtn');
    const downloadBtn = page.locator('#updateDownloadBtn');
    const restartBtn = page.locator('#updateRestartBtn');
    const summary = page.locator('#updateSummary');

    await checkBtn.scrollIntoViewIfNeeded();
    await expect(checkBtn).toBeVisible();
    await checkBtn.click();

    await expect(summary).toContainText('disponivel');
    await expect(page.locator('#panelActionLive')).toContainText('Update disponivel');
    await expect(page.locator('#updateAvailableVersion')).toContainText('0.1.4');
    await expect(downloadBtn).toBeEnabled();

    await downloadBtn.click();

    await expect(summary).toContainText('staged');
    await expect(page.locator('#panelActionLive')).toContainText(/staged|Instalador pronto/);
    await expect(page.locator('#updateNotes')).toContainText('Mock update');
    await expect(restartBtn).toBeEnabled();
    await expect(page.locator('#composerContextActionBtn')).toBeVisible();
    await expect(page.locator('#composerContextActionBtn')).toHaveText(/Aplicar Update|Abrir Instalador/);
    await page.locator('#composerContextActionBtn').click();
    await expect(page.locator('#composerContextActionBtn')).toHaveText('Pronto para aplicar');
    await expect(page.locator('#composerContextActionLive')).toContainText(/Foco movido para (Aplicar Update|Abrir Instalador)/);

    await restartBtn.click();
    await expect(page.locator('.message.assistant').last()).toContainText('Reinicio solicitado');
  } finally {
    await app.close();
  }
});

test('mostra bloqueio de update por schema/migracao com codigo estruturado no painel', async () => {
  const { app, page } = await launchDexter({
    DEXTER_MOCK_UPDATE_MODE: 'blocked-schema'
  });

  try {
    await openActivityView(page, 'governance');
    const checkBtn = page.locator('#updateCheckBtn');
    const downloadBtn = page.locator('#updateDownloadBtn');
    const summary = page.locator('#updateSummary');
    const notes = page.locator('#updateNotes');
    const compatibility = page.locator('#updateCompatibility');

    await checkBtn.scrollIntoViewIfNeeded();
    await checkBtn.click();

    await expect(summary).toContainText('bloqueado');
    await expect(summary).toHaveAttribute('data-error-kind', 'compatibility');
    await expect(compatibility).toContainText('bloqueio local: sim');
    await expect(notes).toContainText('schema_migration_unavailable');
    await expect(notes).toContainText('migracao de schema indisponivel');
    await expect(downloadBtn).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('persiste seletor de escopo de logs de auditoria na UI', async () => {
  const { app, page } = await launchDexter();

  try {
    await openActivityView(page, 'governance');
    const scopeSelect = page.locator('#exportLogScopeSelect');
    const updateAuditFamilySelect = page.locator('#exportUpdateAuditFamilySelect');
    const updateAuditSeveritySelect = page.locator('#exportUpdateAuditSeveritySelect');
    const updateAuditWindowSelect = page.locator('#exportUpdateAuditWindowSelect');
    const updateAuditCodeOnly = page.locator('#exportUpdateAuditCodeOnly');
    const preview = page.locator('#exportLogsPreview');
    const updateAuditPreview = page.locator('#exportUpdateAuditPreview');
    await expect(scopeSelect).toBeVisible();
    await expect(updateAuditFamilySelect).toBeVisible();
    await expect(updateAuditSeveritySelect).toBeVisible();
    await expect(updateAuditWindowSelect).toBeVisible();
    await expect(updateAuditCodeOnly).toBeVisible();
    await expect(updateAuditPreview).toBeVisible();

    await scopeSelect.selectOption('updates');
    await updateAuditFamilySelect.selectOption('migration');
    await updateAuditSeveritySelect.selectOption('warn-error');
    await updateAuditWindowSelect.selectOption('24h');
    await updateAuditCodeOnly.check();
    await expect(updateAuditFamilySelect).toHaveValue('migration');
    await expect(updateAuditSeveritySelect).toHaveValue('warn-error');
    await expect(updateAuditWindowSelect).toHaveValue('24h');
    await expect(updateAuditCodeOnly).toBeChecked();
    await expect(preview).toContainText('Logs no escopo updates:');
    await expect(preview).toContainText('formato: json');
    await expect(preview).toContainText('estimativa: json');
    await expect(preview).toContainText('| csv ');
    await expect(preview).toContainText('periodo: aberto');
    await expect(updateAuditPreview).toContainText('Auditoria Update (migration, warn-error, codeOnly=on):');
    await expect(updateAuditPreview).toContainText('formato: json');
    await expect(updateAuditPreview).toContainText('estimativa: json');
    await expect(updateAuditPreview).toContainText('periodo: ultimas 24h');
    await page.locator('#exportUpdateLogsBtn').click();
    await expect(page.locator('#panelActionLive')).toContainText('Logs de update exportados');
    await page.reload();
    await openActivityView(page, 'governance');

    await expect(page.locator('#exportLogScopeSelect')).toHaveValue('updates');
    await expect(page.locator('#exportUpdateAuditFamilySelect')).toHaveValue('migration');
    await expect(page.locator('#exportUpdateAuditSeveritySelect')).toHaveValue('warn-error');
    await expect(page.locator('#exportUpdateAuditWindowSelect')).toHaveValue('24h');
    await expect(page.locator('#exportUpdateAuditCodeOnly')).toBeChecked();
    await expect(page.locator('#exportLogsPreview')).toContainText('Logs no escopo updates:');
    await expect(page.locator('#exportLogsPreview')).toContainText('formato: json');
    await expect(page.locator('#exportLogsPreview')).toContainText('estimativa: json');
    await expect(page.locator('#exportLogsPreview')).toContainText('periodo: aberto');
    await expect(page.locator('#exportUpdateAuditPreview')).toContainText(
      'Auditoria Update (migration, warn-error, codeOnly=on):'
    );
    await expect(page.locator('#exportUpdateAuditPreview')).toContainText('periodo: ultimas 24h');
  } finally {
    await app.close();
  }
});

test('executa uninstall assistido no painel de governanca com token de confirmacao', async () => {
  const { app, page } = await launchDexter();

  try {
    await openActivityView(page, 'governance');
    const uninstallBtn = page.locator('#uninstallRunBtn');
    const tokenInput = page.locator('#uninstallConfirmToken');
    const summary = page.locator('#uninstallSummary');

    await expect(uninstallBtn).toBeDisabled();
    await tokenInput.fill('token-invalido');
    await expect(uninstallBtn).toBeDisabled();

    await tokenInput.fill('UNINSTALL DEXTER');
    await expect(uninstallBtn).toBeEnabled();
    await expect(summary).toContainText('Pacote: remove.');

    await page.locator('#uninstallPackageMode').selectOption('purge');
    await page.locator('#uninstallRemoveUserData').check();
    await page.locator('#uninstallRemoveRuntimeSystem').check();
    await page.locator('#uninstallRemoveRuntimeUserData').check();

    await expect(summary).toContainText('Pacote: purge.');
    await expect(summary).toContainText('Dados Dexter: sim.');
    await expect(summary).toContainText('Runtime sistema: sim.');
    await expect(summary).toContainText('Dados Ollama: sim.');

    await setPermissionMode(page, '#permSystemExec', 'tools.system.exec', 'allow');
    await uninstallBtn.click();

    await expect(page.locator('.message.assistant').last()).toContainText('Uninstall concluido com sucesso pelo assistente.');
    await expect(summary).toContainText('Estrategia:');
  } finally {
    await app.close();
  }
});
