/**
 * Preview Engine
 *
 * Main controller for the hybrid preview system.
 * Coordinates between:
 * - ChunkCache: Persistent cache management
 * - ChunkRenderer: Background rendering of complex chunks
 * - FrameExtractor: Single frame extraction for scrub/pause
 * - ScrubAudioController: Audio during scrubbing and frame stepping
 *
 * Playback modes:
 * - Simple clips: Real-time decode in renderer (no pre-rendering needed)
 * - Complex segments: Uses pre-rendered chunks
 * - Pause/Scrub: Frame extraction from source files
 */

import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import type {
  Timeline,
  MediaItem,
  ProjectSettings,
  ChunkInfo,
  ChunkStatus,
  PlaybackState,
  ExtractedFrame,
} from './types';
import { ChunkCache } from './ChunkCache';
import { ChunkRenderer } from './ChunkRenderer';
import { FrameExtractor } from './FrameExtractor';
import { ScrubAudioController } from './ScrubAudioController';
import { analyzeTimelineComplexity, isTimePointComplex } from './complexityDetector';

const DEFAULT_CHUNK_DURATION = 2; // seconds
const MAX_CONCURRENT_RENDERS = 2;
const FRAME_CACHE_SIZE = 30;

export class PreviewEngine {
  // Sub-components
  private cache: ChunkCache;
  private renderer: ChunkRenderer;
  private frameExtractor: FrameExtractor;
  private scrubAudio: ScrubAudioController;

  // State
  private timeline: Timeline | null = null;
  private media: MediaItem[] = [];
  private settings: ProjectSettings | null = null;
  private duration: number = 0;
  private projectPath: string | null = null;

  private chunks: ChunkInfo[] = [];
  private playbackState: PlaybackState = 'stopped';
  private currentTime: number = 0;

  private mainWindow: BrowserWindow | null = null;
  private isInitialized: boolean = false;

  constructor() {
    this.cache = new ChunkCache(DEFAULT_CHUNK_DURATION);
    this.renderer = new ChunkRenderer(this.cache, MAX_CONCURRENT_RENDERS, DEFAULT_CHUNK_DURATION);
    this.frameExtractor = new FrameExtractor(FRAME_CACHE_SIZE);
    this.scrubAudio = new ScrubAudioController();

    // Set up callbacks
    this.renderer.setCompleteCallback((result) => {
      this.onChunkRenderComplete(result);
    });
  }

  /**
   * Initialize the preview engine with timeline data
   */
  async initialize(
    timeline: Timeline,
    media: MediaItem[],
    settings: ProjectSettings,
    duration: number,
    projectPath: string | null,
    mainWindow: BrowserWindow
  ): Promise<ChunkInfo[]> {
    this.timeline = timeline;
    this.media = media;
    this.settings = settings;
    this.duration = duration;
    this.projectPath = projectPath;
    this.mainWindow = mainWindow;

    // Initialize sub-components
    this.frameExtractor.initialize(timeline, media, settings);
    this.scrubAudio.initialize(timeline, media, settings, mainWindow);
    this.renderer.initialize(timeline, media, settings, mainWindow);

    // Initialize cache and get chunk status
    this.chunks = await this.cache.initialize(timeline, media, settings, duration, projectPath);

    // Analyze complexity for each chunk
    const complexityMap = analyzeTimelineComplexity(timeline, duration, DEFAULT_CHUNK_DURATION);
    for (let i = 0; i < this.chunks.length && i < complexityMap.length; i++) {
      this.chunks[i].isComplex = complexityMap[i].isComplex;
    }

    // Queue rendering for complex chunks that are missing or stale
    const chunksToRender = this.chunks.filter(
      (c) => c.isComplex && (c.status === 'missing' || c.status === 'stale')
    );

    if (chunksToRender.length > 0) {
      // Prioritize chunks near the beginning
      chunksToRender.sort((a, b) => a.index - b.index);
      this.renderer.queueChunks(chunksToRender, 'normal');
    }

    this.isInitialized = true;

    // Send initial state to renderer
    this.sendChunkStatusUpdate();

    return this.chunks;
  }

