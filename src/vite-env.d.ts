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
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
