/**
 * Export IPC Handlers
 *
 * Handles timeline export operations.
 * Single Responsibility: Export timeline to video file.
 */

import { ipcMain } from 'electron';
import { exportTimeline, cancelExport, type ExportProgress } from '../ffmpeg/exporter';
import type { IpcContext } from './types';

export function registerExportHandlers(context: IpcContext): void {
  ipcMain.handle('export:start', async (
    _event,
    timeline: any,
    media: any[],
    settings: any
  ) => {
    const onProgress = (progress: ExportProgress) => {
      context.mainWindow?.webContents.send('export:progress', progress);
    };

    return await exportTimeline(timeline, media, settings, onProgress);
  });

  ipcMain.handle('export:cancel', async () => {
    await cancelExport();
  });
}
