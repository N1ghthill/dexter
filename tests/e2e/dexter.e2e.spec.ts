import path from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';

async function launchDexter(
  envOverrides: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Awaited<ReturnType<ElectronApplication['firstWindow']>> }> {
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

    await expect(page.locator('.message-session-separator').first()).toContainText('Sessao 1 iniciada as');
    await expect(page.locator('#composerContextActionBtn')).toBeVisible();
    await expect(page.locator('#composerContextActionBtn')).toHaveText('Iniciar Runtime');
    await page.locator('#composerContextActionBtn').click();
    await expect(page.locator('#composerContextActionBtn')).toHaveText('Pronto para iniciar');
    await expect(page.locator('#composerContextActionLive')).toContainText('Foco movido para Iniciar Runtime');
    await expect(page.locator('#startRuntimeBtn')).toBeFocused();
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

    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, bubbles: true }));
    });
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

    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
    });
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

test('verifica e baixa update no painel de updates em modo mock', async () => {
  const { app, page } = await launchDexter();

  try {
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
    await expect(restartBtn).toBeFocused();

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
