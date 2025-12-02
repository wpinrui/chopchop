/**
 * Frame Extractor
 *
 * Extracts individual frames from source files for scrub/pause display.
 * Supports both single-clip extraction and multi-clip compositing.
 *
 * Target latency: <150ms per frame
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import { app } from 'electron';
import type {
  Timeline,
  MediaItem,
  Clip,
  ClipAtTime,
  ExtractedFrame,
  ProjectSettings,
} from './types';
import { getSingleClipAtTime, isTimePointComplex } from './complexityDetector';

// LRU cache for extracted frames
interface CachedFrame {
  time: number;
  frame: ExtractedFrame;
  timestamp: number;
}

export class FrameExtractor {
  private frameCache: Map<string, CachedFrame> = new Map();
  private maxCacheSize: number;
  private activeProcess: ChildProcess | null = null;
  private timeline: Timeline | null = null;
  private media: MediaItem[] = [];
  private settings: ProjectSettings | null = null;

  constructor(maxCacheSize: number = 30) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Get path to ffmpeg executable
   */
  private getFFmpegPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
    } else {
      return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe');
    }
  }

  /**
   * Initialize with timeline context
   */
  initialize(timeline: Timeline, media: MediaItem[], settings: ProjectSettings): void {
    this.timeline = timeline;
    this.media = media;
    this.settings = settings;
    // Don't clear cache on re-init - frames may still be valid
  }

  /**
   * Invalidate cached frames in a time range
   */
  invalidateRange(startTime: number, endTime: number): void {
    const keysToDelete: string[] = [];

    for (const [key, cached] of this.frameCache) {
      if (cached.time >= startTime && cached.time <= endTime) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.frameCache.delete(key);
    }
  }

  /**
   * Clear all cached frames
   */
  clearCache(): void {
    this.frameCache.clear();
  }

  /**
   * Extract a frame at the given timeline time
   */
  async extractFrame(time: number): Promise<ExtractedFrame | null> {
    if (!this.timeline || !this.settings) {
      console.error('[FrameExtractor] Not initialized');
      return null;
    }

    // Check cache first
    const cacheKey = this.getCacheKey(time);
    const cached = this.frameCache.get(cacheKey);
    if (cached) {
      return cached.frame;
    }

    // Cancel any ongoing extraction
    this.cancelExtraction();

    // Determine if this is a simple or complex frame
    const complexity = isTimePointComplex(this.timeline, time);

    let frame: ExtractedFrame | null;

    if (complexity.isComplex) {
      // Multiple clips or effects - need compositing
      frame = await this.extractCompositeFrame(time);
    } else {
      // Single clip - direct extraction
      frame = await this.extractSingleFrame(time);
    }

    if (frame) {
      this.addToCache(cacheKey, time, frame);
    }

    return frame;
  }

  /**
   * Extract frame from a single source file
   */
  private async extractSingleFrame(time: number): Promise<ExtractedFrame | null> {
    if (!this.timeline || !this.settings) return null;

    const clipInfo = getSingleClipAtTime(this.timeline, time);

    if (!clipInfo) {
      // No clip at this time - return black frame
      return this.generateBlackFrame();
    }

    const { clip } = clipInfo;
    const mediaItem = this.media.find((m) => m.id === clip.mediaId);

    if (!mediaItem) {
      return this.generateBlackFrame();
    }

    // Calculate the time within the source media
    const mediaTime = clip.mediaIn + (time - clip.timelineStart);

    // Use source file for full quality (not proxy)
    const sourcePath = mediaItem.path;
    const [width, height] = this.settings.resolution;

    return new Promise((resolve) => {
      const args = [
        '-ss', String(mediaTime),
        '-i', sourcePath,
        '-vframes', '1',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=rgba`,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        'pipe:1',
      ];

      const ffmpegPath = this.getFFmpegPath();
      const process = spawn(ffmpegPath, args);
      this.activeProcess = process;

      const chunks: Buffer[] = [];

      process.stdout?.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      process.stderr?.on('data', (data) => {
        // Suppress stderr unless debugging
        // console.log('[FrameExtractor]', data.toString());
      });

      process.on('error', (error) => {
        console.error('[FrameExtractor] Process error:', error);
        this.activeProcess = null;
        resolve(null);
      });

      process.on('close', (code) => {
        this.activeProcess = null;

        if (code === 0 && chunks.length > 0) {
          const data = Buffer.concat(chunks);
          resolve({
            time,
            width,
            height,
            data,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Extract and composite frame from multiple clips
   */
  private async extractCompositeFrame(time: number): Promise<ExtractedFrame | null> {
    if (!this.timeline || !this.settings) return null;

    const [width, height] = this.settings.resolution;

    // Gather all clips at this time
    const clipsAtTime = this.getClipsAtTime(time);

    if (clipsAtTime.length === 0) {
      return this.generateBlackFrame();
    }

    // Build ffmpeg command with filter_complex for compositing
    const inputs: string[] = [];
    const filterParts: string[] = [];

    // Add inputs
    for (let i = 0; i < clipsAtTime.length; i++) {
      const { media, mediaTime } = clipsAtTime[i];
      // Use source file for full quality
      inputs.push('-ss', String(mediaTime), '-i', media.path);
    }

    // Build filter graph
    // Create black base
    filterParts.push(`color=c=black:s=${width}x${height}:d=0.04[base]`);

    let currentBase = 'base';
    for (let i = 0; i < clipsAtTime.length; i++) {
      const clipLabel = `clip${i}`;
      const outputLabel = i === clipsAtTime.length - 1 ? 'out' : `comp${i}`;

      // Scale and pad each input
      filterParts.push(
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
        `format=yuva420p[${clipLabel}]`
      );

      // Overlay onto base
      filterParts.push(
        `[${currentBase}][${clipLabel}]overlay=format=auto[${outputLabel}]`
      );

      currentBase = outputLabel;
    }

    // Convert to RGBA for output
    filterParts.push(`[out]format=rgba[final]`);

    const filterComplex = filterParts.join(';');

    return new Promise((resolve) => {
      const args = [
        ...inputs,
        '-filter_complex', filterComplex,
        '-map', '[final]',
        '-vframes', '1',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        'pipe:1',
      ];

      const ffmpegPath = this.getFFmpegPath();
      const process = spawn(ffmpegPath, args);
      this.activeProcess = process;

      const chunks: Buffer[] = [];

      process.stdout?.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      process.stderr?.on('data', () => {
        // Suppress stderr
      });

      process.on('error', (error) => {
        console.error('[FrameExtractor] Composite error:', error);
        this.activeProcess = null;
        resolve(null);
      });

      process.on('close', (code) => {
        this.activeProcess = null;

        if (code === 0 && chunks.length > 0) {
          const data = Buffer.concat(chunks);
          resolve({
            time,
            width,
            height,
            data,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Get all clips at a specific time, sorted by track order (bottom to top)
   */
  private getClipsAtTime(time: number): ClipAtTime[] {
    if (!this.timeline) return [];

    const result: ClipAtTime[] = [];

    // Get video tracks in correct order (bottom tracks first for compositing)
    const videoTracks = this.timeline.tracks
      .filter((t) => t.type === 'video' && t.visible !== false)
      .reverse(); // Reverse so index 0 is bottom track

    for (let trackIndex = 0; trackIndex < videoTracks.length; trackIndex++) {
      const track = videoTracks[trackIndex];

      for (const clip of track.clips) {
        if (!clip.enabled) continue;

        const clipStart = clip.timelineStart;
        const clipEnd = clip.timelineStart + clip.duration;

        if (time >= clipStart && time < clipEnd) {
          const mediaItem = this.media.find((m) => m.id === clip.mediaId);
          if (mediaItem) {
            const mediaTime = clip.mediaIn + (time - clipStart);
            result.push({
              clip,
              media: mediaItem,
              mediaTime,
              trackIndex,
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Generate a black frame
   */
  private async generateBlackFrame(): Promise<ExtractedFrame> {
    if (!this.settings) {
      return { time: 0, width: 1920, height: 1080, data: Buffer.alloc(1920 * 1080 * 4) };
    }

    const [width, height] = this.settings.resolution;
    const data = Buffer.alloc(width * height * 4, 0); // All zeros = black with 0 alpha

    // Set alpha to 255 for all pixels
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255;
    }

    return {
      time: 0,
      width,
      height,
      data,
    };
  }

  /**
   * Cancel ongoing extraction
   */
  cancelExtraction(): void {
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }
  }

  /**
   * Get cache key for a time
   */
  private getCacheKey(time: number): string {
    // Round to nearest millisecond for cache key
    return `frame-${Math.round(time * 1000)}`;
  }

  /**
   * Add frame to cache with LRU eviction
   */
  private addToCache(key: string, time: number, frame: ExtractedFrame): void {
    // Evict oldest entries if cache is full
    while (this.frameCache.size >= this.maxCacheSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.frameCache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.frameCache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.frameCache.set(key, {
      time,
      frame,
      timestamp: Date.now(),
    });
  }

  /**
   * Prefetch frames around a time for smoother scrubbing
   */
  async prefetchFrames(centerTime: number, count: number = 5): Promise<void> {
    if (!this.settings) return;

    const frameInterval = 1 / this.settings.frameRate;
    const times: number[] = [];

    // Prefetch frames before and after
    for (let i = -count; i <= count; i++) {
      if (i === 0) continue; // Skip center, already extracting that
      const t = centerTime + i * frameInterval;
      if (t >= 0) {
        times.push(t);
      }
    }

    // Extract in parallel (but don't wait for all)
    for (const t of times) {
      const cacheKey = this.getCacheKey(t);
      if (!this.frameCache.has(cacheKey)) {
        // Fire and forget - don't await
        this.extractFrame(t).catch(() => {});
      }
    }
  }
}
