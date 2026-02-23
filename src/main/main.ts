import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { registerIpc } from '@main/ipc/registerIpc';
import { ConversationContextBuilder } from '@main/services/agent/ConversationContextBuilder';
import { DexterBrain } from '@main/services/agent/DexterBrain';
import { AuditExportService } from '@main/services/audit/AuditExportService';
import { CommandRouter } from '@main/services/commands/CommandRouter';
import { ConfigStore } from '@main/services/config/ConfigStore';
import { HealthService } from '@main/services/health/HealthService';
import { OllamaProvider } from '@main/services/llm/OllamaProvider';
import { Logger } from '@main/services/logging/Logger';
import { MemoryStore } from '@main/services/memory/MemoryStore';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';
import { ModelService } from '@main/services/models/ModelService';
import { PermissionService } from '@main/services/permissions/PermissionService';
import { RuntimeService } from '@main/services/runtime/RuntimeService';
import { CompositeUpdateApplier } from '@main/services/update/CompositeUpdateApplier';
import { ElectronRelaunchUpdateApplier } from '@main/services/update/ElectronRelaunchUpdateApplier';
import { GitHubReleaseUpdateProvider } from '@main/services/update/GitHubReleaseUpdateProvider';
import { LinuxAppImageUpdateApplier } from '@main/services/update/LinuxAppImageUpdateApplier';
import { NoopUpdateProvider } from '@main/services/update/NoopUpdateProvider';
import { UpdateMigrationPlanner } from '@main/services/update/UpdateMigrationPlanner';
import { UpdatePolicyStore } from '@main/services/update/UpdatePolicyStore';
import { UpdateService } from '@main/services/update/UpdateService';
import { UpdateStateStore } from '@main/services/update/UpdateStateStore';
import { UserDataMigrationRunner } from '@main/services/update/UserDataMigrationRunner';
import { UserDataSchemaStateStore } from '@main/services/update/UserDataSchemaStateStore';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;
const USER_DATA_SCHEMA_VERSION = 1;

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  const logger = new Logger(userData);
  const migrationPlanner = new UpdateMigrationPlanner();
  const schemaStateStore = new UserDataSchemaStateStore(userData);
  const migrationRunner = new UserDataMigrationRunner(userData, schemaStateStore, migrationPlanner, logger);
  const migrationResult = migrationRunner.ensureCurrent(USER_DATA_SCHEMA_VERSION);
  if (!migrationResult.ok) {
    logger.error('app.bootstrap.migration_failed', migrationResult);
    throw new Error(migrationResult.message);
  }

  const memoryStore = new MemoryStore(userData);
  const configStore = new ConfigStore(userData);
  const permissionService = new PermissionService(userData);
  const healthService = new HealthService(configStore, memoryStore, logger);
  const modelHistoryService = new ModelHistoryService(userData);
  const commandRouter = new CommandRouter(configStore, memoryStore, healthService, modelHistoryService);
  const contextBuilder = new ConversationContextBuilder(memoryStore, modelHistoryService, undefined, () => configStore.get());
  const llmProvider = new OllamaProvider();
  const runtimeService = new RuntimeService(configStore, logger);
  const updatePolicyStore = new UpdatePolicyStore(userData);
  const updateStateStore = new UpdateStateStore(userData);
  const updateProvider = createUpdateProvider(userData, logger);
  const updateApplier = createUpdateApplier(logger);
  const updateService = new UpdateService(updatePolicyStore, updateStateStore, updateProvider, logger, {
    appVersion: app.getVersion(),
    coreVersion: app.getVersion(),
    uiVersion: app.getVersion(),
    ipcContractVersion: 1,
    userDataSchemaVersion: USER_DATA_SCHEMA_VERSION
  }, (state) => updateApplier.requestRestartToApply(state), migrationPlanner);
  const modelService = new ModelService(configStore, logger);
  const auditExportService = new AuditExportService(modelHistoryService, logger);
  const brain = new DexterBrain(commandRouter, configStore, memoryStore, contextBuilder, llmProvider, logger);

  registerIpc({
    brain,
    healthService,
    configStore,
    memoryStore,
    modelService,
    modelHistoryService,
    auditExportService,
    permissionService,
    runtimeService,
    updateService,
    logger,
    getWindow: () => mainWindow
  });

  createWindow();
  createTray();

  logger.info('app.bootstrap', {
    appPath: app.getAppPath(),
    userData,
    userDataSchemaVersion: USER_DATA_SCHEMA_VERSION
  });
}

