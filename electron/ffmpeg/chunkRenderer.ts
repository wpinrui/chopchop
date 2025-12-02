/**
 * Chunk Renderer / Full Preview Renderer
 *
 * Renders timeline segments or full timeline to preview video files.
 * Handles proper compositing of multiple video tracks via overlay filters.
 * Optimized for fast preview rendering, not final export quality.
 *
 * The full preview mode uses aggressive compression:
 * - Scaled down to 1/2 resolution
 * - Higher CRF (lower quality, smaller file)
 * - Ultrafast preset
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

// Local type definitions to avoid circular imports
interface MediaItem {
  id: string;
  name: string;
  path: string;
  proxyPath: string | null;
  type: 'video' | 'audio' | 'image';
  duration: number;
  metadata?: {
    width?: number;
    height?: number;
    frameRate?: number;
  };
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
  muted: boolean;
  visible: boolean;
  volume: number;
}

interface Timeline {
  tracks: Track[];
}

interface ProjectSettings {
  resolution: [number, number];
  frameRate: number;
  backgroundColor: string;
  proxyEnabled: boolean;
}

interface ChunkRenderOptions {
  chunkId: string;
  startTime: number;
  endTime: number;
  timeline: Timeline;
  media: MediaItem[];
  settings: ProjectSettings;
  outputDir: string;
  useProxies: boolean;
}

interface ChunkRenderResult {
  success: boolean;
  chunkId: string;
  filePath: string | null;
  error?: string;
}

interface ChunkRenderProgress {
  chunkId: string;
  percent: number;
  fps?: number;
}

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

// Track active chunk render processes for cancellation
const activeRenderProcesses = new Map<string, ChildProcess>();

/**
 * Get clips that overlap with a time range
 */
function getClipsInRange(
  clips: Clip[],
  startTime: number,
  endTime: number
): Clip[] {
  return clips.filter((clip) => {
    const clipEnd = clip.timelineStart + clip.duration;
    return clip.enabled && clip.timelineStart < endTime && clipEnd > startTime;
  });
}

/**
 * Render a chunk of the timeline
 *
 * @param options Chunk render configuration
 * @param onProgress Progress callback
 * @returns Promise with render result
 */
