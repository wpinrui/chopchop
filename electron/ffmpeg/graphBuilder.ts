/**
 * FFmpeg Filter Graph Builder
 *
 * Translates timeline state into ffmpeg filter_complex strings.
 * Uses overlay-based compositing to support multi-track editing with
 * overlapping clips, gaps, and proper layering.
 */

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
  muted?: boolean;
  visible?: boolean;
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
 * Input definition for ffmpeg
 */
interface InputDef {
  index: number;
  path: string;
  mediaId: string;
}

/**
 * Result of building a filter graph
 */
export interface FilterGraphResult {
  inputs: InputDef[];
  filterComplex: string;
  maps: string[];
  success: boolean;
  errors: string[];
}

/**
 * Clip with resolved media information
 */
interface ResolvedClip extends Clip {
  mediaItem: MediaItem;
  inputIndex: number;
  trackIndex: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate the total duration of the timeline (max clip end time)
 */
function getTimelineDuration(timeline: Timeline): number {
  let maxEnd = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      const clipEnd = clip.timelineStart + clip.duration;
      if (clipEnd > maxEnd) {
        maxEnd = clipEnd;
      }
    }
  }
  return maxEnd;
}

/**
 * Build a black base layer filter for the entire timeline
 */
function buildBlackBase(
  width: number,
  height: number,
  fps: number,
  duration: number
): string {
  return `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}[base]`;
}

/**
 * Build a video clip filter chain (trim, setpts, pad/crop, fps, format)
 * Maintains original dimensions without scaling (per CLAUDE.md requirements)
 */
function buildVideoClipFilter(
  inputIndex: number,
  clip: ResolvedClip,
  seqWidth: number,
  seqHeight: number,
  fps: number,
  outputLabel: string
): string {
  // Pad + crop to maintain original dimensions centered in sequence frame
  // - pad ensures clip is at least target size (adds black bars if smaller)
  // - crop cuts to exact target size (crops centered if larger)
  const padCrop = `pad=w=max(${seqWidth}\\,iw):h=max(${seqHeight}\\,ih):x=(ow-iw)/2:y=(oh-ih)/2:color=black,crop=${seqWidth}:${seqHeight}:(iw-${seqWidth})/2:(ih-${seqHeight})/2`;

  if (clip.mediaItem.type === 'image') {
    // Image: loop, trim to duration, normalize
    return `[${inputIndex}:v]loop=loop=-1:size=1,trim=0:${clip.duration},setpts=PTS-STARTPTS,${padCrop},fps=${fps},format=yuva420p[${outputLabel}]`;
  } else {
    // Video: trim to source segment, normalize
    const trimStart = clip.mediaIn;
    const trimEnd = clip.mediaOut;
    return `[${inputIndex}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,${padCrop},fps=${fps},format=yuva420p[${outputLabel}]`;
  }
}

/**
 * Build an overlay filter with enable expression for timeline positioning
 */
function buildOverlayFilter(
  baseLabel: string,
  clipLabel: string,
  clipStart: number,
  clipEnd: number,
  outputLabel: string
): string {
  const enableExpr = `between(t,${clipStart},${clipEnd})`;
  return `[${baseLabel}][${clipLabel}]overlay=x=0:y=0:enable='${enableExpr}'[${outputLabel}]`;
}

/**
 * Build an audio clip filter chain (trim, setpts, adelay, apad)
 */
function buildAudioClipFilter(
  inputIndex: number,
  clip: ResolvedClip,
  timelineDuration: number,
  sampleRate: number,
  outputLabel: string
): string {
  const trimStart = clip.mediaIn;
  const trimEnd = clip.mediaOut;
  const delayMs = Math.round(clip.timelineStart * 1000);

  return `[${inputIndex}:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,aresample=${sampleRate},aformat=channel_layouts=stereo,adelay=${delayMs}|${delayMs},apad=whole_dur=${timelineDuration}[${outputLabel}]`;
}

/**
 * Build a silent audio source for video-only exports
 */
function buildSilentAudio(duration: number, sampleRate: number): string {
  return `anullsrc=r=${sampleRate}:cl=stereo,atrim=0:${duration}[aout]`;
}

/**
 * Build a filter graph from timeline state
 *
 * Uses overlay-based compositing to support:
 * - Multiple video tracks with layering (higher tracks on top)
 * - Overlapping clips on different tracks
 * - Gaps in timeline (black base shows through)
 * - Mixed audio from multiple tracks
 */
