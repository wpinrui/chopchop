/**
 * Scrub Audio Controller
 *
 * Handles audio playback during scrubbing and frame stepping.
 *
 * Features:
 * - Pitch-shifted audio during scrub (matching scrub velocity)
 * - Single-frame audio snippets for frame stepping (like Premiere)
 * - Manages ffmpeg subprocesses for audio extraction
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { Timeline, MediaItem, Clip, ProjectSettings } from './types';

// Audio snippet for IPC transfer
export interface AudioSnippet {
  time: number;
  duration: number;
  sampleRate: number;
  channels: number;
  data: Buffer; // PCM float32 interleaved
}

export class ScrubAudioController {
  private timeline: Timeline | null = null;
  private media: MediaItem[] = [];
  private settings: ProjectSettings | null = null;
  private mainWindow: BrowserWindow | null = null;

  private isActive: boolean = false;
  private lastTime: number = 0;
  private lastVelocity: number = 0;
  private activeProcess: ChildProcess | null = null;

  // Audio buffering
  private audioBuffer: Map<number, AudioSnippet> = new Map();
  private bufferAheadMs: number = 200; // Buffer 200ms ahead

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
   * Start scrub audio mode
   */
  startScrub(time: number): void {
    this.isActive = true;
    this.lastTime = time;
    this.lastVelocity = 0;
    this.audioBuffer.clear();
  }

  /**
   * Update scrub position and velocity
   * Velocity is in seconds per second (1.0 = normal speed forward, -1.0 = normal speed reverse)
   */
  async updateScrub(time: number, velocity: number): Promise<void> {
    if (!this.isActive) return;

    this.lastTime = time;
    this.lastVelocity = velocity;

    // Only generate audio if moving fast enough
    const minVelocity = 0.1;
    if (Math.abs(velocity) < minVelocity) {
      return;
    }

    // Extract audio snippet at current position
    const snippet = await this.extractAudioSnippet(time, velocity);
    if (snippet && this.mainWindow) {
      // Send to renderer for playback
      this.mainWindow.webContents.send('preview:audioSnippet', {
        time: snippet.time,
        duration: snippet.duration,
        sampleRate: snippet.sampleRate,
        channels: snippet.channels,
        audioData: snippet.data.buffer.slice(
          snippet.data.byteOffset,
          snippet.data.byteOffset + snippet.data.byteLength
        ),
      });
    }
  }

  /**
   * Stop scrub audio mode
   */
  stopScrub(): void {
    this.isActive = false;
    this.cancelExtraction();
    this.audioBuffer.clear();
  }

  /**
   * Play single frame's worth of audio (for frame stepping)
   * This is the key feature for accurate cutting - hear exactly what's at the playhead
   */
  async playFrameAudio(time: number): Promise<void> {
    if (!this.settings) return;

    const frameDuration = 1 / this.settings.frameRate;
    const snippet = await this.extractAudioSnippet(time, 1.0, frameDuration);

    if (snippet && this.mainWindow) {
      this.mainWindow.webContents.send('preview:audioSnippet', {
        time: snippet.time,
        duration: snippet.duration,
        sampleRate: snippet.sampleRate,
        channels: snippet.channels,
        audioData: snippet.data.buffer.slice(
          snippet.data.byteOffset,
          snippet.data.byteOffset + snippet.data.byteLength
        ),
      });
    }
  }

  /**
   * Extract an audio snippet from the timeline at a given time
   */
  private async extractAudioSnippet(
    time: number,
    velocity: number,
    customDuration?: number
  ): Promise<AudioSnippet | null> {
    if (!this.timeline || !this.settings) return null;

    // Find audio clips at this time
    const audioClips = this.getAudioClipsAtTime(time);
    if (audioClips.length === 0) {
      return null;
    }

    // Calculate duration based on velocity or custom duration
    // For scrubbing: extract small chunks that match the scrub speed
    const baseDuration = customDuration || 0.05; // 50ms default chunks
    const duration = baseDuration;

    // Use the topmost/first audio clip
    const { clip, media, mediaTime } = audioClips[0];

    // Build atempo filter chain for pitch shifting
    // atempo only works in range 0.5-2.0, chain multiple for extreme speeds
    const tempo = Math.abs(velocity);
    const atempoFilters = this.buildAtempoChain(tempo);

    // If velocity is negative, we need to reverse the audio
    const isReverse = velocity < 0;

    return new Promise((resolve) => {
      const args = [
        '-ss', String(mediaTime),
        '-i', media.path,
        '-t', String(duration),
        '-af', isReverse
          ? `areverse,${atempoFilters}`
          : atempoFilters || 'anull',
        '-f', 'f32le', // 32-bit float PCM
        '-acodec', 'pcm_f32le',
        '-ar', '48000',
        '-ac', '2',
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

      process.on('error', () => {
        this.activeProcess = null;
        resolve(null);
      });

      process.on('close', (code) => {
        this.activeProcess = null;

        if (code === 0 && chunks.length > 0) {
          const data = Buffer.concat(chunks);
          resolve({
            time,
            duration: duration / (tempo || 1), // Adjusted duration after tempo change
            sampleRate: 48000,
            channels: 2,
            data,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Build atempo filter chain for a given tempo multiplier
   * atempo only supports 0.5-2.0, so we chain multiple for extreme values
   */
  private buildAtempoChain(tempo: number): string {
    if (tempo <= 0) return 'anull';
    if (tempo >= 0.5 && tempo <= 2.0) {
      return `atempo=${tempo.toFixed(3)}`;
    }

    const filters: string[] = [];
    let remaining = tempo;

    // Handle tempo > 2.0 (speed up)
    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }

    // Handle tempo < 0.5 (slow down)
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }

    // Add final adjustment
    if (remaining !== 1.0) {
      filters.push(`atempo=${remaining.toFixed(3)}`);
    }

    return filters.length > 0 ? filters.join(',') : 'anull';
  }

  /**
   * Get all audio clips at a specific time
   */
  private getAudioClipsAtTime(
    time: number
  ): Array<{ clip: Clip; media: MediaItem; mediaTime: number }> {
    if (!this.timeline) return [];

    const result: Array<{ clip: Clip; media: MediaItem; mediaTime: number }> = [];

    // Check both audio tracks and video tracks (for embedded audio)
    for (const track of this.timeline.tracks) {
      if (track.muted) continue;

      for (const clip of track.clips) {
        if (!clip.enabled) continue;

        const clipStart = clip.timelineStart;
        const clipEnd = clip.timelineStart + clip.duration;

        if (time >= clipStart && time < clipEnd) {
          const mediaItem = this.media.find((m) => m.id === clip.mediaId);
          if (mediaItem && mediaItem.type !== 'image') {
            const mediaTime = clip.mediaIn + (time - clipStart);
            result.push({
              clip,
              media: mediaItem,
              mediaTime,
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Cancel ongoing audio extraction
   */
  private cancelExtraction(): void {
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopScrub();
    this.timeline = null;
    this.media = [];
    this.settings = null;
    this.mainWindow = null;
  }
}