export async function renderChunk(
  options: ChunkRenderOptions,
  onProgress?: (progress: ChunkRenderProgress) => void
): Promise<ChunkRenderResult> {
  const {
    chunkId,
    startTime,
    endTime,
    timeline,
    media,
    settings,
    outputDir,
    useProxies,
  } = options;

  const chunkDuration = endTime - startTime;
  const outputPath = path.join(outputDir, `chunk-${chunkId}.mp4`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get video and audio tracks (video tracks are ordered bottom-to-top for compositing)
  const videoTracks = timeline.tracks
    .filter((t) => t.type === 'video' && t.visible !== false)
    .reverse(); // Reverse so higher tracks overlay lower tracks
  const audioTracks = timeline.tracks.filter(
    (t) => t.type === 'audio' && !t.muted
  );

  // Collect all clips that overlap with this chunk
  const inputs: { path: string; mediaId: string; index: number }[] = [];
  const mediaIndexMap = new Map<string, number>();

  // Helper to get or add media to inputs
  const getMediaInput = (mediaItem: MediaItem): number => {
    if (mediaIndexMap.has(mediaItem.id)) {
      return mediaIndexMap.get(mediaItem.id)!;
    }
    // Use proxy if enabled and available
    const mediaPath =
      useProxies && mediaItem.proxyPath ? mediaItem.proxyPath : mediaItem.path;
    const idx = inputs.length;
    inputs.push({ path: mediaPath, mediaId: mediaItem.id, index: idx });
    mediaIndexMap.set(mediaItem.id, idx);
    return idx;
  };

  // Gather all video clips in range with their track info
  interface ResolvedVideoClip {
    clip: Clip;
    media: MediaItem;
    inputIndex: number;
    trackIndex: number;
  }

  const videoClipsInRange: ResolvedVideoClip[] = [];

  for (let trackIdx = 0; trackIdx < videoTracks.length; trackIdx++) {
    const track = videoTracks[trackIdx];
    const clipsInRange = getClipsInRange(track.clips, startTime, endTime);

    for (const clip of clipsInRange) {
      const mediaItem = media.find((m) => m.id === clip.mediaId);
      if (!mediaItem) continue;

      const inputIndex = getMediaInput(mediaItem);
      videoClipsInRange.push({
        clip,
        media: mediaItem,
        inputIndex,
        trackIndex: trackIdx,
      });
    }
  }

  // Gather all audio clips in range
  interface ResolvedAudioClip {
    clip: Clip;
    media: MediaItem;
    inputIndex: number;
  }

  const audioClipsInRange: ResolvedAudioClip[] = [];

  for (const track of audioTracks) {
    const clipsInRange = getClipsInRange(track.clips, startTime, endTime);

    for (const clip of clipsInRange) {
      const mediaItem = media.find((m) => m.id === clip.mediaId);
      if (!mediaItem || mediaItem.type === 'image') continue;

      const inputIndex = getMediaInput(mediaItem);
      audioClipsInRange.push({
        clip,
        media: mediaItem,
        inputIndex,
      });
    }
  }

  // Handle empty chunk (no clips)
  if (videoClipsInRange.length === 0 && audioClipsInRange.length === 0) {
    // Generate a black frame for empty segments
    return generateBlackChunk(outputPath, chunkDuration, settings, chunkId);
  }

  // Build filter complex for compositing
  const [width, height] = settings.resolution;
  const fps = settings.frameRate;
  let filterComplex = '';
  const filterParts: string[] = [];

  // Create a black base canvas for compositing
  // We'll overlay all video clips onto this base
  filterParts.push(
    `color=c=black:s=${width}x${height}:r=${fps}:d=${chunkDuration}[base]`
  );

  let currentBase = 'base';
  let videoOutputCount = 0;

  // Process video clips - composite onto base
  for (const { clip, media, inputIndex, trackIndex } of videoClipsInRange) {
    const clipEnd = clip.timelineStart + clip.duration;

    // Calculate where this clip appears within the chunk
    const clipStartInChunk = Math.max(0, clip.timelineStart - startTime);
    const clipEndInChunk = Math.min(chunkDuration, clipEnd - startTime);

    // Calculate source in/out points adjusted for chunk boundaries
    let sourceIn = clip.mediaIn;
    if (clip.timelineStart < startTime) {
      // Clip starts before chunk - adjust source in point
      sourceIn += startTime - clip.timelineStart;
    }
    const sourceDuration = clipEndInChunk - clipStartInChunk;
    const sourceOut = sourceIn + sourceDuration;

    const clipLabel = `clip${videoOutputCount}`;
    const overlayLabel = `comp${videoOutputCount}`;

    // Build the clip filter chain
    if (media.type === 'image') {
      // Image: loop, trim to duration, scale to fit
      filterParts.push(
        `[${inputIndex}:v]loop=loop=-1:size=1,` +
          `trim=0:${sourceDuration},setpts=PTS-STARTPTS,` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
          `format=yuva420p[${clipLabel}]`
      );
    } else {
      // Video: trim to segment, scale to fit
      filterParts.push(
        `[${inputIndex}:v]trim=start=${sourceIn}:end=${sourceOut},` +
          `setpts=PTS-STARTPTS,` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
          `fps=${fps},format=yuva420p[${clipLabel}]`
      );
    }

    // Overlay this clip onto the current composite
    // Use enable expression to control when the clip is visible
    const enableExpr = `between(t,${clipStartInChunk},${clipEndInChunk})`;
    filterParts.push(
      `[${currentBase}][${clipLabel}]overlay=x=0:y=0:enable='${enableExpr}'[${overlayLabel}]`
    );

    currentBase = overlayLabel;
    videoOutputCount++;
  }

  // Rename final video output
  if (videoOutputCount > 0) {
    filterParts[filterParts.length - 1] = filterParts[
      filterParts.length - 1
    ].replace(`[${currentBase}]`, '[vout]');
    currentBase = 'vout';
  } else {
    // No video clips - use base as output
    filterParts.push(`[base]null[vout]`);
  }

  // Process audio clips
  const audioLabels: string[] = [];

  for (let i = 0; i < audioClipsInRange.length; i++) {
    const { clip, inputIndex } = audioClipsInRange[i];
    const clipEnd = clip.timelineStart + clip.duration;

    // Calculate source timing
    const clipStartInChunk = Math.max(0, clip.timelineStart - startTime);
    let sourceIn = clip.mediaIn;
    if (clip.timelineStart < startTime) {
      sourceIn += startTime - clip.timelineStart;
    }
    const clipEndInChunk = Math.min(chunkDuration, clipEnd - startTime);
    const sourceDuration = clipEndInChunk - clipStartInChunk;
    const sourceOut = sourceIn + sourceDuration;

    const audioLabel = `aud${i}`;

    // Trim audio and add delay to position it correctly in the chunk
    filterParts.push(
      `[${inputIndex}:a]atrim=start=${sourceIn}:end=${sourceOut},` +
        `asetpts=PTS-STARTPTS,` +
        `adelay=${Math.round(clipStartInChunk * 1000)}|${Math.round(clipStartInChunk * 1000)},` +
        `apad=whole_dur=${chunkDuration}[${audioLabel}]`
    );

    audioLabels.push(`[${audioLabel}]`);
  }

  // Mix audio if we have any
  if (audioLabels.length > 1) {
    filterParts.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0[aout]`
    );
  } else if (audioLabels.length === 1) {
    filterParts[filterParts.length - 1] = filterParts[
      filterParts.length - 1
    ].replace(/\[aud0\]$/, '[aout]');
  } else {
    // No audio - generate silence
    filterParts.push(
      `anullsrc=r=48000:cl=stereo,atrim=0:${chunkDuration}[aout]`
    );
  }

  filterComplex = filterParts.join(';\n');

  // Build ffmpeg arguments
  const args: string[] = ['-y']; // Overwrite output

  // Add inputs
  for (const input of inputs) {
    args.push('-i', input.path);
  }

  // Add filter complex
  args.push('-filter_complex', filterComplex);

  // Map outputs
  args.push('-map', '[vout]');
  args.push('-map', '[aout]');

  // Fast encoding settings for preview
  args.push('-c:v', 'libx264');
  args.push('-preset', 'ultrafast');
  args.push('-crf', '28'); // Reasonable quality for preview
  args.push('-c:a', 'aac');
  args.push('-b:a', '128k');

  // Duration limit
  args.push('-t', String(chunkDuration));

  // Output
  args.push(outputPath);

  // Execute ffmpeg
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const process = spawn(ffmpegPath, args);
    activeRenderProcesses.set(chunkId, process);

    let stderr = '';

    process.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress
      if (onProgress) {
        const progress = parseProgress(chunk, chunkDuration);
        if (progress) {
          onProgress({
            chunkId,
            percent: progress.percent,
            fps: progress.fps,
          });
        }
      }
    });

    process.on('error', (error) => {
      activeRenderProcesses.delete(chunkId);
      resolve({
        success: false,
        chunkId,
        filePath: null,
        error: error.message,
      });
    });

    process.on('close', (code) => {
      activeRenderProcesses.delete(chunkId);
      if (code === 0) {
        resolve({
          success: true,
          chunkId,
          filePath: outputPath,
        });
      } else {
        resolve({
          success: false,
          chunkId,
          filePath: null,
          error: `FFmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        });
      }
    });
  });
}

