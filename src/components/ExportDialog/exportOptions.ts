/**
 * Export Options Configuration
 *
 * Centralized configuration for export dialog options.
 * Single Responsibility: Export option definitions only.
 */

export const VIDEO_CODECS = [
  { value: 'libx264', label: 'H.264 (libx264)', presets: true },
  { value: 'libx265', label: 'H.265/HEVC (libx265)', presets: true },
  { value: 'libvpx-vp9', label: 'VP9 (libvpx)', presets: false },
  { value: 'libaom-av1', label: 'AV1 (libaom)', presets: false },
  { value: 'prores_ks', label: 'ProRes (prores_ks)', presets: false },
  { value: 'dnxhd', label: 'DNxHD/DNxHR', presets: false },
] as const;

export const AUDIO_CODECS = [
  { value: 'aac', label: 'AAC' },
  { value: 'libmp3lame', label: 'MP3' },
  { value: 'libopus', label: 'Opus' },
  { value: 'flac', label: 'FLAC (lossless)' },
  { value: 'pcm_s16le', label: 'PCM 16-bit (uncompressed)' },
] as const;

export const FORMATS = [
  { value: 'mp4', label: 'MP4', extensions: ['mp4'] },
  { value: 'mov', label: 'QuickTime (MOV)', extensions: ['mov'] },
  { value: 'webm', label: 'WebM', extensions: ['webm'] },
  { value: 'mkv', label: 'Matroska (MKV)', extensions: ['mkv'] },
  { value: 'avi', label: 'AVI', extensions: ['avi'] },
] as const;

export const RESOLUTIONS = [
  { value: 'source', label: 'Source' },
  { value: '3840x2160', label: '4K (3840×2160)' },
  { value: '2560x1440', label: '1440p (2560×1440)' },
  { value: '1920x1080', label: '1080p (1920×1080)' },
  { value: '1280x720', label: '720p (1280×720)' },
  { value: '854x480', label: '480p (854×480)' },
] as const;

export const FRAME_RATES = [
  { value: 'source', label: 'Source' },
  { value: '60', label: '60 fps' },
  { value: '59.94', label: '59.94 fps' },
  { value: '50', label: '50 fps' },
  { value: '30', label: '30 fps' },
  { value: '29.97', label: '29.97 fps' },
  { value: '25', label: '25 fps' },
  { value: '24', label: '24 fps' },
  { value: '23.976', label: '23.976 fps' },
] as const;

export const ENCODING_PRESETS = [
  'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
  'medium', 'slow', 'slower', 'veryslow'
] as const;

export const AUDIO_BITRATES = ['96k', '128k', '192k', '256k', '320k'] as const;

export const SAMPLE_RATES = ['44100', '48000', '96000'] as const;

export const CHANNEL_OPTIONS = [
  { value: '1', label: 'Mono' },
  { value: '2', label: 'Stereo' },
  { value: '6', label: '5.1 Surround' },
] as const;

export function getFormatExtension(format: string): string {
  const formatInfo = FORMATS.find(f => f.value === format);
  return formatInfo?.extensions[0] || 'mp4';
}

export function codecSupportsPresets(codec: string): boolean {
  return VIDEO_CODECS.find(c => c.value === codec)?.presets ?? false;
}

export function getQualityHint(crf: number): string {
  if (crf <= 18) return '(High quality)';
  if (crf <= 28) return '(Balanced)';
  return '(Smaller file)';
}
