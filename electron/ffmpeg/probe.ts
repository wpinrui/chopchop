/**
 * FFprobe Media Analysis
 *
 * Uses ffprobe to extract metadata from media files.
 */

import { runFFprobe, runFFmpeg } from './runner';
import type { MediaMetadata } from '../../src/types';

/**
 * Raw ffprobe stream info
 */
interface FFprobeStream {
  index: number;
  codec_name: string;
  codec_type: 'video' | 'audio' | 'subtitle' | 'data';
  codec_long_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

/**
 * Raw ffprobe format info
 */
interface FFprobeFormat {
  filename: string;
  format_name: string;
  format_long_name: string;
  duration: string;
  size: string;
  bit_rate: string;
}

/**
 * Raw ffprobe output
 */
interface FFprobeOutput {
  streams: FFprobeStream[];
  format: FFprobeFormat;
}

/**
 * Probe a media file and return metadata
 */
export async function probeMediaFile(
  filePath: string
): Promise<MediaMetadata | null> {
  try {
    const result = await runFFprobe([
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    if (!result.success) {
      console.error('ffprobe failed:', result.stderr);
      return null;
    }

    const data: FFprobeOutput = JSON.parse(result.stdout);
    return parseFFprobeOutput(data);
  } catch (error) {
    console.error('Failed to probe media file:', error);
    return null;
  }
}

/**
 * Parse ffprobe output into our MediaMetadata format
 */
function parseFFprobeOutput(data: FFprobeOutput): MediaMetadata {
  const videoStream = data.streams.find((s) => s.codec_type === 'video');
  const audioStream = data.streams.find((s) => s.codec_type === 'audio');

  const metadata: MediaMetadata = {
    format: data.format.format_name,
    fileSize: parseInt(data.format.size, 10),
  };

  // Video metadata
  if (videoStream) {
    metadata.width = videoStream.width;
    metadata.height = videoStream.height;
    metadata.videoCodec = videoStream.codec_name;

    if (videoStream.bit_rate) {
      metadata.videoBitrate = parseInt(videoStream.bit_rate, 10);
    }

    // Parse frame rate
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (den !== 0) {
        metadata.frameRate = num / den;
      }
    } else if (videoStream.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
      if (den !== 0) {
        metadata.frameRate = num / den;
      }
    }
  }

  // Audio metadata
  if (audioStream) {
    metadata.audioCodec = audioStream.codec_name;

    if (audioStream.bit_rate) {
      metadata.audioBitrate = parseInt(audioStream.bit_rate, 10);
    }

    if (audioStream.sample_rate) {
      metadata.sampleRate = parseInt(audioStream.sample_rate, 10);
    }

    metadata.channels = audioStream.channels;
  }

  return metadata;
}

/**
 * Get duration of a media file in seconds
 */
export async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const result = await runFFprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);

    if (result.success && result.stdout.trim()) {
      return parseFloat(result.stdout.trim());
    }

    return 0;
  } catch {
    return 0;
  }
}

/**
 * Generate thumbnail for a media file at specified time
 * For images, timeSeconds is ignored since images don't have time dimension
 */
