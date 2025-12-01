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

  // FFmpeg
  ffmpeg: {
    check: () => ipcRenderer.invoke('ffmpeg:check'),
    getVersion: () => ipcRenderer.invoke('ffmpeg:getVersion'),
  },

  // Media operations
  media: {
    showImportDialog: () => ipcRenderer.invoke('media:showImportDialog'),
    probe: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
  },

  // File operations
  file: {
    readText: (filePath: string) => ipcRenderer.invoke('file:readText', filePath),
    writeText: (filePath: string, content: string) =>
      ipcRenderer.invoke('file:writeText', filePath, content),
    showSaveDialog: (options: any) =>
      ipcRenderer.invoke('file:showSaveDialog', options),
  },
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
