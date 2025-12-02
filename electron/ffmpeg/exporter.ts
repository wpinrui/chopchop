/**
 * FFmpeg Export Handler
 *
 * Orchestrates the export process from timeline to final video file.
 * Handles progress tracking and cancellation.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import { app } from 'electron';
import { buildFilterGraph, buildExportArgs } from './graphBuilder';

// Local type definitions to avoid importing from src/types (causes build issues)
interface MediaItem {
  id: string;
  name: string;
  path: string;
  type: 'video' | 'audio' | 'image';
  duration: number;
}

interface Clip {
  id: string;
  type: string;
  mediaId: string | null;
  trackId: string;
  timelineStart: number;
  duration: number;
  mediaIn: number;
  mediaOut: number;
  name: string;
  enabled: boolean;
}

interface Track {
  id: string;
  type: 'video' | 'audio';
  name: string;
  clips: Clip[];
}

interface Timeline {
  tracks: Track[];
  playheadPosition: number;
}

interface ExportSettings {
  outputPath: string;
  format: string;
  videoCodec: string;
  videoCodecOptions: Record<string, string | number | boolean>;
  audioCodec: string;
  audioCodecOptions: Record<string, string | number | boolean>;
  resolution: [number, number] | 'source';
  frameRate: number | 'source';
  useGpuEncoding: boolean;
  gpuEncoder: string | null;
}

/**
 * Progress information during export
 */
export interface ExportProgress {
  percent: number;
  frame?: number;
  fps?: number;
  speed?: string;
  eta?: string;
  time?: string;
}

/**
 * Export job state
 */
interface ExportJob {
  process: ChildProcess | null;
  canceled: boolean;
}

// Active export job (only one at a time)
let currentJob: ExportJob | null = null;

/**
 * Get the path to bundled ffmpeg executable
 */
function getFFmpegPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  } else {
    return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe');
  }
}

/**
 * Calculate timeline duration
 */
function getTimelineDuration(timeline: Timeline): number {
  let maxEnd = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clip.timelineStart + clip.duration;
      if (end > maxEnd) maxEnd = end;
    }
  }
  return maxEnd;
}

/**
 * Parse progress output from ffmpeg -progress pipe
 */
