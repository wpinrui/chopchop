/**
 * IPC Handler Types
 *
 * Shared types for IPC handler modules.
 */

import type { BrowserWindow } from 'electron';

export interface IpcContext {
  mainWindow: BrowserWindow | null;
}

export interface AppSettings {
  recentProject: string | null;
  windowBounds?: { width: number; height: number; x?: number; y?: number };
}