/**
 * Generate a black frame chunk for empty timeline segments
 */
async function generateBlackChunk(
  outputPath: string,
  duration: number,
  settings: ProjectSettings,
  chunkId: string
): Promise<ChunkRenderResult> {
  const [width, height] = settings.resolution;
  const fps = settings.frameRate;

  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}`,
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=48000:cl=stereo`,
    '-t',
    String(duration),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '28',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outputPath,
  ];

  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const process = spawn(ffmpegPath, args);
    activeRenderProcesses.set(chunkId, process);

    let stderr = '';

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', (error) => {
      activeRenderProcesses.delete(chunkId);
      resolve({
        success: false,
        chunkId,
        filePath: null,
        error: error.message,
      });
    });

    process.on('close', (code) => {
      activeRenderProcesses.delete(chunkId);
      if (code === 0) {
        resolve({
          success: true,
          chunkId,
          filePath: outputPath,
        });
      } else {
        resolve({
          success: false,
          chunkId,
          filePath: null,
          error: `FFmpeg exited with code ${code}: ${stderr.slice(-200)}`,
        });
      }
    });
  });
}

/**
 * Parse progress from ffmpeg stderr
 */
function parseProgress(
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
 * Cancel an in-progress chunk render
 */
export function cancelChunkRender(chunkId: string): boolean {
  const process = activeRenderProcesses.get(chunkId);
  if (process) {
    process.kill('SIGTERM');
    activeRenderProcesses.delete(chunkId);
    return true;
  }
  return false;
}

/**
 * Cancel all active chunk renders
 */
export function cancelAllChunkRenders(): void {
  for (const [chunkId, process] of activeRenderProcesses) {
    process.kill('SIGTERM');
    activeRenderProcesses.delete(chunkId);
  }
}

/**
 * Get the chunk output directory path
 */
export function getChunkOutputDir(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'preview-chunks');
}

