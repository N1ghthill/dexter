import path from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';

const shouldRunVisual = !process.env.CI || process.env.CI_VISUAL_BASELINE === '1';
test.skip(!shouldRunVisual, 'Snapshots visuais desativados no CI padrao.');

type WindowSize = {
  width: number;
  height: number;
};

async function launchDexter(): Promise<{
  app: ElectronApplication;
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>;
}> {
  const repoRoot = path.resolve(__dirname, '../..');
  const electronArgs = [repoRoot];

  if (process.env.CI) {
    electronArgs.push('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage');
  }

  const app = await electron.launch({
    args: electronArgs,
    env: {
      ...process.env,
      DEXTER_MOCK_API: '1'
    }
  });

  const page = await app.firstWindow();
  return { app, page };
}

async function setWindowContentSize(app: ElectronApplication, size: WindowSize): Promise<void> {
  await app.evaluate(
    async ({ BrowserWindow }, targetSize) => {
      const [win] = BrowserWindow.getAllWindows();
      if (!win) {
        return;
      }

      win.setResizable(true);
      win.setContentSize(targetSize.width, targetSize.height);
    },
    size
  );
}

async function ensureViewportSize(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  size: WindowSize
): Promise<void> {
  await page.setViewportSize({
    width: size.width,
    height: size.height
  });
}

function visualMask(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  return [
    page.locator('.message-time'),
    page.locator('#statusChip'),
    page.locator('#historyPageInfo'),
    page.locator('#historyDetailMeta'),
    page.locator('#modelProgressEta')
  ];
}

const visualTolerance = {
  maxDiffPixelRatio: 0.05
} as const;

test('mantem baseline visual premium da interface principal', async () => {
  const { app, page } = await launchDexter();

  try {
    await setWindowContentSize(app, { width: 1440, height: 900 });
    await ensureViewportSize(page, { width: 1440, height: 900 });
    await expect(page.getByRole('heading', { name: 'Dexter' })).toBeVisible();
    await expect(page.locator('.app-shell')).toBeVisible();

    await expect(page).toHaveScreenshot('dexter-shell-premium.png', {
      animations: 'disabled',
      caret: 'hide',
      ...visualTolerance,
      mask: visualMask(page)
    });
  } finally {
    await app.close();
  }
});

test('mantem baseline visual premium no mobile', async () => {
  const { app, page } = await launchDexter();

  try {
    await setWindowContentSize(app, { width: 390, height: 844 });
    await ensureViewportSize(page, { width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Dexter' })).toBeVisible();
    await expect(page.locator('.app-shell')).toBeVisible();

    await expect(page).toHaveScreenshot('dexter-shell-premium-mobile.png', {
      animations: 'disabled',
      caret: 'hide',
      ...visualTolerance,
      mask: visualMask(page)
    });
  } finally {
    await app.close();
  }
});
