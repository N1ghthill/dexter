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
import { LinuxDebUpdateApplier } from '@main/services/update/LinuxDebUpdateApplier';
import { NoopUpdateProvider } from '@main/services/update/NoopUpdateProvider';
import { UpdateMigrationPlanner } from '@main/services/update/UpdateMigrationPlanner';
import { UpdatePolicyStore } from '@main/services/update/UpdatePolicyStore';
import { UpdateService } from '@main/services/update/UpdateService';
import { UpdateApplyAttemptStore } from '@main/services/update/UpdateApplyAttemptStore';
import { UpdatePostApplyCoordinator } from '@main/services/update/UpdatePostApplyCoordinator';
import { UpdateStateStore } from '@main/services/update/UpdateStateStore';
import { UpdateStartupReconciler } from '@main/services/update/UpdateStartupReconciler';
import { UserDataMigrationRunner } from '@main/services/update/UserDataMigrationRunner';
import { UserDataSchemaStateStore } from '@main/services/update/UserDataSchemaStateStore';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;
let appLoggerRef: Logger | null = null;
let updatePostApplyCoordinatorRef: UpdatePostApplyCoordinator | null = null;
const USER_DATA_SCHEMA_VERSION = 1;
const LINUX_RUNTIME_HELPER_RESOURCE_RELATIVE = path.join('helpers', 'linux', 'dexter-runtime-helper.sh');
const LEGACY_LINUX_RUNTIME_HELPER_RESOURCE_RELATIVE = path.join(
  'app.asar.unpacked',
  'assets',
  'helpers',
  'linux',
  'dexter-runtime-helper.sh'
);

function resolveBundledAssetPath(...segments: string[]): string {
  if (app.isPackaged) {
    const extraResourceCandidate = path.join(process.resourcesPath, 'assets', ...segments);
    if (fs.existsSync(extraResourceCandidate)) {
      return extraResourceCandidate;
    }
  }

  return path.join(app.getAppPath(), 'assets', ...segments);
}

function resolveLinuxPrivilegedHelperPath(): string | null {
  if (process.platform !== 'linux' || !app.isPackaged) {
    return null;
  }

  const preferred = path.join(process.resourcesPath, LINUX_RUNTIME_HELPER_RESOURCE_RELATIVE);
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  const legacyUnpacked = path.join(process.resourcesPath, LEGACY_LINUX_RUNTIME_HELPER_RESOURCE_RELATIVE);
  if (fs.existsSync(legacyUnpacked)) {
    return legacyUnpacked;
  }

  return preferred;
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  const debugLogMirrorPath = resolveDebugLogMirrorPath();
  const logger = new Logger(userData, {
    mirrorFilePath: debugLogMirrorPath
  });
  appLoggerRef = logger;
  const linuxPrivilegedHelperPath = resolveLinuxPrivilegedHelperPath();
  const updateStateStore = new UpdateStateStore(userData);
  const updateApplyAttemptStore = new UpdateApplyAttemptStore(userData);
  const postApplyCoordinator = new UpdatePostApplyCoordinator({
    userDataDir: userData,
    currentAppVersion: app.getVersion(),
    logger,
    attemptStore: updateApplyAttemptStore,
    autoDebRollbackOnBootFailure: readBooleanFlag('DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE'),
    requireBootHealthyHandshake: readBooleanFlag('DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE'),
    bootHealthyGraceMs: readPositiveIntEnv('DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS'),
    bootHealthyStabilityMs: readNonNegativeIntEnv('DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS')
  });
  updatePostApplyCoordinatorRef = postApplyCoordinator;
  const migrationPlanner = new UpdateMigrationPlanner();
  const schemaStateStore = new UserDataSchemaStateStore(userData);
  const migrationRunner = new UserDataMigrationRunner(userData, schemaStateStore, migrationPlanner, logger);
  const migrationResult = migrationRunner.ensureCurrent(USER_DATA_SCHEMA_VERSION);
  if (!migrationResult.ok) {
    logger.error('app.bootstrap.migration_failed', migrationResult);
    postApplyCoordinator.handleBootFailure(migrationResult.message);
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
  const runtimeService = new RuntimeService(configStore, logger, process.platform, {
    linuxPrivilegedHelperPath
  });
  const updatePolicyStore = new UpdatePolicyStore(userData);
  new UpdateStartupReconciler({
    userDataDir: userData,
    currentAppVersion: app.getVersion(),
    stateStore: updateStateStore,
    logger
  }).reconcile();
  const updateProvider = createUpdateProvider(userData, logger);
  const updateApplier = createUpdateApplier(logger);
  const updateService = new UpdateService(updatePolicyStore, updateStateStore, updateProvider, logger, {
    appVersion: app.getVersion(),
    coreVersion: app.getVersion(),
    uiVersion: app.getVersion(),
    ipcContractVersion: 1,
    userDataSchemaVersion: USER_DATA_SCHEMA_VERSION
  }, (state) => {
    const result = updateApplier.requestRestartToApply(state);
    postApplyCoordinator.recordApplyAttempt(state, result);
    return result;
  }, migrationPlanner);
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
    getWindow: () => mainWindow,
    reportBootHealthy: () => postApplyCoordinator.markBootHealthy('renderer')
  });

  createWindow(logger, postApplyCoordinator);
  createTray();

  logger.info('app.bootstrap', {
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    linuxPrivilegedHelperPath,
    debugLogMirrorPath,
    userData,
    userDataSchemaVersion: USER_DATA_SCHEMA_VERSION
  });
  postApplyCoordinator.reconcileStartupSuccess();
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

  const debAssist = new LinuxDebUpdateApplier({
    logger,
    strategy: readDebApplyStrategy(logger)
  });

  return new CompositeUpdateApplier([appImage, debAssist, fallback]);
}

