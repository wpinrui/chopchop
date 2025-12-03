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

// Extraction request with priority
interface ExtractionRequest {
  time: number;
  priority: 'high' | 'normal' | 'low';
  resolve: (frame: ExtractedFrame | null) => void;
  process?: ChildProcess;
  cancelled?: boolean;
}

const MAX_CONCURRENT_EXTRACTIONS = 3;

export class FrameExtractor {
  private frameCache: Map<string, CachedFrame> = new Map();
  private maxCacheSize: number;
  private activeProcess: ChildProcess | null = null;
  private timeline: Timeline | null = null;
  private media: MediaItem[] = [];
  private settings: ProjectSettings | null = null;
  private frameRate: number = 30; // Default, updated on initialize

  // Extraction queue for smarter scrub handling
  private extractionQueue: ExtractionRequest[] = [];
  private activeExtractions: ExtractionRequest[] = [];
  private lastCompletedFrame: ExtractedFrame | null = null;

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
    this.frameRate = settings.frameRate;
    // Don't clear cache on re-init - frames may still be valid
  }

  /**
   * Invalidate cached frames in a time range
   */
  invalidateRange(startTime: number, endTime: number): void {
    // Convert time range to frame range
    const startFrame = Math.floor(startTime * this.frameRate);
    const endFrame = Math.ceil(endTime * this.frameRate);

    // Delete all frames in this range
    for (let frame = startFrame; frame <= endFrame; frame++) {
      const key = `frame-${frame}`;
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
   * Uses priority queue to avoid cancelling useful in-flight extractions
   */
  async extractFrame(time: number, priority: 'high' | 'normal' | 'low' = 'high'): Promise<ExtractedFrame | null> {
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

    // Check if already being extracted
    const existingRequest = this.activeExtractions.find(
      (r) => this.getCacheKey(r.time) === cacheKey
    );
    if (existingRequest) {
      // Wait for existing extraction by creating a promise that resolves with the cached result
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const cached = this.frameCache.get(cacheKey);
          if (cached) {
            clearInterval(checkInterval);
            resolve(cached.frame);
          }
        }, 16);
        // Timeout after 500ms
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(this.lastCompletedFrame);
        }, 500);
      });
    }

    // Create extraction request
    return new Promise((resolve) => {
      const request: ExtractionRequest = {
        time,
        priority,
        resolve,
      };

      // If we have room, start immediately
      if (this.activeExtractions.length < MAX_CONCURRENT_EXTRACTIONS) {
        this.startExtraction(request);
      } else {
        // Queue is full - cancel lowest priority if this is higher priority
        const lowestPriority = this.findLowestPriorityActive();
        if (lowestPriority && this.isPriorityHigher(priority, lowestPriority.priority)) {
          this.cancelRequest(lowestPriority);
          this.startExtraction(request);
        } else {
          // Add to queue, will be processed when slot opens
          this.extractionQueue.push(request);
          // Also resolve with last completed frame to show something immediately
          if (this.lastCompletedFrame) {
            // Don't resolve yet - wait for actual extraction
          }
        }
      }
    });
  }

  /**
   * Start an extraction request
   */
  private async startExtraction(request: ExtractionRequest): Promise<void> {
    this.activeExtractions.push(request);

    const complexity = isTimePointComplex(this.timeline!, request.time);
    let frame: ExtractedFrame | null;

    if (complexity.isComplex) {
      frame = await this.extractCompositeFrameWithRequest(request);
    } else {
      frame = await this.extractSingleFrameWithRequest(request);
    }

    // Remove from active
    const idx = this.activeExtractions.indexOf(request);
    if (idx !== -1) {
      this.activeExtractions.splice(idx, 1);
    }

    // If cancelled, don't cache or resolve
    if (request.cancelled) {
      request.resolve(this.lastCompletedFrame);
      this.processQueue();
      return;
    }

    // Cache and resolve
    if (frame) {
      const cacheKey = this.getCacheKey(request.time);
      this.addToCache(cacheKey, request.time, frame);
      this.lastCompletedFrame = frame;
    }

    request.resolve(frame);

    // Process next in queue
    this.processQueue();
  }

  /**
   * Process the next item in the extraction queue
   */
  private processQueue(): void {
    if (this.extractionQueue.length === 0) return;
    if (this.activeExtractions.length >= MAX_CONCURRENT_EXTRACTIONS) return;

    // Sort by priority and get highest
    this.extractionQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    const next = this.extractionQueue.shift();
    if (next) {
      this.startExtraction(next);
    }
  }

  /**
   * Find the lowest priority active extraction
   */
  private findLowestPriorityActive(): ExtractionRequest | null {
    if (this.activeExtractions.length === 0) return null;

    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return this.activeExtractions.reduce((lowest, current) =>
      priorityOrder[current.priority] > priorityOrder[lowest.priority] ? current : lowest
    );
  }

  /**
   * Check if priority a is higher than priority b
   */
  private isPriorityHigher(a: 'high' | 'normal' | 'low', b: 'high' | 'normal' | 'low'): boolean {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return priorityOrder[a] < priorityOrder[b];
  }

  /**
   * Cancel a specific extraction request
   */
  private cancelRequest(request: ExtractionRequest): void {
    request.cancelled = true;
    if (request.process) {
      request.process.kill('SIGTERM');
    }
  }

  /**
   * Get the most recently completed frame (for immediate display during extraction)
   */
  getLastCompletedFrame(): ExtractedFrame | null {
    return this.lastCompletedFrame;
  }

  /**
   * Extract frame from a single source file (with request tracking for cancellation)
   */
  private async extractSingleFrameWithRequest(request: ExtractionRequest): Promise<ExtractedFrame | null> {
    if (!this.timeline || !this.settings) return null;

    const time = request.time;
    const clipInfo = getSingleClipAtTime(this.timeline, time);

    if (!clipInfo) {
      return this.generateBlackFrame();
    }

    const { clip } = clipInfo;
    const mediaItem = this.media.find((m) => m.id === clip.mediaId);

    if (!mediaItem) {
      return this.generateBlackFrame();
    }

    const mediaTime = clip.mediaIn + (time - clip.timelineStart);
    const sourcePath = mediaItem.path;
    const [width, height] = this.settings.resolution;

    return new Promise((resolve) => {
      const args = [
        '-ss', String(mediaTime),
        '-i', sourcePath,
        '-vframes', '1',
        '-vf', `pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,format=rgba`,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        'pipe:1',
      ];

      const ffmpegPath = this.getFFmpegPath();
      const proc = spawn(ffmpegPath, args);
      request.process = proc;
      this.activeProcess = proc;

      const chunks: Buffer[] = [];

      proc.stdout?.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      proc.stderr?.on('data', () => {
        // Suppress stderr
      });

      proc.on('error', (error) => {
        console.error('[FrameExtractor] Process error:', error);
        this.activeProcess = null;
        resolve(null);
      });

      proc.on('close', (code) => {
        this.activeProcess = null;

        if (request.cancelled) {
          resolve(null);
          return;
        }

        if (code === 0 && chunks.length > 0) {
          const data = Buffer.concat(chunks);
          resolve({ time, width, height, data });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Extract and composite frame from multiple clips (with request tracking)
   */
  private async extractCompositeFrameWithRequest(request: ExtractionRequest): Promise<ExtractedFrame | null> {
    if (!this.timeline || !this.settings) return null;

    const time = request.time;
    const [width, height] = this.settings.resolution;
    const clipsAtTime = this.getClipsAtTime(time);

    if (clipsAtTime.length === 0) {
      return this.generateBlackFrame();
    }

    const inputs: string[] = [];
    const filterParts: string[] = [];

    for (let i = 0; i < clipsAtTime.length; i++) {
      const { media, mediaTime } = clipsAtTime[i];
      inputs.push('-ss', String(mediaTime), '-i', media.path);
    }

    filterParts.push(`color=c=black:s=${width}x${height}:d=0.04[base]`);

    let currentBase = 'base';
    for (let i = 0; i < clipsAtTime.length; i++) {
      const clipLabel = `clip${i}`;
      const outputLabel = i === clipsAtTime.length - 1 ? 'out' : `comp${i}`;

      filterParts.push(
        `[${i}:v]pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,` +
        `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
        `format=yuva420p[${clipLabel}]`
      );

      filterParts.push(
        `[${currentBase}][${clipLabel}]overlay=format=auto[${outputLabel}]`
      );

      currentBase = outputLabel;
    }

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
      const proc = spawn(ffmpegPath, args);
      request.process = proc;
      this.activeProcess = proc;

      const chunks: Buffer[] = [];

      proc.stdout?.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      proc.stderr?.on('data', () => {
        // Suppress stderr
      });

      proc.on('error', (error) => {
        console.error('[FrameExtractor] Composite error:', error);
        this.activeProcess = null;
        resolve(null);
      });

      proc.on('close', (code) => {
        this.activeProcess = null;

        if (request.cancelled) {
          resolve(null);
          return;
        }

        if (code === 0 && chunks.length > 0) {
          const data = Buffer.concat(chunks);
          resolve({ time, width, height, data });
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
   * Cancel all ongoing extractions and clear the queue
   */
  cancelExtraction(): void {
    // Cancel all active extractions
    for (const request of this.activeExtractions) {
      request.cancelled = true;
      if (request.process) {
        request.process.kill('SIGTERM');
      }
    }
    this.activeExtractions = [];

    // Clear the queue (resolve with null)
    for (const request of this.extractionQueue) {
      request.resolve(this.lastCompletedFrame);
    }
    this.extractionQueue = [];

    // Legacy single process cleanup
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }
  }

  /**
   * Get cache key for a time
   * Uses frame number to avoid duplicate cache entries for the same visual frame
   */
  private getCacheKey(time: number): string {
    // Round to nearest frame to avoid duplicate entries for same visual frame
    const frameNumber = Math.round(time * this.frameRate);
    return `frame-${frameNumber}`;
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
   * Prefetch frames around a time for smoother scrubbing/reverse playback
   * Uses low priority so it doesn't block current frame extraction
   */
  async prefetchFrames(centerTime: number, count: number = 5, direction: -1 | 1 = 1): Promise<void> {
    if (!this.settings) return;

    const frameInterval = 1 / this.frameRate;
    const times: number[] = [];

    // Prefetch frames in the given direction (or both if direction not specified)
    if (direction === 1) {
      // Forward - prefetch ahead
      for (let i = 1; i <= count; i++) {
        const t = centerTime + i * frameInterval;
        if (t >= 0) times.push(t);
      }
    } else {
      // Backward - prefetch behind
      for (let i = 1; i <= count; i++) {
        const t = centerTime - i * frameInterval;
        if (t >= 0) times.push(t);
      }
    }

    // Queue extraction with low priority
    for (const t of times) {
      const cacheKey = this.getCacheKey(t);
      if (!this.frameCache.has(cacheKey)) {
        // Use low priority so current frame takes precedence
        this.extractFrame(t, 'low').catch(() => {});
      }
    }
  }

  /**
   * Get the number of frames currently cached
   */
  getCacheSize(): number {
    return this.frameCache.size;
  }
}
