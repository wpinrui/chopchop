/**
 * ChopChop Main Process
 *
 * Manages the Electron application lifecycle, window creation, and IPC handlers.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeMediaFile, getMediaDuration, generateThumbnail, getMediaType } from './ffmpeg/probe';
import { checkFFmpegAvailable, getFFmpegVersion } from './ffmpeg/runner';
import fs from 'node:fs/promises';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public');

let mainWindow: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

/**
 * Creates the main application window
 */
function createWindow() {
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
    },
  });

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // DevTools can be opened with F12 or Ctrl+Shift+I
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * App lifecycle handlers
 */

app.on('ready', () => {
  createWindow();
  registerIPCHandlers();
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
    const duration = await getMediaDuration(filePath);
    const type = getMediaType(filePath, metadata || undefined);

    // Generate thumbnail and convert to base64
    let thumbnailDataUrl: string | null = null;
    if (type === 'video' || type === 'image') {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chopchop-'));
      const thumbPath = path.join(tempDir, `thumb-${Date.now()}.jpg`);
      const thumbGenerated = await generateThumbnail(filePath, thumbPath, 0);

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
}

// Graceful shutdown
app.on('before-quit', () => {
  // TODO: Clean up ffmpeg processes, temp files, etc.
});