/**
 * Clean up all chunk files
 */
export async function clearChunkCache(): Promise<void> {
  const chunkDir = getChunkOutputDir();
  if (fs.existsSync(chunkDir)) {
    const files = fs.readdirSync(chunkDir);
    for (const file of files) {
      if ((file.startsWith('chunk-') || file.startsWith('preview-')) && file.endsWith('.mp4')) {
        fs.unlinkSync(path.join(chunkDir, file));
      }
    }
  }
}

// ============================================================================
// FULL TIMELINE PREVIEW RENDERING
// ============================================================================

interface FullPreviewOptions {
  timeline: Timeline;
  media: MediaItem[];
  settings: ProjectSettings;
  duration: number;
  useProxies: boolean;
}

interface FullPreviewResult {
  success: boolean;
  filePath: string | null;
  error?: string;
}

interface FullPreviewProgress {
  percent: number;
  fps?: number;
}

// Track the active full preview render process
let activePreviewProcess: ChildProcess | null = null;

/**
 * Render the entire timeline as a single low-bitrate preview video.
 * Uses aggressive compression for fast encoding:
 * - 1/2 resolution
 * - CRF 35 (very high compression)
 * - ultrafast preset
 * - Low audio bitrate
 */
export async function renderFullPreview(
  options: FullPreviewOptions,
  onProgress?: (progress: FullPreviewProgress) => void
): Promise<FullPreviewResult> {
  const { timeline, media, settings, duration, useProxies } = options;

  const outputDir = getChunkOutputDir();
  const outputPath = path.join(outputDir, `preview-${Date.now()}.mp4`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Scale down to half resolution for faster encoding
  const [fullWidth, fullHeight] = settings.resolution;
  const width = Math.round(fullWidth / 2);
  const height = Math.round(fullHeight / 2);
  const fps = settings.frameRate;

  // Get video and audio tracks
  const videoTracks = timeline.tracks
    .filter((t) => t.type === 'video' && t.visible !== false)
    .reverse();
  const audioTracks = timeline.tracks.filter(
    (t) => t.type === 'audio' && !t.muted
  );

  // Collect inputs
  const inputs: { path: string; mediaId: string; index: number }[] = [];
  const mediaIndexMap = new Map<string, number>();

  const getMediaInput = (mediaItem: MediaItem): number => {
    if (mediaIndexMap.has(mediaItem.id)) {
      return mediaIndexMap.get(mediaItem.id)!;
    }
    const mediaPath =
      useProxies && mediaItem.proxyPath ? mediaItem.proxyPath : mediaItem.path;
    const idx = inputs.length;
    inputs.push({ path: mediaPath, mediaId: mediaItem.id, index: idx });
    mediaIndexMap.set(mediaItem.id, idx);
    return idx;
  };

  // Gather all clips
  interface ResolvedClip {
    clip: Clip;
    media: MediaItem;
    inputIndex: number;
    trackIndex?: number;
  }

  const videoClips: ResolvedClip[] = [];
  const audioClips: ResolvedClip[] = [];

  for (let trackIdx = 0; trackIdx < videoTracks.length; trackIdx++) {
    const track = videoTracks[trackIdx];
    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      const mediaItem = media.find((m) => m.id === clip.mediaId);
      if (!mediaItem) continue;
      const inputIndex = getMediaInput(mediaItem);
      videoClips.push({ clip, media: mediaItem, inputIndex, trackIndex: trackIdx });
    }
  }

  for (const track of audioTracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      const mediaItem = media.find((m) => m.id === clip.mediaId);
      if (!mediaItem || mediaItem.type === 'image') continue;
      const inputIndex = getMediaInput(mediaItem);
      audioClips.push({ clip, media: mediaItem, inputIndex });
    }
  }

  // Handle empty timeline
  if (videoClips.length === 0 && audioClips.length === 0) {
    return generateBlackPreview(outputPath, duration, width, height, fps);
  }

  // Build filter complex
  const filterParts: string[] = [];

  // Black base canvas
  filterParts.push(
    `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}[base]`
  );

  let currentBase = 'base';
  let videoOutputCount = 0;

  // Process video clips
  for (const { clip, media: mediaItem, inputIndex } of videoClips) {
    const clipEnd = clip.timelineStart + clip.duration;
    const clipLabel = `clip${videoOutputCount}`;
    const overlayLabel = `comp${videoOutputCount}`;

    if (mediaItem.type === 'image') {
      filterParts.push(
        `[${inputIndex}:v]loop=loop=-1:size=1,` +
          `trim=0:${clip.duration},setpts=PTS-STARTPTS,` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
          `format=yuva420p[${clipLabel}]`
      );
    } else {
      filterParts.push(
        `[${inputIndex}:v]trim=start=${clip.mediaIn}:end=${clip.mediaOut},` +
          `setpts=PTS-STARTPTS,` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
          `fps=${fps},format=yuva420p[${clipLabel}]`
      );
    }

    const enableExpr = `between(t,${clip.timelineStart},${clipEnd})`;
    filterParts.push(
      `[${currentBase}][${clipLabel}]overlay=x=0:y=0:enable='${enableExpr}'[${overlayLabel}]`
    );

    currentBase = overlayLabel;
    videoOutputCount++;
  }

  // Finalize video output
  if (videoOutputCount > 0) {
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
    const audioLabel = `aud${i}`;

    filterParts.push(
      `[${inputIndex}:a]atrim=start=${clip.mediaIn}:end=${clip.mediaOut},` +
        `asetpts=PTS-STARTPTS,` +
        `adelay=${Math.round(clip.timelineStart * 1000)}|${Math.round(clip.timelineStart * 1000)},` +
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
      /\[aud0\]$/,
      '[aout]'
    );
  } else {
    filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration}[aout]`);
  }

  const filterComplex = filterParts.join(';\n');

  // Build ffmpeg args with aggressive compression
  const args: string[] = ['-y'];

  for (const input of inputs) {
    args.push('-i', input.path);
  }

  args.push('-filter_complex', filterComplex);
  args.push('-map', '[vout]');
  args.push('-map', '[aout]');

  // Aggressive compression settings for fast preview
  args.push('-c:v', 'libx264');
  args.push('-preset', 'ultrafast');
  args.push('-crf', '35'); // High compression, lower quality
  args.push('-tune', 'fastdecode'); // Optimize for fast playback
  args.push('-c:a', 'aac');
  args.push('-b:a', '64k'); // Low audio bitrate
  args.push('-t', String(duration));
  args.push(outputPath);

  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const process = spawn(ffmpegPath, args);
    activePreviewProcess = process;

    let stderr = '';

    process.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      if (onProgress) {
        const progress = parseProgress(chunk, duration);
        if (progress) {
          onProgress({
            percent: progress.percent,
            fps: progress.fps,
          });
        }
      }
    });

    process.on('error', (error) => {
      activePreviewProcess = null;
      resolve({
        success: false,
        filePath: null,
        error: error.message,
      });
    });

    process.on('close', (code) => {
      activePreviewProcess = null;
      if (code === 0) {
        resolve({
          success: true,
          filePath: outputPath,
        });
      } else {
        resolve({
          success: false,
          filePath: null,
          error: `FFmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        });
      }
    });
  });
}

