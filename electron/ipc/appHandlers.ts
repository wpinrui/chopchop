/**
 * App IPC Handlers
 *
 * Handles application-level IPC operations.
 * Single Responsibility: App info, version, close handling.
 */

import { ipcMain, app, dialog } from 'electron';
import type { IpcContext } from './types';

let forceQuit = false;

export function getForceQuit(): boolean {
  return forceQuit;
}

export function setForceQuit(value: boolean): void {
  forceQuit = value;
}

export function registerAppHandlers(context: IpcContext): void {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getPath', (_event, name: string) => {
    return app.getPath(name as any);
  });

  // Close confirmation response from renderer
  ipcMain.on('app:closeResponse', async (_event, response: 'save' | 'discard' | 'cancel') => {
    if (response === 'cancel') {
      return;
    }

    if (response === 'save') {
      // Renderer will save and then send 'discard' when done
      return;
    }

    if (response === 'discard') {
      forceQuit = true;
      context.mainWindow?.close();
    }
  });

  ipcMain.handle('app:showUnsavedChangesDialog', async () => {
    if (!context.mainWindow) return 'cancel';

    const result = await dialog.showMessageBox(context.mainWindow, {
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
