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
    generateProxy: (inputPath: string, mediaId: string, scale: number, duration: number) =>
      ipcRenderer.invoke('media:generateProxy', inputPath, mediaId, scale, duration),
    cancelProxy: (mediaId: string) => ipcRenderer.invoke('media:cancelProxy', mediaId),
    deleteProxy: (proxyPath: string) => ipcRenderer.invoke('media:deleteProxy', proxyPath),
    onProxyProgress: (callback: (progress: { mediaId: string; percent: number; fps?: number; speed?: string }) => void) => {
      const handler = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('media:proxyProgress', handler);
      return () => ipcRenderer.removeListener('media:proxyProgress', handler);
    },
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

  // Preview chunk rendering
  preview: {
    renderChunk: (options: {
      chunkId: string;
      startTime: number;
      endTime: number;
      timeline: any;
      media: any[];
      settings: any;
      useProxies: boolean;
    }) => ipcRenderer.invoke('preview:renderChunk', options),
    cancelChunk: (chunkId: string) => ipcRenderer.invoke('preview:cancelChunk', chunkId),
    cancelAllChunks: () => ipcRenderer.invoke('preview:cancelAllChunks'),
    clearCache: () => ipcRenderer.invoke('preview:clearCache'),
    getChunkDir: () => ipcRenderer.invoke('preview:getChunkDir'),
    onChunkProgress: (callback: (progress: { chunkId: string; percent: number; fps?: number }) => void) => {
      const handler = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('preview:chunkProgress', handler);
      return () => ipcRenderer.removeListener('preview:chunkProgress', handler);
    },
    // Full timeline preview (simpler single-file approach)
    renderFullPreview: (options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      useProxies: boolean;
    }) => ipcRenderer.invoke('preview:renderFullPreview', options),
    cancelPreview: () => ipcRenderer.invoke('preview:cancelPreview'),
    onPreviewProgress: (callback: (progress: { percent: number; fps?: number }) => void) => {
      const handler = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('preview:previewProgress', handler);
      return () => ipcRenderer.removeListener('preview:previewProgress', handler);
    },
  },

  // App settings
  settings: {
    setRecentProject: (projectPath: string | null) =>
      ipcRenderer.invoke('settings:setRecentProject', projectPath),
    getRecentProject: () => ipcRenderer.invoke('settings:getRecentProject'),
  },

  // App lifecycle
  app: {
    showUnsavedChangesDialog: () => ipcRenderer.invoke('app:showUnsavedChangesDialog'),
    sendCloseResponse: (response: 'save' | 'discard' | 'cancel') =>
      ipcRenderer.send('app:closeResponse', response),
    onCheckUnsavedChanges: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('app:checkUnsavedChanges', handler);
      return () => ipcRenderer.removeListener('app:checkUnsavedChanges', handler);
    },
    onRecentProject: (callback: (path: string) => void) => {
      const handler = (_event: any, path: string) => callback(path);
      ipcRenderer.on('app:recentProject', handler);
      return () => ipcRenderer.removeListener('app:recentProject', handler);
    },
  },

  // Menu events from main process
  menu: {
    onNewProject: (callback: () => void) => {
      ipcRenderer.on('menu:newProject', callback);
      return () => ipcRenderer.removeListener('menu:newProject', callback);
    },
    onOpenProject: (callback: () => void) => {
      ipcRenderer.on('menu:openProject', callback);
      return () => ipcRenderer.removeListener('menu:openProject', callback);
    },
    onOpenRecent: (callback: () => void) => {
      ipcRenderer.on('menu:openRecent', callback);
      return () => ipcRenderer.removeListener('menu:openRecent', callback);
    },
    onSave: (callback: () => void) => {
      ipcRenderer.on('menu:save', callback);
      return () => ipcRenderer.removeListener('menu:save', callback);
    },
    onSaveAs: (callback: () => void) => {
      ipcRenderer.on('menu:saveAs', callback);
      return () => ipcRenderer.removeListener('menu:saveAs', callback);
    },
    onImportMedia: (callback: () => void) => {
      ipcRenderer.on('menu:importMedia', callback);
      return () => ipcRenderer.removeListener('menu:importMedia', callback);
    },
    onExport: (callback: () => void) => {
      ipcRenderer.on('menu:export', callback);
      return () => ipcRenderer.removeListener('menu:export', callback);
    },
    onUndo: (callback: () => void) => {
      ipcRenderer.on('menu:undo', callback);
      return () => ipcRenderer.removeListener('menu:undo', callback);
    },
    onRedo: (callback: () => void) => {
      ipcRenderer.on('menu:redo', callback);
      return () => ipcRenderer.removeListener('menu:redo', callback);
    },
    onResetLayout: (callback: () => void) => {
      ipcRenderer.on('menu:resetLayout', callback);
      return () => ipcRenderer.removeListener('menu:resetLayout', callback);
    },
    onRegenerateProxies: (callback: () => void) => {
      ipcRenderer.on('menu:regenerateProxies', callback);
      return () => ipcRenderer.removeListener('menu:regenerateProxies', callback);
    },
    onClearProxies: (callback: () => void) => {
      ipcRenderer.on('menu:clearProxies', callback);
      return () => ipcRenderer.removeListener('menu:clearProxies', callback);
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
