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
