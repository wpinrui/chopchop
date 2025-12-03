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
    exists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('file:exists', filePath),
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
    // Unified pipeline (proxy generation + preview rendering)
    runPipeline: (options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      proxyScale?: number;
    }) => ipcRenderer.invoke('preview:runPipeline', options),
    cancelPipeline: () => ipcRenderer.invoke('preview:cancelPipeline'),
    onPipelineProgress: (callback: (progress: { phase: 'proxy' | 'render'; overallPercent: number; currentTask: string; phasePercent: number }) => void) => {
      const handler = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('preview:pipelineProgress', handler);
      return () => ipcRenderer.removeListener('preview:pipelineProgress', handler);
    },
    onProxyGenerated: (callback: (data: { mediaId: string; proxyPath: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('preview:proxyGenerated', handler);
      return () => ipcRenderer.removeListener('preview:proxyGenerated', handler);
    },

    // ========================================================================
    // HYBRID PREVIEW SYSTEM (New)
    // ========================================================================

    // Initialize the hybrid preview engine
    init: (options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      projectPath: string | null;
    }) => ipcRenderer.invoke('preview:init', options),

    // Update timeline after edits
    updateTimeline: (options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
    }) => ipcRenderer.invoke('preview:updateTimeline', options),

    // Extract a single frame (for scrub/pause) - returns RGBA pixel data
    extractFrame: (time: number) => ipcRenderer.invoke('preview:extractFrame', time),

    // Scrub mode
    scrubStart: (time: number) => ipcRenderer.invoke('preview:scrubStart', time),
    scrubUpdate: (time: number, velocity: number) =>
      ipcRenderer.invoke('preview:scrubUpdate', { time, velocity }),
    scrubEnd: () => ipcRenderer.invoke('preview:scrubEnd'),

    // Frame stepping (for accurate cutting)
    frameStep: (direction: -1 | 1, frameRate: number) =>
      ipcRenderer.invoke('preview:frameStep', { direction, frameRate }),

    // Get playback info (realtime vs cached chunk)
    getPlaybackInfo: (time: number) => ipcRenderer.invoke('preview:getPlaybackInfo', time),

    // Get clip info for realtime playback
    getClipAtTime: (time: number) => ipcRenderer.invoke('preview:getClipAtTime', time),

    // Prioritize chunks near playhead for background rendering
    prioritizeChunks: (time: number) => ipcRenderer.invoke('preview:prioritizeChunks', time),

    // Invalidate chunks in a time range (after edits)
    invalidateRange: (startTime: number, endTime: number) =>
      ipcRenderer.invoke('preview:invalidateRange', { startTime, endTime }),

    // Clear all preview cache
    clearAllCache: () => ipcRenderer.invoke('preview:clearAllCache'),

    // Get cache statistics
    getCacheStats: () => ipcRenderer.invoke('preview:getCacheStats'),

    // Get current chunks status
    getChunks: () => ipcRenderer.invoke('preview:getChunks'),

    // Listen for chunk status updates
    onChunksUpdate: (callback: (chunks: Array<{
      index: number;
      startTime: number;
      endTime: number;
      status: string;
      filePath: string | null;
      isComplex: boolean;
    }>) => void) => {
      const handler = (_event: any, chunks: any) => callback(chunks);
      ipcRenderer.on('preview:chunksUpdate', handler);
      return () => ipcRenderer.removeListener('preview:chunksUpdate', handler);
    },

    // Listen for audio snippets (for scrub audio)
    onAudioSnippet: (callback: (data: {
      time: number;
      duration: number;
      sampleRate: number;
      channels: number;
      audioData: ArrayBuffer;
    }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('preview:audioSnippet', handler);
      return () => ipcRenderer.removeListener('preview:audioSnippet', handler);
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
    onRegeneratePreview: (callback: () => void) => {
      ipcRenderer.on('menu:regeneratePreview', callback);
      return () => ipcRenderer.removeListener('menu:regeneratePreview', callback);
    },
    onClearPreviewCache: (callback: () => void) => {
      ipcRenderer.on('menu:clearPreviewCache', callback);
      return () => ipcRenderer.removeListener('menu:clearPreviewCache', callback);
    },
    onClearProxyReferences: (callback: () => void) => {
      ipcRenderer.on('menu:clearProxyReferences', callback);
      return () => ipcRenderer.removeListener('menu:clearProxyReferences', callback);
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