  /**
   * Update timeline (called when edits are made)
   */
  async updateTimeline(
    timeline: Timeline,
    media: MediaItem[],
    settings: ProjectSettings,
    duration: number
  ): Promise<void> {
    if (!this.isInitialized) return;

    this.timeline = timeline;
    this.media = media;
    this.settings = settings;
    this.duration = duration;

    // Update sub-components
    this.frameExtractor.initialize(timeline, media, settings);
    if (this.mainWindow) {
      this.scrubAudio.initialize(timeline, media, settings, this.mainWindow);
      this.renderer.initialize(timeline, media, settings, this.mainWindow);
    }

    // Re-validate chunks
    this.chunks = await this.cache.initialize(
      timeline,
      media,
      settings,
      duration,
      this.projectPath
    );

    // Analyze complexity
    const complexityMap = analyzeTimelineComplexity(timeline, duration, DEFAULT_CHUNK_DURATION);
    for (let i = 0; i < this.chunks.length && i < complexityMap.length; i++) {
      this.chunks[i].isComplex = complexityMap[i].isComplex;
    }

    // Cancel current renders and re-queue
    this.renderer.cancelAll();

    const chunksToRender = this.chunks.filter(
      (c) => c.isComplex && (c.status === 'missing' || c.status === 'stale')
    );

    if (chunksToRender.length > 0) {
      chunksToRender.sort((a, b) => a.index - b.index);
      this.renderer.queueChunks(chunksToRender, 'normal');
    }

    // Clear frame cache for affected areas
    this.frameExtractor.clearCache();

    this.sendChunkStatusUpdate();
  }

  /**
   * Invalidate chunks in a time range (called after edits)
   */
  invalidateRange(startTime: number, endTime: number): void {
    const invalidatedIndices = this.cache.invalidateRange(startTime, endTime);

    // Update local chunk info
    for (const idx of invalidatedIndices) {
      const chunk = this.chunks.find((c) => c.index === idx);
      if (chunk) {
        chunk.status = 'missing';
        chunk.filePath = null;
      }
    }

    // Clear frame cache for this range
    this.frameExtractor.invalidateRange(startTime, endTime);

    // Queue re-rendering
    const chunksToRender = this.chunks.filter(
      (c) => invalidatedIndices.includes(c.index) && c.isComplex
    );

    if (chunksToRender.length > 0) {
      this.renderer.queueChunks(chunksToRender, 'high');
    }

    this.sendChunkStatusUpdate();
  }

  /**
   * Extract a single frame (for scrub/pause)
   */
  async extractFrame(time: number): Promise<ExtractedFrame | null> {
    // Update currentTime so frameStep uses the correct position
    this.currentTime = time;
    return this.frameExtractor.extractFrame(time);
  }

  /**
   * Prefetch frames around a time for smoother playback
   */
  prefetchFrames(centerTime: number, count: number = 5, direction: -1 | 1 = 1): void {
    this.frameExtractor.prefetchFrames(centerTime, count, direction);
  }

  /**
   * Start scrub mode
   */
  startScrub(time: number): void {
    this.playbackState = 'scrubbing';
    this.currentTime = time;
    this.scrubAudio.startScrub(time);
  }

  /**
   * Update scrub position
   */
  async updateScrub(time: number, velocity: number): Promise<ExtractedFrame | null> {
    this.currentTime = time;

    // Update audio
    await this.scrubAudio.updateScrub(time, velocity);

    // Extract frame
    return this.frameExtractor.extractFrame(time);
  }

  /**
   * End scrub mode
   */
  endScrub(): void {
    this.playbackState = 'paused';
    this.scrubAudio.stopScrub();
  }

  /**
   * Step one frame and play its audio
   * @param direction -1 for previous frame, 1 for next frame
   * @param frameRate Frame rate from sequence settings (passed from renderer)
   */
  async frameStep(direction: -1 | 1, frameRate: number): Promise<ExtractedFrame | null> {
    if (!this.settings) return null;

    const frameInterval = 1 / frameRate;
    this.currentTime += direction * frameInterval;

    // Clamp to valid range
    this.currentTime = Math.max(0, Math.min(this.duration, this.currentTime));

    // Play frame audio
    await this.scrubAudio.playFrameAudio(this.currentTime);

    // Extract and return frame
    return this.frameExtractor.extractFrame(this.currentTime);
  }

  /**
   * Get playback info for a specific time
   * Returns whether to use real-time decode or cached chunk
   */
  getPlaybackInfo(time: number): {
    mode: 'realtime' | 'chunk';
    chunkPath: string | null;
    chunkStartTime: number;
    isComplex: boolean;
  } {
    const chunkIndex = Math.floor(time / DEFAULT_CHUNK_DURATION);
    const chunk = this.chunks[chunkIndex];

    if (!chunk) {
      return {
        mode: 'realtime',
        chunkPath: null,
        chunkStartTime: 0,
        isComplex: false,
      };
    }

    // If chunk is complex and we have a cached file, use it
    if (chunk.isComplex && chunk.status === 'valid' && chunk.filePath) {
      return {
        mode: 'chunk',
        chunkPath: chunk.filePath,
        chunkStartTime: chunk.startTime,
        isComplex: true,
      };
    }

    // Otherwise, use real-time decode
    return {
      mode: 'realtime',
      chunkPath: null,
      chunkStartTime: chunk.startTime,
      isComplex: chunk.isComplex,
    };
  }

