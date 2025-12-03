/**
 * Media IPC Handlers
 *
 * Handles media import, probing, and proxy generation.
 * Single Responsibility: Media file operations.
 */

import { ipcMain, dialog, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { probeMediaFile, getMediaDuration, generateThumbnail, getMediaType, generateWaveformData } from '../ffmpeg/probe';
import { generateProxy, cancelProxyGeneration } from '../ffmpeg/runner';
import type { IpcContext } from './types';

const SUPPORTED_EXTENSIONS = [
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'm4v',
  'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp',
];

export function registerMediaHandlers(context: IpcContext): void {
  ipcMain.handle('media:showImportDialog', async () => {
    if (!context.mainWindow) return null;

    const result = await dialog.showOpenDialog(context.mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media Files', extensions: SUPPORTED_EXTENSIONS },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('media:probe', async (_event, filePath: string) => {
    const metadata = await probeMediaFile(filePath);
    const type = getMediaType(filePath, metadata || undefined);
    const duration = type === 'image' ? 5 : await getMediaDuration(filePath);

    let thumbnailDataUrl: string | null = null;
    if (type === 'video' || type === 'image') {
      thumbnailDataUrl = await generateThumbnailDataUrl(filePath, type, duration);
    }

    return { metadata, duration, type, thumbnailDataUrl };
  });

  ipcMain.handle('media:generateWaveform', async (_event, filePath: string) => {
    return await generateWaveformData(filePath);
  });

  ipcMain.handle('media:generateProxy', async (
    _event,
    inputPath: string,
    mediaId: string,
    scale: number,
    duration: number
  ) => {
    const proxyDir = path.join(app.getPath('userData'), 'proxies');
    await fs.mkdir(proxyDir, { recursive: true });

    const proxyFileName = `${mediaId}_proxy.mp4`;
    const proxyPath = path.join(proxyDir, proxyFileName);

    // Check if proxy already exists
    try {
      await fs.access(proxyPath);
      return { success: true, proxyPath };
    } catch {
      // Proxy doesn't exist, generate it
    }

    const onProgress = (progress: { percent: number; fps?: number; speed?: string }) => {
      context.mainWindow?.webContents.send('media:proxyProgress', {
        mediaId,
        percent: progress.percent,
        fps: progress.fps,
        speed: progress.speed,
      });
    };

    return await generateProxy(inputPath, proxyPath, scale, duration, onProgress);
  });

  ipcMain.handle('media:cancelProxy', async (_event, mediaId: string) => {
    const proxyDir = path.join(app.getPath('userData'), 'proxies');
    const proxyPath = path.join(proxyDir, `${mediaId}_proxy.mp4`);
    return cancelProxyGeneration(proxyPath);
  });

  ipcMain.handle('media:deleteProxy', async (_event, proxyPath: string) => {
    try {
      await fs.unlink(proxyPath);
      return true;
    } catch {
      return false;
    }
  });
}

async function generateThumbnailDataUrl(
  filePath: string,
  type: string,
  duration: number
): Promise<string | null> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chopchop-'));
  const thumbPath = path.join(tempDir, `thumb-${Date.now()}.jpg`);
  const thumbTime = type === 'video' ? duration / 2 : 0;
  const thumbGenerated = await generateThumbnail(filePath, thumbPath, thumbTime);

  if (!thumbGenerated) return null;

  try {
    const thumbBuffer = await fs.readFile(thumbPath);
    const dataUrl = `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
    await fs.unlink(thumbPath).catch(() => {});
    await fs.rmdir(tempDir).catch(() => {});
    return dataUrl;
  } catch {
    return null;
  }
}
