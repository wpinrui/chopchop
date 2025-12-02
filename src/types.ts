/**
 * ChopChop Core Types
 * 
 * This file defines the core data structures used throughout the application.
 * Keep in sync with the project file format (.chopchop JSON schema).
 */

// =============================================================================
// PROJECT & SETTINGS
// =============================================================================

export interface Project {
  version: string;
  name: string;
  path: string | null;
  dirty: boolean;
  settings: ProjectSettings;
  media: MediaItem[];
}

export interface ProjectSettings {
  // Sequence/output format
  resolution: [number, number];
  frameRate: number;
  backgroundColor: string; // hex color for gaps/letterboxing
  sequenceInitialized: boolean; // true after first clip sets defaults

  // Preview settings
  previewQuality: number; // 1.0 = full, 0.5 = half, 0.25 = quarter resolution

  // Proxy settings
  proxyEnabled: boolean;
  proxyScale: number; // 0.25, 0.5, etc.

  // Audio settings
  audioSampleRate: number;
  audioChannels: number;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  resolution: [1920, 1080],
  frameRate: 30,
  backgroundColor: '#000000',
  sequenceInitialized: false,
  previewQuality: 0.25, // Default to quarter resolution for better performance
  proxyEnabled: true,
  proxyScale: 0.25, // Quarter resolution proxy for fast playback
  audioSampleRate: 48000,
  audioChannels: 2,
};

// =============================================================================
// MEDIA
// =============================================================================

export interface MediaItem {
  id: string;
  name: string;
  path: string;
  proxyPath: string | null;
  type: MediaType;
  duration: number; // seconds
  metadata: MediaMetadata;
  thumbnailPath: string | null;
  waveformData: number[] | null; // Normalized peak values (0-1) for audio waveform display
}

export type MediaType = 'video' | 'audio' | 'image';

export interface MediaMetadata {
  // Video
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: string;
  videoBitrate?: number;
  
  // Audio
  audioCodec?: string;
  audioBitrate?: number;
  sampleRate?: number;
  channels?: number;
  
  // Common
  format: string;
  fileSize: number;
  createdAt?: string;
}

// =============================================================================
// TIMELINE
// =============================================================================

export interface Timeline {
  tracks: Track[];
  playheadPosition: number;
  inPoint: number | null;
  outPoint: number | null;
  markers: Marker[];
  zoom: number; // pixels per second
  scrollX: number;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  clips: Clip[];
  muted: boolean;
  locked: boolean;
  visible: boolean; // video only
  volume: number; // audio only, 0-2 (1 = 100%)
}

export type TrackType = 'video' | 'audio';

export interface Clip {
  id: string;
  type: ClipType;
  mediaId: string | null; // null for generators (titles, solids)
  trackId: string;

  // Timing (all in seconds)
  timelineStart: number;
  duration: number;
  mediaIn: number; // source in point
  mediaOut: number; // source out point

  // Properties
  name: string;
  enabled: boolean;
  effects: Effect[];

  // Linking - clips with same linkId move together
  linkId?: string;

  // Type-specific
  videoProperties?: VideoClipProperties;
  audioProperties?: AudioClipProperties;
  titleProperties?: TitleProperties;
}

export type ClipType = 'video' | 'audio' | 'title' | 'solid' | 'adjustment';

export interface VideoClipProperties {
  opacity: number; // 0-1
  scale: number; // 1 = 100%
  positionX: number; // pixels from center
  positionY: number;
  rotation: number; // degrees
}

export interface AudioClipProperties {
  volume: number; // 0-2 (1 = 100%)
  pan: number; // -1 to 1 (0 = center)
}

export interface TitleProperties {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: string; // hex
  backgroundColor: string | null;
  backgroundOpacity: number;
  alignment: 'left' | 'center' | 'right';
  verticalAlignment: 'top' | 'middle' | 'bottom';
  positionX: number;
  positionY: number;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string; // hex
}

// =============================================================================
// EFFECTS & TRANSITIONS
// =============================================================================

export type Effect = 
  | ColorCorrectionEffect
  | RawFilterEffect;

export interface ColorCorrectionEffect {
  type: 'colorCorrection';
  enabled: boolean;
  exposure: number; // -2 to 2
  contrast: number; // -100 to 100
  saturation: number; // 0 to 2
  temperature: number; // -100 to 100
  tint: number; // -100 to 100
}

export interface RawFilterEffect {
  type: 'raw';
  enabled: boolean;
  ffmpegArgs: string; // e.g., "rotate=angle=45*PI/180"
  displayName: string; // e.g., "rotate (raw)"
  sourceCapability: string; // e.g., "filter:rotate"
}

export interface Transition {
  id: string;
  type: TransitionType;
  clipAId: string;
  clipBId: string;
  duration: number;
}

export type TransitionType = 
  | 'crossDissolve'
  | 'dipToBlack'
  | 'dipToWhite'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown';

// =============================================================================
// FFMPEG CAPABILITIES
// =============================================================================

export interface FFmpegCapabilities {
  filters: FilterCapability[];
  codecs: CodecCapability[];
  formats: FormatCapability[];
  protocols: string[];
  version: string;
  buildConfiguration: string;
}

export interface FilterCapability {
  name: string;
  description: string;
  type: 'video' | 'audio' | 'other';
  inputs: number; // -1 = dynamic
  outputs: number;
  flags: string[];
  options: FilterOption[];
  tags: string[];
  implemented: boolean;
}

