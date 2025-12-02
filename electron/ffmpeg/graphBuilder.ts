/**
 * FFmpeg Filter Graph Builder
 *
 * Translates timeline state into ffmpeg filter_complex strings.
 * This is the core logic that converts our UI representation to ffmpeg commands.
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
}

/**
 * Build a filter graph from timeline state
 *
 * Phase 1: Supports sequential clips on single video/audio tracks
 * Future: Handle layering, effects, transitions
 */
export function buildFilterGraph(
  timeline: Timeline,
  media: MediaItem[],
  settings: ExportSettings
): FilterGraphResult {
  const errors: string[] = [];
  const inputs: InputDef[] = [];
  const mediaIndexMap = new Map<string, number>();

  // Collect all unique media files used in the timeline
  const videoTracks = timeline.tracks.filter(t => t.type === 'video');
  const audioTracks = timeline.tracks.filter(t => t.type === 'audio');

  // Get all clips sorted by timeline position
  const videoClips: ResolvedClip[] = [];
  const audioClips: ResolvedClip[] = [];

  for (const track of videoTracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const mediaItem = media.find(m => m.id === clip.mediaId);
      if (!mediaItem) {
        errors.push(`Media not found for clip: ${clip.name}`);
        continue;
      }

      // Add media to inputs if not already added
      if (!mediaIndexMap.has(mediaItem.id)) {
        const idx = inputs.length;
        inputs.push({
          index: idx,
          path: mediaItem.path,
          mediaId: mediaItem.id,
        });
        mediaIndexMap.set(mediaItem.id, idx);
      }

      videoClips.push({
        ...clip,
        mediaItem,
        inputIndex: mediaIndexMap.get(mediaItem.id)!,
      });
    }
  }

  for (const track of audioTracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;

      const mediaItem = media.find(m => m.id === clip.mediaId);
      if (!mediaItem) {
        errors.push(`Media not found for clip: ${clip.name}`);
        continue;
      }

      // Add media to inputs if not already added
      if (!mediaIndexMap.has(mediaItem.id)) {
        const idx = inputs.length;
        inputs.push({
          index: idx,
          path: mediaItem.path,
          mediaId: mediaItem.id,
        });
        mediaIndexMap.set(mediaItem.id, idx);
      }

      audioClips.push({
        ...clip,
        mediaItem,
        inputIndex: mediaIndexMap.get(mediaItem.id)!,
      });
    }
  }

  // Sort clips by timeline start
  videoClips.sort((a, b) => a.timelineStart - b.timelineStart);
  audioClips.sort((a, b) => a.timelineStart - b.timelineStart);

  // Build filter complex
  let filterComplex = '';
  const videoOutputs: string[] = [];
  const audioOutputs: string[] = [];

  // Determine target resolution and frame rate for normalization
  // This is critical for concat to work with mixed-format sources
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

  // Get audio settings for normalization
  const targetSampleRate = settings.audioCodecOptions?.ar || 48000;

  // Process video clips - normalize resolution, fps, and pixel format for concat compatibility
  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const inputIdx = clip.inputIndex;
    const outputLabel = `v${i}`;

    // Build normalization filter chain:
    // 1. Trim to clip segment
    // 2. Reset PTS
    // 3. Scale to target resolution (preserve aspect ratio, pad if needed)
    // 4. Set consistent frame rate
    // 5. Set consistent pixel format (yuv420p for maximum compatibility)
    const scaleFilter = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`;
    const fpsFilter = `fps=${targetFps}`;
    const formatFilter = 'format=yuv420p';

    // Handle image files (loop them)
    if (clip.mediaItem.type === 'image') {
      filterComplex += `[${inputIdx}:v]loop=loop=-1:size=1,trim=0:${clip.duration},setpts=PTS-STARTPTS,${scaleFilter},${fpsFilter},${formatFilter}[${outputLabel}];\n`;
    } else {
      // Video file - trim to clip segment and normalize
      const trimStart = clip.mediaIn;
      const trimEnd = clip.mediaOut;
      filterComplex += `[${inputIdx}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,${scaleFilter},${fpsFilter},${formatFilter}[${outputLabel}];\n`;
    }

    videoOutputs.push(`[${outputLabel}]`);
  }

  // Process audio clips - normalize sample rate and channels for concat compatibility
  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i];
    const inputIdx = clip.inputIndex;
    const outputLabel = `a${i}`;

    // Skip images for audio
    if (clip.mediaItem.type === 'image') continue;

    const trimStart = clip.mediaIn;
    const trimEnd = clip.mediaOut;
    // Normalize audio: trim, reset pts, resample, set channels
    filterComplex += `[${inputIdx}:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,aresample=${targetSampleRate},aformat=channel_layouts=stereo[${outputLabel}];\n`;

    audioOutputs.push(`[${outputLabel}]`);
  }

  // Concat video clips
  if (videoOutputs.length > 1) {
    filterComplex += `${videoOutputs.join('')}concat=n=${videoOutputs.length}:v=1:a=0[vout];\n`;
  } else if (videoOutputs.length === 1) {
    // Single clip - just rename output
    filterComplex = filterComplex.replace(/\[v0\];\n$/, '[vout];\n');
  }

  // Concat audio clips
  if (audioOutputs.length > 1) {
    filterComplex += `${audioOutputs.join('')}concat=n=${audioOutputs.length}:v=0:a=1[aout]`;
  } else if (audioOutputs.length === 1) {
    // Single clip - just rename output
    filterComplex = filterComplex.replace(/\[a0\];\n$/, '[aout]');
  }

  // Remove trailing semicolons/newlines
  filterComplex = filterComplex.trim().replace(/;$/, '');

  // Determine output maps
  const maps: string[] = [];
  if (videoOutputs.length > 0) {
    maps.push('[vout]');
  }
  if (audioOutputs.length > 0) {
    maps.push('[aout]');
  }

  // Handle edge case: no clips
  if (inputs.length === 0) {
    return {
      inputs: [],
      filterComplex: '',
      maps: [],
      success: false,
      errors: ['No clips in timeline to export'],
    };
  }

  // Handle edge case: only audio or only video
  if (videoOutputs.length === 0 && audioOutputs.length > 0) {
    // Audio only - map directly
    if (audioOutputs.length === 1) {
      filterComplex = filterComplex.replace('[aout]', '[aout]');
    }
  }

  if (audioOutputs.length === 0 && videoOutputs.length > 0) {
    // Video only
  }

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