/**
 * Generate a black preview for empty timeline
 */
async function generateBlackPreview(
  outputPath: string,
  duration: number,
  width: number,
  height: number,
  fps: number
): Promise<FullPreviewResult> {
  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}`,
    '-f', 'lavfi',
    '-i', `anullsrc=r=48000:cl=stereo`,
    '-t', String(duration),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '35',
    '-c:a', 'aac',
    '-b:a', '64k',
    outputPath,
  ];

  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const process = spawn(ffmpegPath, args);
    activePreviewProcess = process;

    let stderr = '';

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', (error) => {
      activePreviewProcess = null;
      resolve({
        success: false,
        filePath: null,
        error: error.message,
      });
    });

    process.on('close', (code) => {
      activePreviewProcess = null;
      if (code === 0) {
        resolve({
          success: true,
          filePath: outputPath,
        });
      } else {
        resolve({
          success: false,
          filePath: null,
          error: `FFmpeg exited with code ${code}: ${stderr.slice(-200)}`,
        });
      }
    });
  });
}

/**
 * Cancel the current full preview render
 */
export function cancelPreviewRender(): boolean {
  if (activePreviewProcess) {
    activePreviewProcess.kill('SIGTERM');
    activePreviewProcess = null;
    return true;
  }
  return false;
}