export interface FilterOption {
  name: string;
  type: FilterOptionType;
  description: string;
  default: string | number | boolean | null;
  min?: number;
  max?: number;
  enumValues?: string[];
}

export type FilterOptionType = 
  | 'int'
  | 'int64'
  | 'float'
  | 'double'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'flags'
  | 'color'
  | 'rational'
  | 'duration'
  | 'image_size'
  | 'video_rate'
  | 'pix_fmt'
  | 'sample_fmt';

export interface CodecCapability {
  name: string;
  longName: string;
  type: 'video' | 'audio' | 'subtitle';
  isEncoder: boolean;
  isDecoder: boolean;
  flags: string[];
  options: FilterOption[];
  tags: string[];
  implemented: boolean;
}

export interface FormatCapability {
  name: string;
  longName: string;
  isMuxer: boolean;
  isDemuxer: boolean;
  extensions: string[];
  mimeTypes: string[];
  tags: string[];
  implemented: boolean;
}

// =============================================================================
// UI STATE
// =============================================================================

export interface UIState {
  selectedClipIds: string[];
  selectedTrackId: string | null;
  activeTool: Tool;
  panelLayout: PanelLayout;
  commandCrafterOpen: boolean;
  inspectorTab: InspectorTab;
}

export type Tool = 'select' | 'razor' | 'hand' | 'slip' | 'slide';

export type InspectorTab = 'clip' | 'effects' | 'audio' | 'text';

export interface PanelLayout {
  preset: 'default' | 'editing' | 'color' | 'audio' | 'custom';
  panels: PanelConfig[];
}

export interface PanelConfig {
  id: string;
  type: PanelType;
  position: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export type PanelType = 
  | 'mediaBin'
  | 'sourceMonitor'
  | 'programMonitor'
  | 'timeline'
  | 'inspector'
  | 'commandCrafter'
  | 'effectsBrowser';

// =============================================================================
// PREVIEW STATE
// =============================================================================

export interface PreviewState {
  isPlaying: boolean;
  playbackRate: number;
  chunks: ChunkStatus[];
  proxyMode: boolean;
  renderQueue: RenderJob[];
  // Single preview file state (simpler than chunk-based)
  preview: PreviewFile;
}

export interface PreviewFile {
  status: 'idle' | 'rendering' | 'ready' | 'stale' | 'error';
  filePath: string | null;
  progress: number; // 0-100
  error: string | null;
}

export interface ChunkStatus {
  id: string;
  startTime: number;
  endTime: number;
  status: 'pending' | 'rendering' | 'ready' | 'stale' | 'error';
  filePath: string | null;
  error: string | null;
}

export interface RenderJob {
  id: string;
  type: 'chunk' | 'proxy' | 'export';
  status: 'queued' | 'running' | 'complete' | 'error';
  progress: number; // 0-100
  mediaId?: string;
  outputPath?: string;
}

// =============================================================================
// HISTORY (UNDO/REDO)
// =============================================================================

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  maxEntries: number;
}

export interface HistoryEntry {
  timestamp: number;
  actionName: string;
  timeline: Timeline;
  media: MediaItem[];
}

// =============================================================================
// EXPORT
// =============================================================================

export interface ExportSettings {
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

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  settings: Partial<ExportSettings>;
  icon?: string;
}

export const DEFAULT_EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'youtube-1080p',
    name: 'YouTube 1080p',
    description: 'H.264, 1080p, AAC audio',
    settings: {
      format: 'mp4',
      videoCodec: 'libx264',
      videoCodecOptions: { crf: 18, preset: 'slow' },
      audioCodec: 'aac',
      audioCodecOptions: { b: '192k' },
      resolution: [1920, 1080],
    },
  },
  {
    id: 'youtube-4k',
    name: 'YouTube 4K',
    description: 'H.264, 4K, AAC audio',
    settings: {
      format: 'mp4',
      videoCodec: 'libx264',
      videoCodecOptions: { crf: 18, preset: 'slow' },
      audioCodec: 'aac',
      audioCodecOptions: { b: '320k' },
      resolution: [3840, 2160],
    },
  },
  {
    id: 'twitter',
    name: 'Twitter/X',
    description: 'H.264, 720p, optimized for upload',
    settings: {
      format: 'mp4',
      videoCodec: 'libx264',
      videoCodecOptions: { crf: 23, preset: 'medium' },
      audioCodec: 'aac',
      audioCodecOptions: { b: '128k' },
      resolution: [1280, 720],
    },
  },
  {
    id: 'proxy',
    name: 'Proxy (Editing)',
    description: 'Fast encode, half resolution',
    settings: {
      format: 'mp4',
      videoCodec: 'libx264',
      videoCodecOptions: { crf: 23, preset: 'ultrafast' },
      audioCodec: 'aac',
      audioCodecOptions: { b: '128k' },
      resolution: 'source', // will be halved
    },
  },
];

// =============================================================================
// ROOT STATE (REDUX)
// =============================================================================

export interface RootState {
  project: Project;
  timeline: Timeline;
  ui: UIState;
  preview: PreviewState;
  history: HistoryState;
  ffmpeg: {
    capabilities: FFmpegCapabilities | null;
    capabilitiesLoading: boolean;
    capabilitiesError: string | null;
  };
}
