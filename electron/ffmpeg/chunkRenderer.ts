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
  previewBitrate?: string; // e.g., '2M', '5M', '10M'
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
    // Use proxy if available and exists on disk
    const mediaPath = mediaItem.proxyPath && fs.existsSync(mediaItem.proxyPath)
      ? mediaItem.proxyPath
      : mediaItem.path;
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

    // Build the clip filter chain - maintain original dimensions (scale proxy to original, then pad+crop)
    // Get original dimensions from metadata (proxy may be smaller)
    const origW = media.metadata?.width || width;
    const origH = media.metadata?.height || height;

    if (media.type === 'image') {
      // Image: loop, trim to duration, scale to original dimensions, then pad+crop to sequence
      filterParts.push(
        `[${inputIndex}:v]loop=loop=-1:size=1,` +
          `trim=0:${sourceDuration},setpts=PTS-STARTPTS,` +
          `scale=${origW}:${origH},` +
          `pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,` +
          `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
          `format=yuva420p[${clipLabel}]`
      );
    } else {
      // Video: trim to segment, scale to original dimensions, then pad+crop to sequence
      filterParts.push(
        `[${inputIndex}:v]trim=start=${sourceIn}:end=${sourceOut},` +
          `setpts=PTS-STARTPTS,` +
          `scale=${origW}:${origH},` +
          `pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,` +
          `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
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
 *
 * Uses an efficient concat-based approach:
 * - Each track is rendered as a concat of clips + black gaps
 * - Tracks are then overlaid on top of each other (only T overlays for T tracks)
 * - This is MUCH faster than the old approach of N overlays with enable expressions
 *
 * Compression settings:
 * - 1/2 resolution
 * - CRF 32 (good balance of quality and speed)
 * - ultrafast preset
 * - Low audio bitrate
 */
export async function renderFullPreview(
  options: FullPreviewOptions,
  onProgress?: (progress: FullPreviewProgress) => void
): Promise<FullPreviewResult> {
  const { timeline, media, settings, duration } = options;
  // Note: useProxies option is ignored - preview ALWAYS uses proxies when available

  const outputDir = getChunkOutputDir();
  const outputPath = path.join(outputDir, `preview-${Date.now()}.mp4`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Use full resolution for preview (quality controlled by bitrate setting)
  const [width, height] = settings.resolution;
  const fps = settings.frameRate;

  // Get video and audio tracks (video tracks reversed so higher tracks overlay lower)
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
    // Use proxy if available and exists on disk
    const mediaPath = mediaItem.proxyPath && fs.existsSync(mediaItem.proxyPath)
      ? mediaItem.proxyPath
      : mediaItem.path;
    const idx = inputs.length;
    inputs.push({ path: mediaPath, mediaId: mediaItem.id, index: idx });
    mediaIndexMap.set(mediaItem.id, idx);
    return idx;
  };

  // Gather clips per track for efficient processing
  interface ResolvedClip {
    clip: Clip;
    media: MediaItem;
    inputIndex: number;
  }

  interface TrackClips {
    trackIndex: number;
    clips: ResolvedClip[];
  }

  const videoTrackClips: TrackClips[] = [];
  const audioClips: ResolvedClip[] = [];

  for (let trackIdx = 0; trackIdx < videoTracks.length; trackIdx++) {
    const track = videoTracks[trackIdx];
    const trackClips: ResolvedClip[] = [];

    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      const mediaItem = media.find((m) => m.id === clip.mediaId);
      if (!mediaItem) continue;
      const inputIndex = getMediaInput(mediaItem);
      trackClips.push({ clip, media: mediaItem, inputIndex });
    }

    // Sort clips by timeline position
    trackClips.sort((a, b) => a.clip.timelineStart - b.clip.timelineStart);

    if (trackClips.length > 0) {
      videoTrackClips.push({ trackIndex: trackIdx, clips: trackClips });
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
  if (videoTrackClips.length === 0 && audioClips.length === 0) {
    return generateBlackPreview(outputPath, duration, width, height, fps);
  }

  // Build filter complex using efficient concat-per-track approach
  const filterParts: string[] = [];
  const trackOutputLabels: string[] = [];
  let segmentCounter = 0;

  // Process each video track: create concat of clips + gaps
  for (let tIdx = 0; tIdx < videoTrackClips.length; tIdx++) {
    const { clips } = videoTrackClips[tIdx];
    const segmentLabels: string[] = [];
    let currentTime = 0;

    for (const { clip, media: mediaItem, inputIndex } of clips) {
      // Add black gap before this clip if needed
      if (clip.timelineStart > currentTime) {
        const gapDuration = clip.timelineStart - currentTime;
        const gapLabel = `gap${segmentCounter}`;
        filterParts.push(
          `color=c=black:s=${width}x${height}:r=${fps}:d=${gapDuration},format=yuv420p[${gapLabel}]`
        );
        segmentLabels.push(`[${gapLabel}]`);
        segmentCounter++;
      }

      // Add the clip - maintain original dimensions (scale proxy to original, then pad+crop)
      const clipLabel = `seg${segmentCounter}`;
      // Get original dimensions from metadata (proxy may be smaller)
      const origW = mediaItem.metadata?.width || width;
      const origH = mediaItem.metadata?.height || height;

      if (mediaItem.type === 'image') {
        filterParts.push(
          `[${inputIndex}:v]loop=loop=-1:size=1,` +
            `trim=0:${clip.duration},setpts=PTS-STARTPTS,` +
            `scale=${origW}:${origH},` +
            `pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,` +
            `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
            `fps=${fps},format=yuv420p[${clipLabel}]`
        );
      } else {
        filterParts.push(
          `[${inputIndex}:v]trim=start=${clip.mediaIn}:end=${clip.mediaOut},` +
            `setpts=PTS-STARTPTS,` +
            `scale=${origW}:${origH},` +
            `pad=w=max(${width}\\,iw):h=max(${height}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,` +
            `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
            `fps=${fps},format=yuv420p[${clipLabel}]`
        );
      }
      segmentLabels.push(`[${clipLabel}]`);
      segmentCounter++;

      currentTime = clip.timelineStart + clip.duration;
    }

    // Add trailing gap if track doesn't reach end of timeline
    if (currentTime < duration) {
      const gapDuration = duration - currentTime;
      const gapLabel = `gap${segmentCounter}`;
      filterParts.push(
        `color=c=black:s=${width}x${height}:r=${fps}:d=${gapDuration},format=yuv420p[${gapLabel}]`
      );
      segmentLabels.push(`[${gapLabel}]`);
      segmentCounter++;
    }

    // Concat all segments for this track
    const trackLabel = `track${tIdx}`;
    if (segmentLabels.length === 1) {
      // Only one segment - just rename it
      const lastFilter = filterParts[filterParts.length - 1];
      filterParts[filterParts.length - 1] = lastFilter.replace(
        /\[[^\]]+\]$/,
        `[${trackLabel}]`
      );
    } else {
      filterParts.push(
        `${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=1:a=0[${trackLabel}]`
      );
    }
    trackOutputLabels.push(trackLabel);
  }

  // Stack tracks using overlay (only T overlays for T tracks - much more efficient!)
  let currentBase: string;
  if (trackOutputLabels.length === 0) {
    // No video tracks - generate black
    filterParts.push(
      `color=c=black:s=${width}x${height}:r=${fps}:d=${duration},format=yuv420p[vout]`
    );
    currentBase = 'vout';
  } else if (trackOutputLabels.length === 1) {
    // Single track - just use it directly
    const lastFilter = filterParts[filterParts.length - 1];
    filterParts[filterParts.length - 1] = lastFilter.replace(
      /\[[^\]]+\]$/,
      '[vout]'
    );
    currentBase = 'vout';
  } else {
    // Multiple tracks - overlay them
    // First track is the base
    currentBase = trackOutputLabels[0];

    for (let i = 1; i < trackOutputLabels.length; i++) {
      const overlayLabel = i === trackOutputLabels.length - 1 ? 'vout' : `ovr${i}`;
      // Use format=yuva420p on overlay input for proper alpha handling
      filterParts.push(
        `[${currentBase}][${trackOutputLabels[i]}]overlay=format=auto[${overlayLabel}]`
      );
      currentBase = overlayLabel;
    }
  }

  // Process audio using concat approach (same as video) for proper timestamps
  // Sort audio clips by timeline position
  const sortedAudioClips = [...audioClips].sort(
    (a, b) => a.clip.timelineStart - b.clip.timelineStart
  );

  if (sortedAudioClips.length === 0) {
    // No audio - generate silence
    filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration}[aout]`);
  } else {
    const audioSegmentLabels: string[] = [];
    let audioSegmentCounter = 0;
    let currentAudioTime = 0;

    for (const { clip, inputIndex } of sortedAudioClips) {
      // Add silence gap before this clip if needed
      if (clip.timelineStart > currentAudioTime) {
        const gapDuration = clip.timelineStart - currentAudioTime;
        const gapLabel = `asil${audioSegmentCounter}`;
        filterParts.push(
          `anullsrc=r=48000:cl=stereo,atrim=0:${gapDuration}[${gapLabel}]`
        );
        audioSegmentLabels.push(`[${gapLabel}]`);
        audioSegmentCounter++;
      }

      // Add the audio clip
      const audioLabel = `aseg${audioSegmentCounter}`;
      filterParts.push(
        `[${inputIndex}:a]atrim=start=${clip.mediaIn}:end=${clip.mediaOut},` +
          `asetpts=PTS-STARTPTS[${audioLabel}]`
      );
      audioSegmentLabels.push(`[${audioLabel}]`);
      audioSegmentCounter++;

      currentAudioTime = clip.timelineStart + clip.duration;
    }

    // Add trailing silence if audio doesn't reach end of timeline
    if (currentAudioTime < duration) {
      const gapDuration = duration - currentAudioTime;
      const gapLabel = `asil${audioSegmentCounter}`;
      filterParts.push(
        `anullsrc=r=48000:cl=stereo,atrim=0:${gapDuration}[${gapLabel}]`
      );
      audioSegmentLabels.push(`[${gapLabel}]`);
      audioSegmentCounter++;
    }

    // Concat all audio segments
    if (audioSegmentLabels.length === 1) {
      // Only one segment - rename it
      const lastFilter = filterParts[filterParts.length - 1];
      filterParts[filterParts.length - 1] = lastFilter.replace(
        /\[[^\]]+\]$/,
        '[aout]'
      );
    } else {
      filterParts.push(
        `${audioSegmentLabels.join('')}concat=n=${audioSegmentLabels.length}:v=0:a=1[aout]`
      );
    }
  }

  const filterComplex = filterParts.join(';\n');

  // Debug: log filter complex
  console.log('[Preview] Filter complex:', filterComplex);
  console.log('[Preview] Inputs:', inputs.map(i => i.path));

  // Build ffmpeg args with optimized compression
  const args: string[] = ['-y'];

  // Add inputs with hardware acceleration hint for each
  for (const input of inputs) {
    // Try hardware acceleration for decoding (helps a lot with AV1/HEVC)
    args.push('-hwaccel', 'auto');
    args.push('-i', input.path);
  }

  // Use all CPU threads
  args.push('-threads', '0');

  args.push('-filter_complex', filterComplex);
  args.push('-map', '[vout]');
  args.push('-map', '[aout]');

  // Optimized compression settings for fast preview
  args.push('-c:v', 'libx264');
  args.push('-preset', 'veryfast'); // Good balance of speed and quality

  // Use bitrate if specified, otherwise fall back to CRF
  if (settings.previewBitrate) {
    args.push('-b:v', settings.previewBitrate);
    args.push('-maxrate', settings.previewBitrate);
    args.push('-bufsize', `${parseInt(settings.previewBitrate) * 2}M`);
  } else {
    args.push('-crf', '32'); // Fallback quality
  }

  args.push('-tune', 'fastdecode'); // Optimize for fast playback
  args.push('-g', String(fps * 2)); // Keyframe every 2 seconds for better seeking
  args.push('-c:a', 'aac');
  args.push('-b:a', '96k'); // Slightly better audio
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

      // Debug: log ffmpeg output
      console.log('[Preview ffmpeg]', chunk);

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
        console.log('[Preview] Render complete:', outputPath);
        resolve({
          success: true,
          filePath: outputPath,
        });
      } else {
        console.error('[Preview] FFmpeg failed with code', code);
        console.error('[Preview] Last 1000 chars of stderr:', stderr.slice(-1000));
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

// ============================================================================
// UNIFIED PREVIEW PIPELINE
// Generates missing proxies + renders preview in one streamlined process
// ============================================================================

export interface PipelineProgress {
  phase: 'proxy' | 'render';
  overallPercent: number;
  currentTask: string;
  phasePercent: number;
}

export interface PipelineOptions {
  timeline: Timeline;
  media: MediaItem[];
  settings: ProjectSettings;
  duration: number;
  proxyScale?: number; // Default 0.5 (half resolution)
}

export interface PipelineResult {
  success: boolean;
  filePath: string | null;
  generatedProxies: string[]; // Media IDs that got new proxies
  error?: string;
}

// Track active pipeline for cancellation
let pipelineCancelled = false;

/**
 * Run the unified preview pipeline:
 * 1. Generate proxies for any clips that don't have them
 * 2. Render the full preview using proxies
 *
 * Reports unified progress throughout both phases.
 */
export async function runPreviewPipeline(
  options: PipelineOptions,
  onProgress?: (progress: PipelineProgress) => void,
  onProxyGenerated?: (mediaId: string, proxyPath: string) => void
): Promise<PipelineResult> {
  const { timeline, media, settings, duration, proxyScale = 0.5 } = options;
  pipelineCancelled = false;

  // Step 1: Find clips that need proxies
  const clipsNeedingProxies: MediaItem[] = [];
  const usedMediaIds = new Set<string>();

  // Collect all media IDs used in timeline
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.enabled && clip.mediaId) {
        usedMediaIds.add(clip.mediaId);
      }
    }
  }

  // Find media items that are used and don't have proxies
  for (const mediaId of usedMediaIds) {
    const mediaItem = media.find((m) => m.id === mediaId);
    if (mediaItem && mediaItem.type === 'video' && !mediaItem.proxyPath) {
      clipsNeedingProxies.push(mediaItem);
    }
  }

  const totalProxies = clipsNeedingProxies.length;
  const generatedProxies: string[] = [];

  // Calculate weight: proxy generation is typically slower, give it 70% of progress
  const proxyWeight = totalProxies > 0 ? 0.7 : 0;
  const renderWeight = 1 - proxyWeight;

  // Step 2: Generate missing proxies
  if (totalProxies > 0) {
    const proxyDir = getChunkOutputDir();

    for (let i = 0; i < clipsNeedingProxies.length; i++) {
      if (pipelineCancelled) {
        return { success: false, filePath: null, generatedProxies, error: 'Cancelled' };
      }

      const mediaItem = clipsNeedingProxies[i];
      const proxyFileName = `proxy-${mediaItem.id}-${Date.now()}.mp4`;
      const proxyPath = path.join(proxyDir, proxyFileName);

      onProgress?.({
        phase: 'proxy',
        overallPercent: (i / totalProxies) * proxyWeight * 100,
        currentTask: `Generating proxy: ${mediaItem.name}`,
        phasePercent: (i / totalProxies) * 100,
      });

      // Generate proxy using ffmpeg
      const proxyResult = await generateProxyForMedia(
        mediaItem.path,
        proxyPath,
        proxyScale,
        mediaItem.duration,
        (percent) => {
          const proxyProgress = (i + percent / 100) / totalProxies;
          onProgress?.({
            phase: 'proxy',
            overallPercent: proxyProgress * proxyWeight * 100,
            currentTask: `Generating proxy: ${mediaItem.name}`,
            phasePercent: proxyProgress * 100,
          });
        }
      );

      if (proxyResult.success && proxyResult.proxyPath) {
        generatedProxies.push(mediaItem.id);
        // Notify that proxy was generated so it can be saved to Redux
        onProxyGenerated?.(mediaItem.id, proxyResult.proxyPath);
        // Update media item for the render step
        mediaItem.proxyPath = proxyResult.proxyPath;
      }
    }
  }

  if (pipelineCancelled) {
    return { success: false, filePath: null, generatedProxies, error: 'Cancelled' };
  }

  // Step 3: Render the full preview
  onProgress?.({
    phase: 'render',
    overallPercent: proxyWeight * 100,
    currentTask: 'Rendering preview...',
    phasePercent: 0,
  });

  const renderResult = await renderFullPreview(
    { timeline, media, settings, duration, useProxies: true },
    (renderProgress) => {
      onProgress?.({
        phase: 'render',
        overallPercent: proxyWeight * 100 + renderProgress.percent * renderWeight,
        currentTask: 'Rendering preview...',
        phasePercent: renderProgress.percent,
      });
    }
  );

  if (renderResult.success) {
    onProgress?.({
      phase: 'render',
      overallPercent: 100,
      currentTask: 'Complete',
      phasePercent: 100,
    });
  }

  return {
    success: renderResult.success,
    filePath: renderResult.filePath,
    generatedProxies,
    error: renderResult.error,
  };
}

/**
 * Generate proxy for a single media file
 */
async function generateProxyForMedia(
  inputPath: string,
  outputPath: string,
  scale: number,
  duration: number,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; proxyPath: string | null; error?: string }> {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();

    const args = [
      '-y',
      '-hwaccel', 'auto',
      '-i', inputPath,
      '-vf', `scale=iw*${scale}:ih*${scale}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ];

    const process = spawn(ffmpegPath, args);
    let stderr = '';

    process.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      if (onProgress && duration > 0) {
        const progress = parseProgress(chunk, duration);
        if (progress) {
          onProgress(progress.percent);
        }
      }
    });

    process.on('error', (error) => {
      resolve({ success: false, proxyPath: null, error: error.message });
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, proxyPath: outputPath });
      } else {
        resolve({
          success: false,
          proxyPath: null,
          error: `FFmpeg exited with code ${code}`,
        });
      }
    });
  });
}

/**
 * Cancel the current pipeline
 */
export function cancelPipeline(): void {
  pipelineCancelled = true;
  cancelPreviewRender();
}
