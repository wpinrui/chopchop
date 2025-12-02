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
    checkNvenc: () => ipcRenderer.invoke('ffmpeg:checkNvenc'),
  },

  // Media operations
  media: {
    showImportDialog: () => ipcRenderer.invoke('media:showImportDialog'),
    probe: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
    generateWaveform: (filePath: string) => ipcRenderer.invoke('media:generateWaveform', filePath),
  },

  // File operations
  file: {
    readText: (filePath: string) => ipcRenderer.invoke('file:readText', filePath),
    writeText: (filePath: string, content: string) =>
      ipcRenderer.invoke('file:writeText', filePath, content),
    showSaveDialog: (options: any) =>
      ipcRenderer.invoke('file:showSaveDialog', options),
  },

  // Project operations
  project: {
    showOpenDialog: () => ipcRenderer.invoke('project:showOpenDialog'),
    showSaveDialog: (defaultName: string) =>
      ipcRenderer.invoke('project:showSaveDialog', defaultName),
  },

  // Export operations
  export: {
    start: (settings: any) =>
      ipcRenderer.invoke('export:start', settings.timeline, settings.media, settings.exportSettings),
    cancel: () => ipcRenderer.invoke('export:cancel'),
    onProgress: (callback: (progress: any) => void) => {
      const handler = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('export:progress', handler);
      // Return cleanup function
      return () => ipcRenderer.removeListener('export:progress', handler);
    },
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
