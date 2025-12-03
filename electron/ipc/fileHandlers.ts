/**
 * File IPC Handlers
 *
 * Handles file system operations.
 * Single Responsibility: Basic file read/write operations.
 */

import { ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import type { IpcContext } from './types';

export function registerFileHandlers(context: IpcContext): void {
  ipcMain.handle('file:exists', async (_event, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('file:readText', async (_event, filePath: string) => {
    return await fs.readFile(filePath, 'utf-8');
  });

  ipcMain.handle('file:writeText', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle('file:showSaveDialog', async (_event, options: any) => {
    if (!context.mainWindow) return null;
    const result = await dialog.showSaveDialog(context.mainWindow, options);
    return result.filePath;
  });
}
