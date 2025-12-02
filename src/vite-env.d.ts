/// <reference types="vite/client" />

import type { MediaMetadata, MediaType } from './types';

// Export progress type
interface ExportProgress {
  stage: string;
  percent: number;
  fps?: number;
  speed?: string;
  currentTime?: string;
  estimatedTimeRemaining?: string;
}

// Electron API types - must match electron/preload.ts
interface ElectronAPI {
  getVersion: () => Promise<string>;
  getPath: (name: string) => Promise<string>;

  ffmpeg: {
    check: () => Promise<boolean>;
    getVersion: () => Promise<string | null>;
    checkNvenc: () => Promise<boolean>;
  };

  media: {
    showImportDialog: () => Promise<string[] | null>;
    probe: (filePath: string) => Promise<{
      metadata: MediaMetadata | null;
      duration: number;
      type: MediaType;
      thumbnailDataUrl: string | null;
    }>;
    generateWaveform: (filePath: string) => Promise<number[] | null>;
    generateProxy: (inputPath: string, mediaId: string, scale: number, duration: number) =>
      Promise<{ success: boolean; proxyPath: string | null; error?: string }>;
    cancelProxy: (mediaId: string) => Promise<boolean>;
    deleteProxy: (proxyPath: string) => Promise<boolean>;
    onProxyProgress: (callback: (progress: { mediaId: string; percent: number; fps?: number; speed?: string }) => void) => () => void;
  };

  file: {
    readText: (filePath: string) => Promise<string>;
    writeText: (filePath: string, content: string) => Promise<void>;
    showSaveDialog: (options: any) => Promise<string | undefined>;
  };

  project: {
    showOpenDialog: () => Promise<string | null>;
    showSaveDialog: (defaultName: string) => Promise<string | null>;
  };

  export: {
    start: (settings: {
      timeline: any;
      media: any[];
      exportSettings: any;
    }) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
    cancel: () => Promise<void>;
    onProgress: (callback: (progress: ExportProgress) => void) => () => void;
  };

  preview: {
    renderChunk: (options: {
      chunkId: string;
      startTime: number;
      endTime: number;
      timeline: any;
      media: any[];
      settings: any;
      useProxies: boolean;
    }) => Promise<{ success: boolean; chunkId: string; filePath: string | null; error?: string }>;
    cancelChunk: (chunkId: string) => Promise<boolean>;
    cancelAllChunks: () => Promise<void>;
    clearCache: () => Promise<void>;
    getChunkDir: () => Promise<string>;
    onChunkProgress: (callback: (progress: { chunkId: string; percent: number; fps?: number }) => void) => () => void;
    // Full timeline preview (simpler single-file approach)
    renderFullPreview: (options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      useProxies: boolean;
    }) => Promise<{ success: boolean; filePath: string | null; error?: string }>;
    cancelPreview: () => Promise<void>;
    onPreviewProgress: (callback: (progress: { percent: number; fps?: number }) => void) => () => void;
  };

  settings: {
    setRecentProject: (projectPath: string | null) => Promise<void>;
    getRecentProject: () => Promise<string | null>;
  };

  app: {
    showUnsavedChangesDialog: () => Promise<'save' | 'discard' | 'cancel'>;
    sendCloseResponse: (response: 'save' | 'discard' | 'cancel') => void;
    onCheckUnsavedChanges: (callback: () => void) => () => void;
    onRecentProject: (callback: (path: string) => void) => () => void;
  };

  menu: {
    onNewProject: (callback: () => void) => () => void;
    onOpenProject: (callback: () => void) => () => void;
    onOpenRecent: (callback: () => void) => () => void;
    onSave: (callback: () => void) => () => void;
    onSaveAs: (callback: () => void) => () => void;
    onImportMedia: (callback: () => void) => () => void;
    onExport: (callback: () => void) => () => void;
    onUndo: (callback: () => void) => () => void;
    onRedo: (callback: () => void) => () => void;
    onResetLayout: (callback: () => void) => () => void;
    onRegenerateProxies: (callback: () => void) => () => void;
    onClearProxies: (callback: () => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