function parseProgressOutput(
  output: string,
  totalDuration: number
): ExportProgress | null {
  // ffmpeg -progress outputs key=value pairs
  const lines = output.split('\n');
  const progress: Partial<ExportProgress> = {};

  for (const line of lines) {
    const [key, value] = line.split('=');
    if (!key || !value) continue;

    switch (key.trim()) {
      case 'frame':
        progress.frame = parseInt(value, 10);
        break;
      case 'fps':
        progress.fps = parseFloat(value);
        break;
      case 'speed':
        progress.speed = value.trim();
        break;
      case 'out_time_ms':
        const ms = parseInt(value, 10);
        if (!isNaN(ms) && totalDuration > 0) {
          progress.percent = Math.min(100, (ms / 1000000 / totalDuration) * 100);
          progress.time = formatTime(ms / 1000000);

          // Calculate ETA
          if (progress.speed && progress.speed !== 'N/A') {
            const speedMultiplier = parseFloat(progress.speed.replace('x', ''));
            if (!isNaN(speedMultiplier) && speedMultiplier > 0) {
              const remainingTime = totalDuration - (ms / 1000000);
              const etaSeconds = remainingTime / speedMultiplier;
              progress.eta = formatTime(etaSeconds);
            }
          }
        }
        break;
    }
  }

  if (progress.percent !== undefined) {
    return progress as ExportProgress;
  }

  return null;
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Export timeline to video file
 */
export async function exportTimeline(
  timeline: Timeline,
  media: MediaItem[],
  settings: ExportSettings,
  onProgress: (progress: ExportProgress) => void
): Promise<{ success: boolean; error?: string }> {
  // Cancel any existing export
  if (currentJob) {
    await cancelExport();
  }

  const duration = getTimelineDuration(timeline);
  if (duration <= 0) {
    return { success: false, error: 'Timeline is empty' };
  }

  // Build filter graph
  const graphResult = buildFilterGraph(timeline, media, settings);
  if (!graphResult.success) {
    return {
      success: false,
      error: graphResult.errors.join('\n') || 'Failed to build filter graph',
    };
  }

  // Build ffmpeg arguments
  const args = buildExportArgs(graphResult, settings, duration);

  console.log('Export command:', getFFmpegPath(), args.join(' '));

  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const process = spawn(ffmpegPath, args);

    currentJob = {
      process,
      canceled: false,
    };

    let stderr = '';
    let progressBuffer = '';

    process.stdout?.on('data', (data) => {
      progressBuffer += data.toString();

      // Parse complete progress blocks (they end with "progress=")
      const blocks = progressBuffer.split('progress=');
      if (blocks.length > 1) {
        // Keep the incomplete block for next time
        progressBuffer = blocks.pop() || '';

        // Process complete blocks
        for (const block of blocks) {
          if (block.trim()) {
            const progress = parseProgressOutput(block, duration);
            if (progress) {
              onProgress(progress);
            }
          }
        }
      }
    });

    process.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log stderr for debugging
      console.log('[ffmpeg stderr]', chunk);
      // Also try to parse progress from stderr (fallback)
      const progress = parseFFmpegStderr(chunk, duration);
      if (progress) {
        onProgress(progress);
      }
    });

    process.on('error', (error) => {
      currentJob = null;
      resolve({
        success: false,
        error: `FFmpeg error: ${error.message}`,
      });
    });

    process.on('close', (code) => {
      const wasCanceled = currentJob?.canceled;
      currentJob = null;

      if (wasCanceled) {
        resolve({
          success: false,
          error: 'Export canceled',
        });
      } else if (code === 0) {
        // Final 100% progress
        onProgress({ percent: 100 });
        resolve({ success: true });
      } else {
        // Extract error message from stderr
        const errorMatch = stderr.match(/Error[^\n]*/i);
        resolve({
          success: false,
          error: errorMatch ? errorMatch[0] : `FFmpeg exited with code ${code}`,
        });
      }
    });
  });
}

/**
 * Parse progress from ffmpeg stderr (fallback)
 */
function parseFFmpegStderr(output: string, totalDuration: number): ExportProgress | null {
  const lines = output.split('\n');
  const progressLine = lines.find((line) => line.includes('frame='));

  if (!progressLine) return null;

  const result: ExportProgress = { percent: 0 };

  // Extract frame
  const frameMatch = progressLine.match(/frame=\s*(\d+)/);
  if (frameMatch) {
    result.frame = parseInt(frameMatch[1], 10);
  }

  // Extract fps
  const fpsMatch = progressLine.match(/fps=\s*([\d.]+)/);
  if (fpsMatch) {
    result.fps = parseFloat(fpsMatch[1]);
  }

  // Extract time
  const timeMatch = progressLine.match(/time=(\d+:\d+:\d+\.\d+)/);
  if (timeMatch) {
    result.time = timeMatch[1];

    // Calculate progress percentage
    if (totalDuration > 0) {
      const currentSeconds = parseTimeToSeconds(timeMatch[1]);
      result.percent = Math.min(100, (currentSeconds / totalDuration) * 100);
    }
  }

  // Extract speed
  const speedMatch = progressLine.match(/speed=\s*([\d.]+)x/);
  if (speedMatch) {
    result.speed = speedMatch[1] + 'x';
  }

  return result.percent > 0 || result.frame ? result : null;
}

/**
 * Convert time string (HH:MM:SS.MS) to seconds
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Cancel the current export
 */
export async function cancelExport(): Promise<void> {
  if (currentJob && currentJob.process) {
    currentJob.canceled = true;
    currentJob.process.kill('SIGTERM');

    // Wait a bit for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 500));

    // Force kill if still running
    if (currentJob?.process && !currentJob.process.killed) {
      currentJob.process.kill('SIGKILL');
    }
  }
  currentJob = null;
}
