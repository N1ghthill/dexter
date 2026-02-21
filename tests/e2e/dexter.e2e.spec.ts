import path from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';

async function launchDexter(): Promise<{ app: ElectronApplication; page: Awaited<ReturnType<ElectronApplication['firstWindow']>> }> {
  const repoRoot = path.resolve(__dirname, '../..');

  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      DEXTER_MOCK_API: '1'
    }
  });

  const page = await app.firstWindow();
  return { app, page };
}

test('carrega interface principal e responde chat em modo mock', async () => {
  const { app, page } = await launchDexter();

  try {
    await expect(page.getByRole('heading', { name: 'Dexter' })).toBeVisible();

    await page.fill('#promptInput', 'ola dexter');
    await page.click('#sendBtn');

    await expect(page.locator('.message.assistant').last()).toContainText('Resposta mock para: ola dexter');
  } finally {
    await app.close();
  }
});

test('executa download de modelo com prompt contextual e mostra progresso', async () => {
  const { app, page } = await launchDexter();

  let dialogSeen = false;
  page.on('dialog', async (dialog) => {
    dialogSeen = true;
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
    expect(dialogSeen).toBeTruthy();
  } finally {
    await app.close();
  }
});