export async function generateThumbnail(
  filePath: string,
  outputPath: string,
  timeSeconds: number = 0
): Promise<boolean> {
  try {
    const ext = filePath.toLowerCase().split('.').pop() || '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'];
    const isImage = imageExts.includes(ext);

    // For images, just scale to thumbnail size (no seek needed)
    // For videos, seek to the specified time first
    const args = isImage
      ? [
          '-i',
          filePath,
          '-vf',
          'scale=320:-1',  // Scale to 320px width, maintain aspect ratio
          '-vframes',
          '1',
          '-q:v',
          '2',
          '-y',
          outputPath,
        ]
      : [
          '-ss',
          timeSeconds.toString(),
          '-i',
          filePath,
          '-vframes',
          '1',
          '-q:v',
          '2',
          '-y',
          outputPath,
        ];

    const result = await runFFmpeg(args);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Generate waveform data from audio in a media file
 * Returns an array of normalized peak values (0-1) for visualization
 *
 * @param filePath - Path to the media file
 * @param numSamples - Number of peak samples to generate (default 4000 for detailed waveforms)
 * @returns Array of peak values or null if extraction failed
 */
export async function generateWaveformData(
  filePath: string,
  numSamples: number = 4000
): Promise<number[] | null> {
  try {
    // Use ffmpeg to extract audio peaks using the astats filter
    // This generates volume statistics per audio frame
    const result = await runFFmpeg([
      '-i',
      filePath,
      '-af',
      `aformat=channel_layouts=mono,aresample=8000,asetnsamples=n=${Math.ceil(8000 / (numSamples / 10))}:p=0,astats=metadata=1:reset=1`,
      '-f',
      'null',
      '-'
    ]);

    // astats output goes to stderr
    const output = result.stderr;

    // Parse peak levels from astats output
    // Format: [Parsed_astats_2 @ ...] Peak level dB: -XX.XX
    const peakMatches = output.matchAll(/Peak level dB:\s*([-\d.]+)/g);
    const peaks: number[] = [];

    for (const match of peakMatches) {
      const dbValue = parseFloat(match[1]);
      // Convert dB to linear (0-1 range)
      // dB values typically range from -inf to 0, we'll clamp at -60dB as silence
      if (isFinite(dbValue)) {
        const linear = Math.pow(10, dbValue / 20);
        peaks.push(Math.min(1, Math.max(0, linear)));
      }
    }

    if (peaks.length === 0) {
      // Fallback: try extracting raw audio samples
      return await generateWaveformFromRawAudio(filePath, numSamples);
    }

    // Resample peaks to target number of samples
    return resamplePeaks(peaks, numSamples);
  } catch (error) {
    console.error('Failed to generate waveform data:', error);
    return null;
  }
}

/**
 * Fallback method: extract raw audio samples and calculate peaks
 */
async function generateWaveformFromRawAudio(
  filePath: string,
  numSamples: number
): Promise<number[] | null> {
  try {
    // Extract audio as 8-bit unsigned PCM at low sample rate
    const result = await runFFmpeg([
      '-i',
      filePath,
      '-ac', '1',           // Mono
      '-ar', '8000',        // 8kHz sample rate
      '-f', 's16le',        // 16-bit signed little-endian PCM
      '-acodec', 'pcm_s16le',
      '-'                   // Output to stdout
    ]);

    if (!result.success || !result.stdout) {
      return null;
    }

    // Parse the raw PCM data
    const buffer = Buffer.from(result.stdout, 'binary');
    const samples: number[] = [];

    // Read 16-bit samples
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i);
      samples.push(Math.abs(sample) / 32768); // Normalize to 0-1
    }

    if (samples.length === 0) {
      return null;
    }

    // Calculate peaks for each bucket
    const bucketSize = Math.ceil(samples.length / numSamples);
    const peaks: number[] = [];

    for (let i = 0; i < numSamples; i++) {
      const start = i * bucketSize;
      const end = Math.min(start + bucketSize, samples.length);

      if (start >= samples.length) {
        peaks.push(0);
        continue;
      }

      let maxPeak = 0;
      for (let j = start; j < end; j++) {
        if (samples[j] > maxPeak) {
          maxPeak = samples[j];
        }
      }
      peaks.push(maxPeak);
    }

    return peaks;
  } catch (error) {
    console.error('Failed to generate waveform from raw audio:', error);
    return null;
  }
}

/**
 * Resample an array of peaks to a target length
 */
function resamplePeaks(peaks: number[], targetLength: number): number[] {
  if (peaks.length === targetLength) {
    return peaks;
  }

  const result: number[] = [];
  const ratio = peaks.length / targetLength;

  for (let i = 0; i < targetLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);

    // Take max peak in this range
    let maxPeak = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > maxPeak) {
        maxPeak = peaks[j];
      }
    }
    result.push(maxPeak);
  }

  return result;
}

/**
 * Determine media type from file extension or probe data
 */
export function getMediaType(
  filePath: string,
  metadata?: MediaMetadata
): 'video' | 'audio' | 'image' {
  const ext = filePath.toLowerCase().split('.').pop() || '';

  // Image formats
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'];
  if (imageExts.includes(ext)) {
    return 'image';
  }

  // Audio-only formats
  const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma'];
  if (audioExts.includes(ext)) {
    return 'audio';
  }

  // If we have metadata, check for video codec
  if (metadata && metadata.videoCodec) {
    return 'video';
  }

  // Default to video for video container formats
  return 'video';
}
