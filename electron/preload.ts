/**
 * ChopChop Preload Script
 *
 * Exposes safe APIs from the main process to the renderer process via contextBridge.
 * This is the security boundary between Node.js and the web content.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposed API that will be available on window.electronAPI in the renderer
 */
const electronAPI = {
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),

  // TODO: Add more APIs as we build features:
  // - File system operations (open, save, import media)
  // - ffmpeg operations
  // - Project operations
  // - Export operations
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type definitions for the exposed API
export type ElectronAPI = typeof electronAPI;

// This allows TypeScript to know about window.electronAPI in the renderer
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