function readDebApplyStrategy(logger: Logger): 'assist' | 'pkexec-apt' {
  const raw = process.env.DEXTER_UPDATE_DEB_APPLY_STRATEGY?.trim().toLowerCase();
  if (!raw || raw === 'assist') {
    return 'assist';
  }
  if (raw === 'pkexec-apt') {
    logger.info('update.applier.deb.strategy', {
      strategy: 'pkexec-apt'
    });
    return 'pkexec-apt';
  }

  logger.warn('update.applier.deb.strategy.invalid', {
    value: raw,
    fallback: 'assist'
  });
  return 'assist';
}

function createWindow(logger: Logger, postApplyCoordinator: UpdatePostApplyCoordinator): void {
  const windowIconPath = resolveBundledAssetPath('icons', 'linux', 'window.png');
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 840,
    minWidth: 390,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#060b12',
    autoHideMenuBar: true,
    icon: fs.existsSync(windowIconPath) ? windowIconPath : undefined,
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

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const reason = typeof details?.reason === 'string' ? details.reason : 'unknown';
    const exitCode = typeof details?.exitCode === 'number' ? details.exitCode : null;
    logger.error('app.renderer.process_gone', {
      reason,
      exitCode
    });
    postApplyCoordinator.handleBootFailure(`renderer process gone: ${reason}${exitCode !== null ? ` (exit ${exitCode})` : ''}`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    logger.error('app.renderer.did_fail_load', {
      errorCode,
      errorDescription,
      validatedURL
    });
    postApplyCoordinator.handleBootFailure(`renderer did-fail-load: ${errorCode} ${errorDescription}`);
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

function readBooleanFlag(envName: string): boolean {
  const raw = process.env[envName]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveDebugLogMirrorPath(): string | null {
  const explicitPath = process.env.DEXTER_DEBUG_LOG_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  if (app.isPackaged && readBooleanFlag('DEXTER_LOG_MIRROR_TMP')) {
    return '/tmp/dexter.log';
  }

  return null;
}

function readPositiveIntEnv(envName: string): number | undefined {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function readNonNegativeIntEnv(envName: string): number | undefined {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function createTrayIcon(status: 'idle' | 'busy' | 'warn') {
  const iconSize =
    process.platform === 'darwin'
      ? { width: 18, height: 18 }
      : process.platform === 'linux'
        ? { width: 22, height: 22 }
        : { width: 20, height: 20 };

  const trayAssetByStatus: Record<'idle' | 'busy' | 'warn', string> = {
    idle: 'tray-idle.svg',
    busy: 'tray-busy.svg',
    warn: 'tray-warn.svg'
  };
  const candidates = [
    resolveBundledAssetPath('icons', trayAssetByStatus[status]),
    resolveBundledAssetPath('icons', 'linux', '32x32.png'),
    resolveBundledAssetPath('icons', 'linux', '24x24.png'),
    resolveBundledAssetPath('icons', 'linux', '16x16.png')
  ];

  for (const candidatePath of candidates) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    const image = nativeImage.createFromPath(candidatePath);
    if (!image.isEmpty()) {
      return image.resize(iconSize);
    }
  }

  const palette = {
    idle: '#35c3ff',
    busy: '#4ce3bf',
    warn: '#ffbe55'
  } as const;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="#0a1729" />
      <rect x="6" y="6" width="52" height="52" rx="14" fill="none" stroke="#d7eeff" stroke-width="2" opacity="0.45" />
      <circle cx="32" cy="32" r="12" fill="${palette[status]}" />
      <circle cx="32" cy="32" r="5" fill="#05111f" />
    </svg>
  `;

  const fallback = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  if (!fallback.isEmpty()) {
    return fallback.resize(iconSize);
  }

  return nativeImage.createEmpty();
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
    if (appLoggerRef && updatePostApplyCoordinatorRef) {
      createWindow(appLoggerRef, updatePostApplyCoordinatorRef);
    }
    return;
  }

  mainWindow.show();
});
