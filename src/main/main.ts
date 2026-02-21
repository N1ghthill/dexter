import path from 'node:path';
import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { registerIpc } from '@main/ipc/registerIpc';
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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  const logger = new Logger(userData);
  const memoryStore = new MemoryStore(userData);
  const configStore = new ConfigStore(userData);
  const permissionService = new PermissionService(userData);
  const healthService = new HealthService(configStore, memoryStore, logger);
  const modelHistoryService = new ModelHistoryService(userData);
  const commandRouter = new CommandRouter(configStore, memoryStore, healthService, modelHistoryService);
  const llmProvider = new OllamaProvider();
  const runtimeService = new RuntimeService(configStore, logger);
  const modelService = new ModelService(configStore, logger);
  const auditExportService = new AuditExportService(modelHistoryService, logger);
  const brain = new DexterBrain(commandRouter, configStore, memoryStore, llmProvider, logger);

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
    logger,
    getWindow: () => mainWindow
  });

  createWindow();
  createTray();

  logger.info('app.bootstrap', {
    appPath: app.getAppPath(),
    userData
  });
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
