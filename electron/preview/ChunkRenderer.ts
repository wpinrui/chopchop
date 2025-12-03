/**
 * Chunk Renderer
 *
 * Background renderer for complex timeline chunks.
 * Manages a render queue with priorities and concurrent render limits.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow } from 'electron';
import type {
  Timeline,
  MediaItem,
  Clip,
  Track,
  ProjectSettings,
  ChunkInfo,
  RenderTask,
  RenderPriority,
} from './types';
import { ChunkCache } from './ChunkCache';

export interface ChunkRenderProgress {
  chunkIndex: number;
  percent: number;
  fps?: number;
}

export interface ChunkRenderResult {
  chunkIndex: number;
  success: boolean;
  filePath: string | null;
  error?: string;
}

export class ChunkRenderer {
  private timeline: Timeline | null = null;
  private media: MediaItem[] = [];
  private settings: ProjectSettings | null = null;
  private cache: ChunkCache;
  private mainWindow: BrowserWindow | null = null;

  private renderQueue: RenderTask[] = [];
  private activeRenders: Map<number, ChildProcess> = new Map();
  private maxConcurrentRenders: number;
  private chunkDuration: number;

  private onProgress?: (progress: ChunkRenderProgress) => void;
  private onComplete?: (result: ChunkRenderResult) => void;

  constructor(
    cache: ChunkCache,
    maxConcurrentRenders: number = 2,
    chunkDuration: number = 2
  ) {
    this.cache = cache;
    this.maxConcurrentRenders = maxConcurrentRenders;
    this.chunkDuration = chunkDuration;
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
  initialize(
    timeline: Timeline,
    media: MediaItem[],
    settings: ProjectSettings,
    mainWindow: BrowserWindow
  ): void {
    this.timeline = timeline;
    this.media = media;
    this.settings = settings;
    this.mainWindow = mainWindow;
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: (progress: ChunkRenderProgress) => void): void {
    this.onProgress = callback;
  }

  /**
   * Set completion callback
   */
  setCompleteCallback(callback: (result: ChunkRenderResult) => void): void {
    this.onComplete = callback;
  }

  /**
   * Queue a chunk for rendering
   */
  queueChunk(chunk: ChunkInfo, priority: RenderPriority = 'normal'): void {
    // Don't queue if already rendering or queued
    if (this.activeRenders.has(chunk.index)) {
      return;
    }
    if (this.renderQueue.some((t) => t.chunkIndex === chunk.index)) {
      return;
    }

    const task: RenderTask = {
      chunkIndex: chunk.index,
      priority,
      queuedAt: Date.now(),
    };

    // Insert based on priority
    if (priority === 'high') {
      this.renderQueue.unshift(task);
    } else if (priority === 'low') {
      this.renderQueue.push(task);
    } else {
      // Normal priority - insert after high, before low
      const lowIndex = this.renderQueue.findIndex((t) => t.priority === 'low');
      if (lowIndex >= 0) {
        this.renderQueue.splice(lowIndex, 0, task);
      } else {
        this.renderQueue.push(task);
      }
    }

    this.processQueue();
  }

  /**
   * Queue multiple chunks
   */
  queueChunks(chunks: ChunkInfo[], priority: RenderPriority = 'normal'): void {
    for (const chunk of chunks) {
      this.queueChunk(chunk, priority);
    }
  }

  /**
   * Process the render queue
   */
  private processQueue(): void {
    while (
      this.activeRenders.size < this.maxConcurrentRenders &&
      this.renderQueue.length > 0
    ) {
      const task = this.renderQueue.shift();
      if (task) {
        this.startRender(task.chunkIndex);
      }
    }
  }

  /**
   * Start rendering a chunk
   */
  private async startRender(chunkIndex: number): Promise<void> {
    if (!this.timeline || !this.settings) {
      return;
    }

    const startTime = chunkIndex * this.chunkDuration;
    const endTime = startTime + this.chunkDuration;
    const duration = this.chunkDuration;

    // Compute content hash for this chunk
    const contentHash = this.computeChunkHash(startTime, endTime);
    const outputPath = this.cache.getChunkOutputPath(chunkIndex, contentHash);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build ffmpeg command
    const args = this.buildFFmpegArgs(startTime, endTime, outputPath);

    if (!args) {
      this.onComplete?.({
        chunkIndex,
        success: false,
        filePath: null,
        error: 'Failed to build ffmpeg arguments',
      });
      this.processQueue();
      return;
    }

    // Start ffmpeg process
    const ffmpegPath = this.getFFmpegPath();
    const process = spawn(ffmpegPath, args);
    this.activeRenders.set(chunkIndex, process);

    let stderr = '';

    process.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress
      const progress = this.parseProgress(chunk, duration);
      if (progress) {
        this.onProgress?.({
          chunkIndex,
          percent: progress.percent,
          fps: progress.fps,
        });

        // Send to renderer
        this.mainWindow?.webContents.send('preview:chunkProgress', {
          index: chunkIndex,
          percent: progress.percent,
        });
      }
    });

    process.on('error', (error) => {
      this.activeRenders.delete(chunkIndex);
      this.onComplete?.({
        chunkIndex,
        success: false,
        filePath: null,
        error: error.message,
      });
      this.processQueue();
    });

    process.on('close', (code) => {
      this.activeRenders.delete(chunkIndex);

      if (code === 0) {
        // Register in cache
        this.cache.registerChunk(chunkIndex, contentHash, outputPath, true);

        this.onComplete?.({
          chunkIndex,
          success: true,
          filePath: outputPath,
        });

        // Notify renderer
        this.mainWindow?.webContents.send('preview:chunkStatus', {
          index: chunkIndex,
          status: 'valid',
          filePath: outputPath,
        });
      } else {
        this.onComplete?.({
          chunkIndex,
          success: false,
          filePath: null,
          error: `FFmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        });

        this.mainWindow?.webContents.send('preview:chunkStatus', {
          index: chunkIndex,
          status: 'error',
        });
      }

      this.processQueue();
    });
  }

  /**
   * Build ffmpeg arguments for chunk rendering
   */
  private buildFFmpegArgs(
    startTime: number,
    endTime: number,
    outputPath: string
  ): string[] | null {
    if (!this.timeline || !this.settings) return null;

    const duration = endTime - startTime;
    const [width, height] = this.settings.resolution;
    const fps = this.settings.frameRate;

    // Get video and audio tracks
    const videoTracks = this.timeline.tracks
      .filter((t) => t.type === 'video' && t.visible !== false)
      .reverse();
    const audioTracks = this.timeline.tracks.filter(
      (t) => t.type === 'audio' && !t.muted
    );

    // Collect inputs
    const inputs: Array<{ path: string; mediaId: string; index: number }> = [];
    const mediaIndexMap = new Map<string, number>();

    const getMediaInput = (mediaItem: MediaItem): number => {
      if (mediaIndexMap.has(mediaItem.id)) {
        return mediaIndexMap.get(mediaItem.id)!;
      }
      // Check if proxy file exists before using it
      let mediaPath = mediaItem.path;
      if (mediaItem.proxyPath && fs.existsSync(mediaItem.proxyPath)) {
        mediaPath = mediaItem.proxyPath;
      }
      const idx = inputs.length;
      inputs.push({ path: mediaPath, mediaId: mediaItem.id, index: idx });
      mediaIndexMap.set(mediaItem.id, idx);
      return idx;
    };

    // Gather video clips
    interface VideoClipInfo {
      clip: Clip;
      media: MediaItem;
      inputIndex: number;
      trackIndex: number;
    }

    const videoClips: VideoClipInfo[] = [];

    for (let trackIdx = 0; trackIdx < videoTracks.length; trackIdx++) {
      const track = videoTracks[trackIdx];
      for (const clip of track.clips) {
        if (!clip.enabled) continue;
        const clipEnd = clip.timelineStart + clip.duration;
        if (clip.timelineStart < endTime && clipEnd > startTime) {
          const mediaItem = this.media.find((m) => m.id === clip.mediaId);
          if (mediaItem) {
            const inputIndex = getMediaInput(mediaItem);
            videoClips.push({ clip, media: mediaItem, inputIndex, trackIndex: trackIdx });
          }
        }
      }
    }

    // Gather audio clips
    interface AudioClipInfo {
      clip: Clip;
      media: MediaItem;
      inputIndex: number;
    }

    const audioClips: AudioClipInfo[] = [];

    for (const track of audioTracks) {
      for (const clip of track.clips) {
        if (!clip.enabled) continue;
        const clipEnd = clip.timelineStart + clip.duration;
        if (clip.timelineStart < endTime && clipEnd > startTime) {
          const mediaItem = this.media.find((m) => m.id === clip.mediaId);
          if (mediaItem && mediaItem.type !== 'image') {
            const inputIndex = getMediaInput(mediaItem);
            audioClips.push({ clip, media: mediaItem, inputIndex });
          }
        }
      }
    }

    // Handle empty chunk
    if (videoClips.length === 0 && audioClips.length === 0) {
      return this.buildBlackChunkArgs(duration, width, height, fps, outputPath);
    }

    // Build filter complex
    const filterParts: string[] = [];

    // Create black base
    filterParts.push(
      `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}[base]`
    );

    let currentBase = 'base';
    let videoIdx = 0;

    // Process video clips
    for (const { clip, media, inputIndex } of videoClips) {
      const clipEnd = clip.timelineStart + clip.duration;
      const clipStartInChunk = Math.max(0, clip.timelineStart - startTime);
      const clipEndInChunk = Math.min(duration, clipEnd - startTime);

      let sourceIn = clip.mediaIn;
      if (clip.timelineStart < startTime) {
        sourceIn += startTime - clip.timelineStart;
      }
      const sourceDuration = clipEndInChunk - clipStartInChunk;
      const sourceOut = sourceIn + sourceDuration;

      const clipLabel = `v${videoIdx}`;
      const overlayLabel = `comp${videoIdx}`;

      // Get original dimensions from metadata (proxy may be smaller)
      const origW = media.metadata?.width || width;
      const origH = media.metadata?.height || height;

      if (media.type === 'image') {
        // Maintain original dimensions (scale proxy to original, then pad+crop)
        filterParts.push(
          `[${inputIndex}:v]loop=loop=-1:size=1,` +
          `trim=0:${sourceDuration},setpts=PTS-STARTPTS,` +
          `scale=${origW}:${origH},` +
          `pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,` +
          `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
          `format=yuva420p[${clipLabel}]`
        );
      } else {
        // Maintain original dimensions (scale proxy to original, then pad+crop)
        filterParts.push(
          `[${inputIndex}:v]trim=start=${sourceIn}:end=${sourceOut},` +
          `setpts=PTS-STARTPTS,` +
          `scale=${origW}:${origH},` +
          `pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,` +
          `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
          `fps=${fps},format=yuva420p[${clipLabel}]`
        );
      }

      const enableExpr = `between(t,${clipStartInChunk},${clipEndInChunk})`;
      filterParts.push(
        `[${currentBase}][${clipLabel}]overlay=x=0:y=0:enable='${enableExpr}'[${overlayLabel}]`
      );

      currentBase = overlayLabel;
      videoIdx++;
    }

    // Rename final video output
    if (videoIdx > 0) {
      filterParts[filterParts.length - 1] = filterParts[filterParts.length - 1].replace(
        `[${currentBase}]`,
        '[vout]'
      );
    } else {
      filterParts.push(`[base]null[vout]`);
    }

    // Process audio clips
    const audioLabels: string[] = [];

    for (let i = 0; i < audioClips.length; i++) {
      const { clip, inputIndex } = audioClips[i];
      const clipEnd = clip.timelineStart + clip.duration;
      const clipStartInChunk = Math.max(0, clip.timelineStart - startTime);

      let sourceIn = clip.mediaIn;
      if (clip.timelineStart < startTime) {
        sourceIn += startTime - clip.timelineStart;
      }
      const clipEndInChunk = Math.min(duration, clipEnd - startTime);
      const sourceDuration = clipEndInChunk - clipStartInChunk;
      const sourceOut = sourceIn + sourceDuration;

      const audioLabel = `a${i}`;

      filterParts.push(
        `[${inputIndex}:a]atrim=start=${sourceIn}:end=${sourceOut},` +
        `asetpts=PTS-STARTPTS,` +
        `adelay=${Math.round(clipStartInChunk * 1000)}|${Math.round(clipStartInChunk * 1000)},` +
        `apad=whole_dur=${duration}[${audioLabel}]`
      );

      audioLabels.push(`[${audioLabel}]`);
    }

    // Mix audio
    if (audioLabels.length > 1) {
      filterParts.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0[aout]`
      );
    } else if (audioLabels.length === 1) {
      filterParts[filterParts.length - 1] = filterParts[filterParts.length - 1].replace(
        /\[a0\]$/,
        '[aout]'
      );
    } else {
      filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration}[aout]`);
    }

    const filterComplex = filterParts.join(';\n');

    // Build args
    const args: string[] = ['-y'];

    for (const input of inputs) {
      args.push('-i', input.path);
    }

    args.push('-filter_complex', filterComplex);
    args.push('-map', '[vout]');
    args.push('-map', '[aout]');

    // Fast encoding for preview
    args.push('-c:v', 'libx264');
    args.push('-preset', 'ultrafast');
    args.push('-crf', '28');
    args.push('-c:a', 'aac');
    args.push('-b:a', '128k');
    args.push('-t', String(duration));
    args.push(outputPath);

    return args;
  }

  /**
   * Build args for empty (black) chunk
   */
  private buildBlackChunkArgs(
    duration: number,
    width: number,
    height: number,
    fps: number,
    outputPath: string
  ): string[] {
    return [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}`,
      '-f', 'lavfi',
      '-i', `anullsrc=r=48000:cl=stereo`,
      '-t', String(duration),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ];
  }

  /**
   * Compute content hash for a chunk
   */
  private computeChunkHash(startTime: number, endTime: number): string {
    if (!this.timeline) return 'empty';

    const crypto = require('crypto');
    const hashData: string[] = [`${startTime}|${endTime}`];

    for (const track of this.timeline.tracks) {
      for (const clip of track.clips) {
        if (!clip.enabled) continue;
        const clipEnd = clip.timelineStart + clip.duration;
        if (clip.timelineStart < endTime && clipEnd > startTime) {
          const media = this.media.find((m) => m.id === clip.mediaId);
          // Use proxy path only if the file exists
          const mediaPath = media?.proxyPath && fs.existsSync(media.proxyPath)
            ? media.proxyPath
            : (media?.path || '');
          hashData.push(
            `${clip.mediaId}|${clip.mediaIn}|${clip.mediaOut}|${clip.timelineStart}|${mediaPath}`
          );
        }
      }
    }

    return crypto.createHash('md5').update(hashData.join('\n')).digest('hex');
  }

  /**
   * Parse progress from ffmpeg output
   */
  private parseProgress(
    output: string,
    totalDuration: number
  ): { percent: number; fps?: number } | null {
    const timeMatch = output.match(/time=(\d+:\d+:\d+\.\d+)/);
    if (!timeMatch) return null;

    const timeParts = timeMatch[1].split(':');
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = parseFloat(timeParts[2]);
    const currentTime = hours * 3600 + minutes * 60 + seconds;

    const percent = Math.min(100, (currentTime / totalDuration) * 100);

    const fpsMatch = output.match(/fps=\s*([\d.]+)/);
    const fps = fpsMatch ? parseFloat(fpsMatch[1]) : undefined;

    return { percent, fps };
  }

  /**
   * Cancel a specific chunk render
   */
  cancelChunk(chunkIndex: number): boolean {
    const process = this.activeRenders.get(chunkIndex);
    if (process) {
      process.kill('SIGTERM');
      this.activeRenders.delete(chunkIndex);
      return true;
    }

    // Remove from queue
    const queueIndex = this.renderQueue.findIndex((t) => t.chunkIndex === chunkIndex);
    if (queueIndex >= 0) {
      this.renderQueue.splice(queueIndex, 1);
      return true;
    }

    return false;
  }

  /**
   * Cancel all renders
   */
  cancelAll(): void {
    for (const [chunkIndex, process] of this.activeRenders) {
      process.kill('SIGTERM');
    }
    this.activeRenders.clear();
    this.renderQueue = [];
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { queued: number; rendering: number } {
    return {
      queued: this.renderQueue.length,
      rendering: this.activeRenders.size,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.cancelAll();
    this.timeline = null;
    this.media = [];
    this.settings = null;
    this.mainWindow = null;
  }
}
