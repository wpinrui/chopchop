/**
 * FFmpeg Subprocess Runner
 *
 * Manages ffmpeg and ffprobe subprocess execution.
 * Provides safe, typed APIs for running commands and streaming output.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import { app } from 'electron';

/**
 * Result from running an ffmpeg/ffprobe command
 */
export interface RunResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Progress callback for long-running operations
 */
export interface ProgressCallback {
  (progress: {
    frame?: number;
    fps?: number;
    time?: string;
    speed?: string;
    progress?: number; // 0-100
  }): void;
}

/**
 * Get the path to bundled ffmpeg executable
 */
function getFFmpegPath(): string {
  if (app.isPackaged) {
    // In production, ffmpeg is bundled in resources/ffmpeg
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  } else {
    // In development, assume ffmpeg is in resources/ffmpeg
    return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe');
  }
}

/**
 * Get the path to bundled ffprobe executable
 */
function getFFprobePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe');
  } else {
    return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffprobe.exe');
  }
}

/**
 * Run ffmpeg command and return result
 */
export function runFFmpeg(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const process = spawn(ffmpegPath, args);

    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', (error) => {
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr,
        error,
      });
    });

    process.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code || 0,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Run ffmpeg with progress tracking
 */
export function runFFmpegWithProgress(
  args: string[],
  onProgress?: ProgressCallback,
  duration?: number
): Promise<RunResult> {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const process = spawn(ffmpegPath, args);

    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress from stderr
      if (onProgress) {
        const progress = parseFFmpegProgress(chunk, duration);
        if (progress) {
          onProgress(progress);
        }
      }
    });

    process.on('error', (error) => {
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr,
        error,
      });
    });

    process.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code || 0,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Run ffprobe command and return result
 */
export function runFFprobe(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const ffprobePath = getFFprobePath();
    const process = spawn(ffprobePath, args);

    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', (error) => {
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr,
        error,
      });
    });

    process.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code || 0,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Spawn ffmpeg process for streaming (e.g., preview playback)
 * Returns the child process for manual control
 */
export function spawnFFmpegStream(args: string[]): ChildProcess {
  const ffmpegPath = getFFmpegPath();
  return spawn(ffmpegPath, args);
}

/**
 * Parse progress information from ffmpeg stderr output
 */
function parseFFmpegProgress(
  output: string,
  totalDuration?: number
): {
  frame?: number;
  fps?: number;
  time?: string;
  speed?: string;
  progress?: number;
} | null {
  const lines = output.split('\n');
  const progressLine = lines.find((line) => line.includes('frame='));

  if (!progressLine) {
    return null;
  }

  const result: {
    frame?: number;
    fps?: number;
    time?: string;
    speed?: string;
    progress?: number;
  } = {};

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

    // Calculate progress percentage if total duration is known
    if (totalDuration) {
      const currentSeconds = parseTimeToSeconds(timeMatch[1]);
      result.progress = Math.min(100, (currentSeconds / totalDuration) * 100);
    }
  }

  // Extract speed
  const speedMatch = progressLine.match(/speed=\s*([\d.]+)x/);
  if (speedMatch) {
    result.speed = speedMatch[1] + 'x';
  }

  return result;
}

/**
 * Convert time string (HH:MM:SS.MS) to seconds
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Check if ffmpeg is available and working
 */
export async function checkFFmpegAvailable(): Promise<boolean> {
  try {
    const result = await runFFmpeg(['-version']);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Get ffmpeg version info
 */
export async function getFFmpegVersion(): Promise<string | null> {
  try {
    const result = await runFFmpeg(['-version']);
    if (result.success) {
      const firstLine = result.stdout.split('\n')[0];
      return firstLine;
    }
    return null;
  } catch {
    return null;
  }
}