function createUpdateProvider(userData: string, logger: Logger) {
  const mode = process.env.DEXTER_UPDATE_PROVIDER?.trim().toLowerCase() ?? 'none';
  if (mode !== 'github') {
    if (mode && mode !== 'none') {
      logger.warn('update.provider.unsupported', {
        mode
      });
    }
    return new NoopUpdateProvider();
  }

  const repoSpec = process.env.DEXTER_UPDATE_GITHUB_REPO?.trim();
  const [owner, repo] = repoSpec ? repoSpec.split('/') : [];
  if (!owner || !repo) {
    logger.warn('update.provider.github.misconfigured', {
      repo: repoSpec ?? null
    });
    return new NoopUpdateProvider();
  }

  logger.info('update.provider.github.enabled', {
    owner,
    repo
  });

  const manifestPublicKeyPem = readPemFromEnv('DEXTER_UPDATE_MANIFEST_PUBLIC_KEY');
  if (manifestPublicKeyPem) {
    logger.info('update.provider.github.manifest_signature_verification.enabled', {
      asset: 'dexter-update-manifest.json.sig'
    });
  } else {
    logger.warn('update.provider.github.manifest_signature_verification.disabled', {
      reason: 'public key ausente',
      envPem: 'DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PEM',
      envPath: 'DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH'
    });
  }

  return new GitHubReleaseUpdateProvider({
    owner,
    repo,
    downloadDir: path.join(userData, 'updates', 'downloads'),
    manifestPublicKeyPem
  });
}

function createUpdateApplier(logger: Logger) {
  const fallback = new ElectronRelaunchUpdateApplier({
    logger,
    relaunch: () => {
      try {
        isQuiting = true;
        logger.info('app.relaunch', {
          reason: 'update-apply'
        });
        app.relaunch();
        app.exit(0);
      } catch (error) {
        logger.error('app.relaunch.error', {
          reason: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  });

  const appImage = new LinuxAppImageUpdateApplier({
    logger,
    exitCurrentApp: () => {
      isQuiting = true;
      app.exit(0);
    }
  });

  return new CompositeUpdateApplier([appImage, fallback]);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 840,
    minWidth: 360,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#060b12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuiting && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const icon = createTrayIcon('idle');
  tray = new Tray(icon);
  tray.setToolTip('Dexter - Assistente Local');

  tray.on('click', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }

    mainWindow.show();
    mainWindow.focus();
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir Dexter',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: 'Minimizar',
      click: () => mainWindow?.hide()
    },
    {
      type: 'separator'
    },
    {
      label: 'Sair',
      click: () => {
        isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

function readPemFromEnv(prefix: string): string | undefined {
  const direct = process.env[`${prefix}_PEM`];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.replace(/\\n/g, '\n').trim();
  }

  const pemPath = process.env[`${prefix}_PATH`];
  if (typeof pemPath === 'string' && pemPath.trim()) {
    try {
      return fs.readFileSync(pemPath.trim(), 'utf8').trim();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function createTrayIcon(status: 'idle' | 'busy' | 'warn') {
  const palette = {
    idle: '#35c3ff',
    busy: '#4ce3bf',
    warn: '#ffbe55'
  } as const;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f223a"/>
          <stop offset="100%" stop-color="#0a1627"/>
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#g)" />
      <circle cx="32" cy="32" r="12" fill="${palette[status]}" />
      <circle cx="32" cy="32" r="5" fill="#05111f" />
    </svg>
  `;

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuiting = true;
});

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
    return;
  }

  mainWindow.show();
});
