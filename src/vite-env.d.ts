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
    exists: (filePath: string) => Promise<boolean>;
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
    // Legacy chunk-based rendering
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
    // Unified pipeline (proxy generation + preview rendering)
    runPipeline: (options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      proxyScale?: number;
    }) => Promise<{ success: boolean; filePath: string | null; generatedProxies: string[]; error?: string }>;
    cancelPipeline: () => Promise<void>;
    onPipelineProgress: (callback: (progress: { phase: 'proxy' | 'render'; overallPercent: number; currentTask: string; phasePercent: number }) => void) => () => void;
    onProxyGenerated: (callback: (data: { mediaId: string; proxyPath: string }) => void) => () => void;

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
    }) => Promise<{
      success: boolean;
      chunks?: Array<{
        index: number;
        startTime: number;
        endTime: number;
        status: string;
        filePath: string | null;
        isComplex: boolean;
      }>;
      error?: string;
    }>;

    // Update timeline after edits
    updateTimeline: (options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
    }) => Promise<{ success: boolean; error?: string }>;

    // Extract a single frame (for scrub/pause) - returns RGBA pixel data
    extractFrame: (time: number) => Promise<{
      success: boolean;
      time?: number;
      width?: number;
      height?: number;
      data?: ArrayBuffer;
      error?: string;
    }>;

    // Prefetch frames for smoother playback
    prefetchFrames: (time: number, count?: number, direction?: -1 | 1) => Promise<void>;

    // Scrub mode
    scrubStart: (time: number) => Promise<{ success: boolean }>;
    scrubUpdate: (time: number, velocity: number) => Promise<{
      success: boolean;
      time?: number;
      width?: number;
      height?: number;
      data?: ArrayBuffer;
      error?: string;
    }>;
    scrubEnd: () => Promise<{ success: boolean }>;

    // Frame stepping (for accurate cutting)
    frameStep: (direction: -1 | 1, frameRate: number) => Promise<{
      success: boolean;
      time?: number;
      width?: number;
      height?: number;
      data?: ArrayBuffer;
      error?: string;
    }>;

    // Get playback info (realtime vs cached chunk)
    getPlaybackInfo: (time: number) => Promise<{
      mode: 'realtime' | 'chunk';
      chunkPath: string | null;
      chunkStartTime: number;
      chunkEndTime: number;
      isComplex: boolean;
    }>;

    // Get clip info for realtime playback
    getClipAtTime: (time: number) => Promise<{
      mediaPath: string;
      mediaTime: number;
      hasClip: boolean;
    } | null>;

    // Prioritize chunks near playhead for background rendering
    prioritizeChunks: (time: number) => Promise<{ success: boolean }>;

    // Invalidate chunks in a time range (after edits)
    invalidateRange: (startTime: number, endTime: number) => Promise<{ success: boolean }>;

    // Clear all preview cache (hybrid system)
    clearAllCache: () => Promise<{ success: boolean; error?: string }>;

    // Get cache statistics
    getCacheStats: () => Promise<{ totalChunks: number; cachedChunks: number; totalSize: number }>;

    // Get current chunks status
    getChunks: () => Promise<Array<{
      index: number;
      startTime: number;
      endTime: number;
      status: string;
      filePath: string | null;
      isComplex: boolean;
    }>>;

    // Listen for chunk status updates
    onChunksUpdate: (callback: (chunks: Array<{
      index: number;
      startTime: number;
      endTime: number;
      status: string;
      filePath: string | null;
      isComplex: boolean;
    }>) => void) => () => void;

    // Listen for audio snippets (for scrub audio)
    onAudioSnippet: (callback: (data: {
      time: number;
      duration: number;
      sampleRate: number;
      channels: number;
      audioData: ArrayBuffer;
    }) => void) => () => void;
  };

  // ========================================================================
  // SIMPLE PREVIEW SYSTEM (Simplified chunk-based preview)
  // ========================================================================
  simplePreview: {
    // Initialize the simple preview engine
    initialize: () => Promise<{ success: boolean }>;

    // Render all chunks and concat into full preview
    renderFullPreview: () => Promise<{ success: boolean; previewPath?: string | null; error?: string }>;

    // Get current preview state
    getState: () => Promise<{
      isInitialized: boolean;
      isRendering: boolean;
      progress: number;
      fullPreviewPath: string | null;
      fullPreviewReady: boolean;
      chunks: Array<{
        index: number;
        startTime: number;
        endTime: number;
        status: string;
        filePath: string | null;
      }>;
      error: string | null;
    }>;

    // Get full preview path if ready
    getFullPreviewPath: () => Promise<string | null>;

    // Clear all cache
    clearCache: () => Promise<{ success: boolean; error?: string }>;

    // Listen for state updates
    onStateUpdate: (callback: (state: {
      isInitialized: boolean;
      isRendering: boolean;
      progress: number;
      fullPreviewPath: string | null;
      fullPreviewReady: boolean;
    }) => void) => () => void;

    // Listen for progress updates
    onProgress: (callback: (data: {
      progress: number;
      chunksReady: number;
      totalChunks: number;
      isRendering: boolean;
    }) => void) => () => void;
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
    onRegeneratePreview: (callback: () => void) => () => void;
    onClearPreviewCache: (callback: () => void) => () => void;
    onClearProxyReferences: (callback: () => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