export function buildFilterGraph(
  timeline: Timeline,
  media: MediaItem[],
  settings: ExportSettings
): FilterGraphResult {
  const errors: string[] = [];
  const inputs: InputDef[] = [];
  const mediaIndexMap = new Map<string, number>();

  // Calculate timeline duration
  const timelineDuration = getTimelineDuration(timeline);

  // Handle edge case: empty timeline
  if (timelineDuration === 0) {
    return {
      inputs: [],
      filterComplex: '',
      maps: [],
      success: false,
      errors: ['No clips in timeline to export'],
    };
  }

  // Get video and audio tracks, filtering out hidden/muted
  // Reverse video tracks so higher tracks (rendered on top) come last in processing
  const videoTracks = timeline.tracks
    .filter(t => t.type === 'video' && t.visible !== false)
    .reverse();
  const audioTracks = timeline.tracks
    .filter(t => t.type === 'audio' && !t.muted);

  // Collect video clips with track index for proper layering
  const videoClips: ResolvedClip[] = [];
  const audioClips: ResolvedClip[] = [];

  // Helper to get or create media input index
  const getMediaInput = (mediaItem: MediaItem): number => {
    if (mediaIndexMap.has(mediaItem.id)) {
      return mediaIndexMap.get(mediaItem.id)!;
    }
    const idx = inputs.length;
    inputs.push({
      index: idx,
      path: mediaItem.path,
      mediaId: mediaItem.id,
    });
    mediaIndexMap.set(mediaItem.id, idx);
    return idx;
  };

  // Gather video clips from all video tracks
  for (let trackIdx = 0; trackIdx < videoTracks.length; trackIdx++) {
    const track = videoTracks[trackIdx];
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const mediaItem = media.find(m => m.id === clip.mediaId);
      if (!mediaItem) {
        errors.push(`Media not found for clip: ${clip.name}`);
        continue;
      }

      videoClips.push({
        ...clip,
        mediaItem,
        inputIndex: getMediaInput(mediaItem),
        trackIndex: trackIdx,
      });
    }
  }

  // Gather audio clips from all audio tracks
  for (let trackIdx = 0; trackIdx < audioTracks.length; trackIdx++) {
    const track = audioTracks[trackIdx];
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const mediaItem = media.find(m => m.id === clip.mediaId);
      if (!mediaItem) {
        errors.push(`Media not found for clip: ${clip.name}`);
        continue;
      }

      // Skip images for audio
      if (mediaItem.type === 'image') continue;

      audioClips.push({
        ...clip,
        mediaItem,
        inputIndex: getMediaInput(mediaItem),
        trackIndex: trackIdx,
      });
    }
  }

  // Determine target resolution and frame rate
  let targetWidth = 1920;
  let targetHeight = 1080;
  let targetFps = 30;

  if (settings.resolution !== 'source') {
    targetWidth = settings.resolution[0];
    targetHeight = settings.resolution[1];
  }

  if (settings.frameRate !== 'source') {
    targetFps = settings.frameRate;
  }

  // Get audio settings
  const targetSampleRate = Number(settings.audioCodecOptions?.ar) || 48000;

  // Build filter complex using overlay approach
  const filterParts: string[] = [];

  // Create black base layer for entire timeline
  filterParts.push(buildBlackBase(targetWidth, targetHeight, targetFps, timelineDuration));

  let currentBase = 'base';
  let videoIdx = 0;

  // Process video clips in track order (lower tracks first, higher overlay on top)
  for (const clip of videoClips) {
    const clipLabel = `v${videoIdx}`;
    const overlayLabel = `comp${videoIdx}`;

    // Build clip filter (trim, normalize dimensions, fps, format)
    filterParts.push(
      buildVideoClipFilter(
        clip.inputIndex,
        clip,
        targetWidth,
        targetHeight,
        targetFps,
        clipLabel
      )
    );

    // Build overlay with enable expression for timeline positioning
    const clipEnd = clip.timelineStart + clip.duration;
    filterParts.push(
      buildOverlayFilter(
        currentBase,
        clipLabel,
        clip.timelineStart,
        clipEnd,
        overlayLabel
      )
    );

    currentBase = overlayLabel;
    videoIdx++;
  }

  // Finalize video output
  if (videoIdx > 0) {
    // Rename final overlay output to [vout]
    const lastFilter = filterParts[filterParts.length - 1];
    filterParts[filterParts.length - 1] = lastFilter.replace(
      `[${currentBase}]`,
      '[vout]'
    );
  } else {
    // No video clips - use base directly
    filterParts.push('[base]null[vout]');
  }

  // Process audio clips
  const audioLabels: string[] = [];

  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i];
    const audioLabel = `a${i}`;

    filterParts.push(
      buildAudioClipFilter(
        clip.inputIndex,
        clip,
        timelineDuration,
        targetSampleRate,
        audioLabel
      )
    );

    audioLabels.push(`[${audioLabel}]`);
  }

  // Mix audio or generate silence
  if (audioLabels.length > 1) {
    filterParts.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0[aout]`
    );
  } else if (audioLabels.length === 1) {
    // Single audio - rename to [aout]
    const lastAudioFilter = filterParts[filterParts.length - 1];
    filterParts[filterParts.length - 1] = lastAudioFilter.replace(
      /\[a0\]$/,
      '[aout]'
    );
  } else {
    // No audio clips - generate silence
    filterParts.push(buildSilentAudio(timelineDuration, targetSampleRate));
  }

  const filterComplex = filterParts.join(';\n');

  // Determine output maps
  const maps: string[] = ['[vout]', '[aout]'];

  return {
    inputs,
    filterComplex,
    maps,
    success: errors.length === 0,
    errors,
  };
}

/**
 * Build complete ffmpeg arguments for export
 */
export function buildExportArgs(
  graphResult: FilterGraphResult,
  settings: ExportSettings,
  duration: number
): string[] {
  const args: string[] = [];

  // Add inputs
  for (const input of graphResult.inputs) {
    args.push('-i', input.path);
  }

  // Add filter complex (if we have one)
  if (graphResult.filterComplex) {
    args.push('-filter_complex', graphResult.filterComplex);
  }

  // Add maps
  for (const map of graphResult.maps) {
    args.push('-map', map);
  }

  // Video codec and options
  const useGpu = settings.useGpuEncoding && settings.gpuEncoder;
  const videoCodec = useGpu ? settings.gpuEncoder : settings.videoCodec;
  args.push('-c:v', videoCodec!);

  // Video codec options (CRF, preset, etc.)
  // Note: GPU encoders (nvenc) use different options than software encoders
  if (settings.videoCodecOptions) {
    for (const [key, value] of Object.entries(settings.videoCodecOptions)) {
      if (useGpu) {
        // Convert software encoder options to GPU equivalents
        if (key === 'crf') {
          // NVENC uses -cq for constant quality (range 0-51, similar to CRF)
          args.push('-rc', 'constqp');
          args.push('-qp', String(value));
        } else if (key === 'preset') {
          // NVENC presets are different: p1-p7 (p1=fastest, p7=slowest)
          // Map common presets: ultrafast->p1, fast->p3, medium->p4, slow->p5, veryslow->p7
          const presetMap: Record<string, string> = {
            ultrafast: 'p1', superfast: 'p1', veryfast: 'p2', faster: 'p3',
            fast: 'p4', medium: 'p5', slow: 'p6', slower: 'p7', veryslow: 'p7'
          };
          const nvencPreset = presetMap[String(value)] || 'p5';
          args.push('-preset', nvencPreset);
        } else {
          args.push(`-${key}`, String(value));
        }
      } else {
        // Software encoder - use options directly
        args.push(`-${key}`, String(value));
      }
    }
  }

  // Note: Resolution and frame rate are handled in the filter chain for concat compatibility
  // so we don't add -s or -r flags here

  // Audio codec
  if (graphResult.maps.includes('[aout]')) {
    args.push('-c:a', settings.audioCodec);

    // Audio codec options
    if (settings.audioCodecOptions) {
      for (const [key, value] of Object.entries(settings.audioCodecOptions)) {
        if (key === 'b') {
          args.push('-b:a', String(value));
        } else if (key === 'ar') {
          args.push('-ar', String(value));
        } else if (key === 'ac') {
          args.push('-ac', String(value));
        } else {
          args.push(`-${key}`, String(value));
        }
      }
    }
  } else {
    // No audio
    args.push('-an');
  }

  // Progress reporting
  args.push('-progress', 'pipe:1');

  // Overwrite output without asking
  args.push('-y');

  // Output file
  args.push(settings.outputPath);

  return args;
}
