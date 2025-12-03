/**
 * ChopChop Main Process
 *
 * Manages the Electron application lifecycle and window creation.
 * IPC handlers are delegated to separate modules following Single Responsibility Principle.
 */

import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import {
  registerFFmpegHandlers,
  registerMediaHandlers,
  registerFileHandlers,
  registerProjectHandlers,
  registerExportHandlers,
  registerSettingsHandlers,
  registerAppHandlers,
  registerPreviewHandlers,
  loadSettings,
  updateRecentProjectMenu,
  getForceQuit,
  disposePreviewEngine,
  type IpcContext,
} from './ipc';

// Built directory structure
process.env.DIST = path.join(__dirname, '../dist');

let mainWindow: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// Shared context for IPC handlers
const ipcContext: IpcContext = {
  get mainWindow() { return mainWindow; }
};

/**
 * Creates the main application window
 */
function createWindow(): void {
  process.env.VITE_PUBLIC = app.isPackaged
    ? process.env.DIST
    : path.join(process.env.DIST!, '../public');

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    title: 'ChopChop',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  mainWindow.on('close', async (e) => {
    if (getForceQuit()) return;
    e.preventDefault();
    mainWindow?.webContents.send('app:checkUnsavedChanges');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Creates the application menu
 */
function createAppMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:newProject') },
        { type: 'separator' },
        { label: 'Open Project...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:openProject') },
        { label: 'Open Recent', id: 'recent-project', enabled: false, click: () => mainWindow?.webContents.send('menu:openRecent') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:saveAs') },
        { type: 'separator' },
        { label: 'Import Media...', accelerator: 'CmdOrCtrl+I', click: () => mainWindow?.webContents.send('menu:importMedia') },
        { label: 'Export...', accelerator: 'CmdOrCtrl+M', click: () => mainWindow?.webContents.send('menu:export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow?.webContents.send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => mainWindow?.webContents.send('menu:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Reset Layout', click: () => mainWindow?.webContents.send('menu:resetLayout') },
      ],
    },
    {
      label: 'Advanced',
      submenu: [
        { label: 'Regenerate Preview', click: () => mainWindow?.webContents.send('menu:regeneratePreview') },
        { type: 'separator' },
        { label: 'Clear Preview Cache', accelerator: 'CmdOrCtrl+Shift+Delete', click: () => mainWindow?.webContents.send('menu:clearPreviewCache') },
        { label: 'Clear Proxy References', click: () => mainWindow?.webContents.send('menu:clearProxyReferences') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ChopChop',
          click: async () => {
            await dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About ChopChop',
              message: 'ChopChop Video Editor',
              detail: `Version ${app.getVersion()}\n\nA free, open-source video editor powered by FFmpeg.`,
            });
          },
        },
        { type: 'separator' },
        { label: 'View on GitHub', click: () => shell.openExternal('https://github.com/anthropics/chopchop') },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

/**
 * Registers all IPC handlers from separate modules
 */
function registerAllIPCHandlers(): void {
  registerFFmpegHandlers();
  registerMediaHandlers(ipcContext);
  registerFileHandlers(ipcContext);
  registerProjectHandlers(ipcContext);
  registerExportHandlers(ipcContext);
  registerSettingsHandlers();
  registerAppHandlers(ipcContext);
  registerPreviewHandlers(ipcContext);
}

// App lifecycle handlers
app.on('ready', async () => {
  createWindow();
  createAppMenu();
  registerAllIPCHandlers();

  await updateRecentProjectMenu();

  const settings = await loadSettings();
  if (settings.recentProject) {
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('app:recentProject', settings.recentProject);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  disposePreviewEngine();
});
