/**
 * Project IPC Handlers
 *
 * Handles project file operations.
 * Single Responsibility: Project save/open dialogs.
 */

import { ipcMain, dialog } from 'electron';
import type { IpcContext } from './types';

export function registerProjectHandlers(context: IpcContext): void {
  ipcMain.handle('project:showOpenDialog', async () => {
    if (!context.mainWindow) return null;

    const result = await dialog.showOpenDialog(context.mainWindow, {
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
    if (!context.mainWindow) return null;

    const result = await dialog.showSaveDialog(context.mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'ChopChop Project', extensions: ['chpchp'] },
      ],
    });

    return result.filePath || null;
  });
}
