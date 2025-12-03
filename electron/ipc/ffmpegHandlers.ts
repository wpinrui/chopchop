/**
 * FFmpeg IPC Handlers
 *
 * Handles FFmpeg-related IPC operations.
 * Single Responsibility: FFmpeg availability and version checks.
 */

import { ipcMain } from 'electron';
import { checkFFmpegAvailable, getFFmpegVersion, checkNvencAvailable } from '../ffmpeg/runner';

export function registerFFmpegHandlers(): void {
  ipcMain.handle('ffmpeg:check', async () => {
    return await checkFFmpegAvailable();
  });

  ipcMain.handle('ffmpeg:getVersion', async () => {
    return await getFFmpegVersion();
  });

  ipcMain.handle('ffmpeg:checkNvenc', async () => {
    return await checkNvencAvailable();
  });
}
