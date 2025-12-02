/**
 * ChopChop Main Process
 *
 * Manages the Electron application lifecycle, window creation, and IPC handlers.
 */

import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import { probeMediaFile, getMediaDuration, generateThumbnail, getMediaType, generateWaveformData } from './ffmpeg/probe';
import { checkFFmpegAvailable, getFFmpegVersion, checkNvencAvailable } from './ffmpeg/runner';
import { exportTimeline, cancelExport, type ExportProgress } from './ffmpeg/exporter';
import fs from 'node:fs/promises';
import os from 'node:os';

// App settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// App settings interface
interface AppSettings {
  recentProject: string | null;
  windowBounds?: { width: number; height: number; x?: number; y?: number };
}

// Load app settings
async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { recentProject: null };
  }
}

// Save app settings
async function saveSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// Track if we're force quitting (to bypass unsaved changes dialog)
let forceQuit = false;

// In CommonJS, __dirname is available directly
// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist');

let mainWindow: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

/**
 * Creates the main application window
 */
function createWindow() {
  // Set VITE_PUBLIC after app is ready
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
      // Allow loading local media files (safe for a local video editor)
      webSecurity: false,
    },
  });

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // DevTools can be opened with F12 or Ctrl+Shift+I
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  // Handle window close - check for unsaved changes
  mainWindow.on('close', async (e) => {
    if (forceQuit) {
      return; // Allow close without prompting
    }

    // Ask renderer if there are unsaved changes
    e.preventDefault();
    mainWindow?.webContents.send('app:checkUnsavedChanges');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create the application menu
 */
function createAppMenu() {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:newProject'),
        },
        { type: 'separator' },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:openProject'),
        },
        {
          label: 'Open Recent',
          id: 'recent-project',
          enabled: false, // Will be enabled if there's a recent project
          click: () => mainWindow?.webContents.send('menu:openRecent'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:saveAs'),
        },
        { type: 'separator' },
        {
          label: 'Import Media...',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu:importMedia'),
        },
        {
          label: 'Export...',
          accelerator: 'CmdOrCtrl+M',
          click: () => mainWindow?.webContents.send('menu:export'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('menu:redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    // View menu
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
        {
          label: 'Reset Layout',
          click: () => mainWindow?.webContents.send('menu:resetLayout'),
        },
      ],
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ChopChop',
          click: async () => {
            const version = app.getVersion();
            await dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About ChopChop',
              message: 'ChopChop Video Editor',
              detail: `Version ${version}\n\nA free, open-source video editor powered by FFmpeg.`,
            });
          },
        },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: () => shell.openExternal('https://github.com/anthropics/chopchop'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  return menu;
}

/**
 * Update recent project menu item
 */
async function updateRecentProjectMenu() {
  const settings = await loadSettings();
  const menu = Menu.getApplicationMenu();
  if (menu) {
    const recentItem = menu.getMenuItemById('recent-project');
    if (recentItem && settings.recentProject) {
      recentItem.enabled = true;
      recentItem.label = `Open Recent: ${path.basename(settings.recentProject)}`;
    }
  }
}

/**
 * App lifecycle handlers
 */

app.on('ready', async () => {
  createWindow();
  createAppMenu();
  registerIPCHandlers();

  // Update menu with recent project info
  await updateRecentProjectMenu();

  // Check for recent project and notify renderer
  const settings = await loadSettings();
  if (settings.recentProject) {
    // Wait for window to be ready, then check if user wants to open recent
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('app:recentProject', settings.recentProject);
    });
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running until user explicitly quits
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

/**
 * IPC Handlers
 *
 * These handle communication between the renderer process (React) and main process.
 */
function registerIPCHandlers() {
  // App info
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getPath', (_event, name: string) => {
    return app.getPath(name as any);
  });

  // FFmpeg info
  ipcMain.handle('ffmpeg:check', async () => {
    return await checkFFmpegAvailable();
  });

  ipcMain.handle('ffmpeg:getVersion', async () => {
    return await getFFmpegVersion();
  });

  ipcMain.handle('ffmpeg:checkNvenc', async () => {
    return await checkNvencAvailable();
  });

  // Media import
  ipcMain.handle('media:showImportDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media Files',
          extensions: [
            'mp4',
            'mov',
            'mkv',
            'webm',
            'avi',
            'flv',
            'm4v',
            'mp3',
            'wav',
            'aac',
            'flac',
            'ogg',
            'm4a',
            'jpg',
            'jpeg',
            'png',
            'gif',
            'bmp',
            'webp',
          ],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled) {
      return null;
    }

    return result.filePaths;
  });

  ipcMain.handle('media:probe', async (_event, filePath: string) => {
    const metadata = await probeMediaFile(filePath);
    const type = getMediaType(filePath, metadata || undefined);

    // Images have no duration - use default of 5 seconds for timeline
    const duration = type === 'image' ? 5 : await getMediaDuration(filePath);

    // Generate thumbnail and convert to base64
    // For videos, use middle of clip to avoid black frames at start
    let thumbnailDataUrl: string | null = null;
    if (type === 'video' || type === 'image') {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chopchop-'));
      const thumbPath = path.join(tempDir, `thumb-${Date.now()}.jpg`);
      const thumbTime = type === 'video' ? duration / 2 : 0;
      const thumbGenerated = await generateThumbnail(filePath, thumbPath, thumbTime);

      if (thumbGenerated) {
        // Read thumbnail and convert to base64
        const thumbBuffer = await fs.readFile(thumbPath);
        thumbnailDataUrl = `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;

        // Clean up temp file
        await fs.unlink(thumbPath).catch(() => {});
        await fs.rmdir(tempDir).catch(() => {});
      }
    }

    return {
      metadata,
      duration,
      type,
      thumbnailDataUrl,
    };
  });

  // Async waveform generation (called separately after import for non-blocking UX)
  ipcMain.handle('media:generateWaveform', async (_event, filePath: string) => {
    return await generateWaveformData(filePath);
  });

  // File operations
  ipcMain.handle('file:readText', async (_event, filePath: string) => {
    return await fs.readFile(filePath, 'utf-8');
  });

  ipcMain.handle('file:writeText', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle('file:showSaveDialog', async (_event, options: any) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result.filePath;
  });

  // Project file operations
  ipcMain.handle('project:showOpenDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'ChopChop Project', extensions: ['chpchp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('project:showSaveDialog', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultName,
      filters: [
        { name: 'ChopChop Project', extensions: ['chpchp'] },
      ],
    });

    return result.filePath || null;
  });

  // Export operations
  ipcMain.handle('export:start', async (
    _event,
    timeline: any,
    media: any[],
    settings: any
  ) => {
    const onProgress = (progress: ExportProgress) => {
      // Send progress to renderer
      mainWindow?.webContents.send('export:progress', progress);
    };

    return await exportTimeline(timeline, media, settings, onProgress);
  });

  ipcMain.handle('export:cancel', async () => {
    await cancelExport();
  });

  // App settings
  ipcMain.handle('settings:setRecentProject', async (_event, projectPath: string | null) => {
    const settings = await loadSettings();
    settings.recentProject = projectPath;
    await saveSettings(settings);
    await updateRecentProjectMenu();
  });

  ipcMain.handle('settings:getRecentProject', async () => {
    const settings = await loadSettings();
    return settings.recentProject;
  });

  // Close confirmation response from renderer
  ipcMain.on('app:closeResponse', async (_event, response: 'save' | 'discard' | 'cancel') => {
    if (response === 'cancel') {
      // User cancelled, don't close
      return;
    }

    if (response === 'save') {
      // Renderer will save and then send 'discard' when done
      return;
    }

    if (response === 'discard') {
      // Force quit without checking again
      forceQuit = true;
      mainWindow?.close();
    }
  });

  // Show unsaved changes dialog
  ipcMain.handle('app:showUnsavedChangesDialog', async () => {
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Do you want to save before closing?',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });

    switch (result.response) {
      case 0: return 'save';
      case 1: return 'discard';
      default: return 'cancel';
    }
  });
}

// Graceful shutdown
app.on('before-quit', () => {
  // TODO: Clean up ffmpeg processes, temp files, etc.
});