  /**
   * Get clip info for real-time playback at a time
   * Used when renderer needs to play directly from source
   */
  getClipAtTime(time: number): {
    mediaPath: string;
    mediaTime: number;
    hasClip: boolean;
  } | null {
    if (!this.timeline) return null;

    // Get visible video tracks (top to bottom)
    const videoTracks = this.timeline.tracks
      .filter((t) => t.type === 'video' && t.visible !== false);

    // Find topmost clip at this time
    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const track = videoTracks[i];

      for (const clip of track.clips) {
        if (!clip.enabled) continue;

        const clipStart = clip.timelineStart;
        const clipEnd = clip.timelineStart + clip.duration;

        if (time >= clipStart && time < clipEnd) {
          const mediaItem = this.media.find((m) => m.id === clip.mediaId);
          if (mediaItem) {
            const mediaTime = clip.mediaIn + (time - clipStart);
            // Use proxy for playback if available and exists
            const mediaPath = mediaItem.proxyPath && fs.existsSync(mediaItem.proxyPath)
              ? mediaItem.proxyPath
              : mediaItem.path;
            return {
              mediaPath,
              mediaTime,
              hasClip: true,
            };
          }
        }
      }
    }

    return { mediaPath: '', mediaTime: 0, hasClip: false };
  }

  /**
   * Prioritize rendering chunks near a time (called when playhead moves)
   */
  prioritizeChunksNear(time: number): void {
    const currentChunkIndex = Math.floor(time / DEFAULT_CHUNK_DURATION);

    // Get chunks that need rendering within 5 chunks of current position
    const nearbyChunks = this.chunks.filter((c) => {
      const distance = Math.abs(c.index - currentChunkIndex);
      return (
        distance <= 5 &&
        c.isComplex &&
        (c.status === 'missing' || c.status === 'stale')
      );
    });

    // Sort by distance from current position
    nearbyChunks.sort(
      (a, b) =>
        Math.abs(a.index - currentChunkIndex) -
        Math.abs(b.index - currentChunkIndex)
    );

    // Queue with high priority
    for (const chunk of nearbyChunks) {
      this.renderer.queueChunk(chunk, 'high');
    }
  }

  /**
   * Clear all cache
   */
  async clearCache(): Promise<void> {
    // Cancel all renders
    this.renderer.cancelAll();

    // Clear caches
    await this.cache.clearAll();
    this.frameExtractor.clearCache();

    // Reset chunk status
    for (const chunk of this.chunks) {
      chunk.status = 'missing';
      chunk.filePath = null;
    }

    this.sendChunkStatusUpdate();

    // Re-queue complex chunks
    const chunksToRender = this.chunks.filter((c) => c.isComplex);
    if (chunksToRender.length > 0) {
      this.renderer.queueChunks(chunksToRender, 'normal');
    }
  }

  /**
   * Get current chunk status
   */
  getChunks(): ChunkInfo[] {
    return this.chunks;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { totalChunks: number; cachedChunks: number; totalSize: number } {
    return this.cache.getStats();
  }

  /**
   * Handle chunk render completion
   */
  private onChunkRenderComplete(result: {
    chunkIndex: number;
    success: boolean;
    filePath: string | null;
    error?: string;
  }): void {
    const chunk = this.chunks.find((c) => c.index === result.chunkIndex);
    if (!chunk) return;

    if (result.success && result.filePath) {
      chunk.status = 'valid';
      chunk.filePath = result.filePath;
    } else {
      chunk.status = 'error';
      chunk.error = result.error;
    }

    this.sendChunkStatusUpdate();
  }

  /**
   * Send chunk status update to renderer
   */
  private sendChunkStatusUpdate(): void {
    if (!this.mainWindow) return;

    const statusList = this.chunks.map((c) => ({
      index: c.index,
      startTime: c.startTime,
      endTime: c.endTime,
      status: c.status,
      filePath: c.filePath,
      isComplex: c.isComplex,
    }));

    this.mainWindow.webContents.send('preview:chunksUpdate', statusList);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.renderer.dispose();
    this.scrubAudio.dispose();
    this.frameExtractor.cancelExtraction();

    this.timeline = null;
    this.media = [];
    this.settings = null;
    this.mainWindow = null;
    this.isInitialized = false;
  }
}

// Singleton instance
let previewEngineInstance: PreviewEngine | null = null;

export function getPreviewEngine(): PreviewEngine {
  if (!previewEngineInstance) {
    previewEngineInstance = new PreviewEngine();
  }
  return previewEngineInstance;
}

export function disposePreviewEngine(): void {
  if (previewEngineInstance) {
    previewEngineInstance.dispose();
    previewEngineInstance = null;
  }
}
