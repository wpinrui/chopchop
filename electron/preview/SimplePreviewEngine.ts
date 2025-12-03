/**
 * Simple Preview Engine
 *
 * Simplified preview system that:
 * 1. Renders timeline into 2-second chunks (using existing ChunkRenderer)
 * 2. Concatenates all chunks into a single full preview file
 * 3. Provides a single video file for playback (no gapless transition logic needed)
 *
 * Cache invalidation:
 * - Only timeline edits invalidate chunks (not playhead movement, not UI changes)
 * - Affected chunks are re-rendered, then full preview is re-concatenated
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import type {
  Timeline,
  MediaItem,
  ProjectSettings,
  ChunkInfo,
  ChunkStatus,
} from './types';
import { ChunkRenderer } from './ChunkRenderer';
import { ChunkCache } from './ChunkCache';

const CHUNK_DURATION = 2; // seconds
const MAX_CONCURRENT_RENDERS = 2;

export interface SimplePreviewState {
  isInitialized: boolean;
  isRendering: boolean;
  progress: number; // 0-100
  fullPreviewPath: string | null;
  fullPreviewReady: boolean;
  chunks: ChunkInfo[];
  error: string | null;
}

export class SimplePreviewEngine {
  private cache: ChunkCache;
  private renderer: ChunkRenderer;
  private mainWindow: BrowserWindow | null = null;

  // State
  private timeline: Timeline | null = null;
  private media: MediaItem[] = [];
  private settings: ProjectSettings | null = null;
  private duration: number = 0;
  private projectPath: string | null = null;

  private chunks: ChunkInfo[] = [];
  private isInitialized: boolean = false;
  private isRendering: boolean = false;
  private fullPreviewPath: string | null = null;
  private fullPreviewReady: boolean = false;

  // Track which chunks are done
  private chunksCompleted: Set<number> = new Set();
  private totalChunksToRender: number = 0;

  // Timeline hash for change detection
  private lastTimelineHash: string = '';

  constructor() {
    this.cache = new ChunkCache(CHUNK_DURATION);
    this.renderer = new ChunkRenderer(this.cache, MAX_CONCURRENT_RENDERS, CHUNK_DURATION);

    // Set up chunk completion callback
    this.renderer.setCompleteCallback((result) => {
      this.onChunkComplete(result);
    });

    this.renderer.setProgressCallback((progress) => {
      this.sendProgressUpdate();
    });
  }

  /**
   * Get ffmpeg path
   */
  private getFFmpegPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
    } else {
      return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe');
    }
  }

  /**
   * Get cache directory for full preview
   */
  private getPreviewCacheDir(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'preview-cache');
  }

  /**
   * Compute hash of timeline state for change detection
   */
  private computeTimelineHash(): string {
    if (!this.timeline || !this.settings) return '';

    const data = {
      tracks: this.timeline.tracks.map(track => ({
        id: track.id,
        type: track.type,
        muted: track.muted,
        visible: track.visible,
        clips: track.clips.map(clip => ({
          id: clip.id,
          mediaId: clip.mediaId,
          timelineStart: clip.timelineStart,
          duration: clip.duration,
          mediaIn: clip.mediaIn,
          mediaOut: clip.mediaOut,
          enabled: clip.enabled,
        })),
      })),
      resolution: this.settings.resolution,
      frameRate: this.settings.frameRate,
      duration: this.duration,
    };

    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Initialize the preview engine
   */
  async initialize(
    timeline: Timeline,
    media: MediaItem[],
    settings: ProjectSettings,
    duration: number,
    projectPath: string | null,
    mainWindow: BrowserWindow
  ): Promise<SimplePreviewState> {
    this.timeline = timeline;
    this.media = media;
    this.settings = settings;
    this.duration = duration;
    this.projectPath = projectPath;
    this.mainWindow = mainWindow;

    // Initialize cache
    this.chunks = await this.cache.initialize(timeline, media, settings, duration, projectPath);

    // Mark all chunks as complex (we always pre-render)
    for (const chunk of this.chunks) {
      chunk.isComplex = true;
    }

    // Initialize renderer
    this.renderer.initialize(timeline, media, settings, mainWindow);

    // Compute initial hash
    this.lastTimelineHash = this.computeTimelineHash();

    // Ensure preview cache directory exists
    const cacheDir = this.getPreviewCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    this.isInitialized = true;

    return this.getState();
  }

  /**
   * Start rendering all chunks and concat into full preview
   * Call this when user clicks play
   */
  async renderFullPreview(): Promise<string | null> {
    if (!this.isInitialized || !this.timeline || !this.settings) {
      return null;
    }

    // Check if we already have a valid full preview
    if (this.fullPreviewReady && this.fullPreviewPath && fs.existsSync(this.fullPreviewPath)) {
      return this.fullPreviewPath;
    }

    // Find chunks that need rendering
    const chunksToRender = this.chunks.filter(
      c => c.status === 'missing' || c.status === 'stale' || c.status === 'error'
    );

    if (chunksToRender.length === 0) {
      // All chunks ready, just concat
      return this.concatChunks();
    }

    // Start rendering
    this.isRendering = true;
    this.chunksCompleted = new Set();
    this.totalChunksToRender = chunksToRender.length;
    this.fullPreviewReady = false;

    this.sendStateUpdate();

    // Queue all chunks for rendering
    this.renderer.queueChunks(chunksToRender, 'high');

    // Return null - the preview will be ready when all chunks complete
    // and we'll send a state update
    return null;
  }

  /**
   * Called when a chunk finishes rendering
   */
  private async onChunkComplete(result: {
    chunkIndex: number;
    success: boolean;
    filePath: string | null;
    error?: string;
  }): Promise<void> {
    const chunk = this.chunks.find(c => c.index === result.chunkIndex);
    if (!chunk) return;

    if (result.success && result.filePath) {
      chunk.status = 'valid';
      chunk.filePath = result.filePath;
      this.chunksCompleted.add(result.chunkIndex);
    } else {
      chunk.status = 'error';
      chunk.error = result.error;
    }

    this.sendProgressUpdate();

    // Check if all chunks are done
    const allChunksDone = this.chunks.every(c => c.status === 'valid');
    if (allChunksDone && this.isRendering) {
      // Concatenate all chunks into full preview
      const fullPath = await this.concatChunks();
      if (fullPath) {
        this.fullPreviewPath = fullPath;
        this.fullPreviewReady = true;
      }
      this.isRendering = false;
      this.sendStateUpdate();
    }
  }

  /**
   * Concatenate all chunks into a single preview file
   */
  private async concatChunks(): Promise<string | null> {
    if (!this.settings) return null;

    // Sort chunks by index
    const sortedChunks = [...this.chunks]
      .filter(c => c.status === 'valid' && c.filePath)
      .sort((a, b) => a.index - b.index);

    if (sortedChunks.length === 0) {
      return null;
    }

    // Create concat list file
    const cacheDir = this.getPreviewCacheDir();
    const listPath = path.join(cacheDir, 'concat_list.txt');
    const outputPath = path.join(cacheDir, `full_preview_${Date.now()}.mp4`);

    // Write concat list
    const listContent = sortedChunks
      .map(c => `file '${c.filePath!.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listPath, listContent);

    // Run ffmpeg concat
    const ffmpegPath = this.getFFmpegPath();

    return new Promise((resolve) => {
      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy', // No re-encoding, just copy streams
        outputPath,
      ];

      const proc = spawn(ffmpegPath, args);
      let stderr = '';

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        // Clean up list file
        try {
          fs.unlinkSync(listPath);
        } catch { /* ignore */ }

        // Clean up old preview files
        this.cleanupOldPreviews(outputPath);

        if (code === 0 && fs.existsSync(outputPath)) {
          this.fullPreviewPath = outputPath;
          this.fullPreviewReady = true;
          resolve(outputPath);
        } else {
          console.error('[SimplePreview] Concat failed:', stderr);
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        console.error('[SimplePreview] Concat error:', err);
        resolve(null);
      });
    });
  }

  /**
   * Clean up old preview files
   */
  private cleanupOldPreviews(keepPath: string): void {
    const cacheDir = this.getPreviewCacheDir();
    try {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        if (file.startsWith('full_preview_') && file.endsWith('.mp4')) {
          const fullPath = path.join(cacheDir, file);
          if (fullPath !== keepPath) {
            try {
              fs.unlinkSync(fullPath);
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Handle timeline edit - invalidate affected chunks
   */
  async onTimelineEdit(
    timeline: Timeline,
    media: MediaItem[],
    settings: ProjectSettings,
    duration: number
  ): Promise<void> {
    if (!this.isInitialized) return;

    // Compute new hash
    const newHash = this.computeTimelineHash();

    // If nothing changed, skip
    if (newHash === this.lastTimelineHash) {
      return;
    }

    this.lastTimelineHash = newHash;

    // Update stored state
    this.timeline = timeline;
    this.media = media;
    this.settings = settings;
    this.duration = duration;

    // Cancel any in-progress renders
    this.renderer.cancelAll();

    // Re-initialize cache (this will detect which chunks are stale)
    this.chunks = await this.cache.initialize(timeline, media, settings, duration, this.projectPath);

    // Mark all chunks as complex
    for (const chunk of this.chunks) {
      chunk.isComplex = true;
    }

    // Update renderer
    if (this.mainWindow) {
      this.renderer.initialize(timeline, media, settings, this.mainWindow);
    }

    // Invalidate full preview
    this.fullPreviewReady = false;
    this.isRendering = false;

    this.sendStateUpdate();
  }

  /**
   * Force invalidate a time range
   */
  invalidateRange(startTime: number, endTime: number): void {
    const invalidatedIndices = this.cache.invalidateRange(startTime, endTime);

    for (const idx of invalidatedIndices) {
      const chunk = this.chunks.find(c => c.index === idx);
      if (chunk) {
        chunk.status = 'missing';
        chunk.filePath = null;
      }
    }

    this.fullPreviewReady = false;
    this.sendStateUpdate();
  }

  /**
   * Clear all cache and reset
   */
  async clearCache(): Promise<void> {
    this.renderer.cancelAll();
    await this.cache.clearAll();

    for (const chunk of this.chunks) {
      chunk.status = 'missing';
      chunk.filePath = null;
    }

    this.fullPreviewReady = false;
    this.fullPreviewPath = null;
    this.isRendering = false;

    // Delete full preview files
    const cacheDir = this.getPreviewCacheDir();
    try {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        if (file.startsWith('full_preview_')) {
          try {
            fs.unlinkSync(path.join(cacheDir, file));
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    this.sendStateUpdate();
  }

  /**
   * Get current state
   */
  getState(): SimplePreviewState {
    const chunksReady = this.chunks.filter(c => c.status === 'valid').length;
    const totalChunks = this.chunks.length;
    const progress = totalChunks > 0 ? (chunksReady / totalChunks) * 100 : 0;

    return {
      isInitialized: this.isInitialized,
      isRendering: this.isRendering,
      progress,
      fullPreviewPath: this.fullPreviewPath,
      fullPreviewReady: this.fullPreviewReady,
      chunks: this.chunks,
      error: null,
    };
  }

  /**
   * Get full preview path if ready
   */
  getFullPreviewPath(): string | null {
    if (this.fullPreviewReady && this.fullPreviewPath && fs.existsSync(this.fullPreviewPath)) {
      return this.fullPreviewPath;
    }
    return null;
  }

  /**
   * Check if preview is ready
   */
  isPreviewReady(): boolean {
    return this.fullPreviewReady && this.fullPreviewPath !== null && fs.existsSync(this.fullPreviewPath);
  }

  /**
   * Send state update to renderer
   */
  private sendStateUpdate(): void {
    if (!this.mainWindow) return;

    const state = this.getState();
    this.mainWindow.webContents.send('simplePreview:stateUpdate', state);
  }

  /**
   * Send progress update to renderer
   */
  private sendProgressUpdate(): void {
    if (!this.mainWindow) return;

    const chunksReady = this.chunks.filter(c => c.status === 'valid').length;
    const totalChunks = this.chunks.length;
    const progress = totalChunks > 0 ? (chunksReady / totalChunks) * 100 : 0;

    this.mainWindow.webContents.send('simplePreview:progress', {
      progress,
      chunksReady,
      totalChunks,
      isRendering: this.isRendering,
    });
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.renderer.dispose();
    this.timeline = null;
    this.media = [];
    this.settings = null;
    this.mainWindow = null;
    this.isInitialized = false;
  }
}

// Singleton
let instance: SimplePreviewEngine | null = null;

export function getSimplePreviewEngine(): SimplePreviewEngine {
  if (!instance) {
    instance = new SimplePreviewEngine();
  }
  return instance;
}

export function disposeSimplePreviewEngine(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
