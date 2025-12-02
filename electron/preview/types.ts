/**
 * Preview System Types
 *
 * Core type definitions for the hybrid preview system.
 */

// =============================================================================
// SHARED TYPES (imported from main types when possible)
// =============================================================================

export interface MediaItem {
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

export interface Clip {
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
  effects?: Effect[];
}

export interface Effect {
  type: string;
  enabled: boolean;
  [key: string]: unknown;
}

export interface Track {
  id: string;
  type: 'video' | 'audio';
  name: string;
  clips: Clip[];
  muted: boolean;
  visible: boolean;
  volume: number;
}

export interface Timeline {
  tracks: Track[];
}

export interface ProjectSettings {
  resolution: [number, number];
  frameRate: number;
  backgroundColor: string;
  proxyEnabled: boolean;
  previewBitrate?: string;
}

// =============================================================================
// CHUNK CACHE TYPES
// =============================================================================

export type ChunkStatus = 'valid' | 'stale' | 'missing' | 'rendering' | 'error';

export interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  status: ChunkStatus;
  filePath: string | null;
  contentHash: string;
  isComplex: boolean; // Whether this chunk needs pre-rendering
  error?: string;
}

export interface CacheManifest {
  version: number;
  projectHash: string;
  projectMtime: number;
  chunkDuration: number;
  totalDuration: number;
  resolution: [number, number];
  frameRate: number;
  chunks: ChunkManifestEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface ChunkManifestEntry {
  index: number;
  contentHash: string;
  fileName: string;
  isComplex: boolean;
}

// =============================================================================
// FRAME EXTRACTION TYPES
// =============================================================================

export interface FrameRequest {
  time: number;
  clips: ClipAtTime[];
  resolution: [number, number];
}

export interface ClipAtTime {
  clip: Clip;
  media: MediaItem;
  mediaTime: number; // Time within the source media
  trackIndex: number;
}

export interface ExtractedFrame {
  time: number;
  width: number;
  height: number;
  data: Buffer; // Raw RGBA pixel data
}

// =============================================================================
// PLAYBACK TYPES
// =============================================================================

export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'scrubbing';

export interface PlaybackInfo {
  state: PlaybackState;
  currentTime: number;
  playbackRate: number;
}

// =============================================================================
// SCRUB AUDIO TYPES
// =============================================================================

export interface ScrubAudioState {
  isActive: boolean;
  currentTime: number;
  velocity: number; // frames per second (can be negative)
}

// =============================================================================
// COMPLEXITY DETECTION TYPES
// =============================================================================

export interface SegmentComplexity {
  startTime: number;
  endTime: number;
  isComplex: boolean;
  reasons: ComplexityReason[];
}

export type ComplexityReason =
  | 'multiple_clips'
  | 'has_effects'
  | 'has_transition'
  | 'speed_change';

// =============================================================================
// PREVIEW ENGINE TYPES
// =============================================================================

export interface PreviewEngineConfig {
  chunkDuration: number; // seconds (default: 2)
  cacheDir: string;
  maxConcurrentRenders: number;
  frameCacheSize: number; // LRU cache size for extracted frames
}

export interface PreviewEngineState {
  isInitialized: boolean;
  playback: PlaybackInfo;
  chunks: ChunkInfo[];
  renderQueue: number[]; // Chunk indices queued for rendering
  activeRenders: number[]; // Chunk indices currently rendering
}

// =============================================================================
// IPC MESSAGE TYPES
// =============================================================================

export interface PreviewIPCMessages {
  // Renderer → Main
  'preview:init': { timeline: Timeline; media: MediaItem[]; settings: ProjectSettings; duration: number };
  'preview:play': void;
  'preview:pause': void;
  'preview:seek': { time: number };
  'preview:scrubStart': { time: number };
  'preview:scrubUpdate': { time: number; velocity: number };
  'preview:scrubEnd': void;
  'preview:frameStep': { direction: -1 | 1 };
  'preview:extractFrame': { time: number };
  'preview:invalidate': { startTime: number; endTime: number };
  'preview:clearCache': void;

  // Main → Renderer
  'preview:frameReady': { time: number; imageData: ArrayBuffer; width: number; height: number };
  'preview:chunkStatus': { index: number; status: ChunkStatus; filePath?: string };
  'preview:chunkProgress': { index: number; percent: number };
  'preview:playbackTime': { time: number };
  'preview:audioSnippet': { time: number; audioData: ArrayBuffer; duration: number };
  'preview:stateChange': { state: PlaybackState };
}

// =============================================================================
// RENDER QUEUE TYPES
// =============================================================================

export type RenderPriority = 'high' | 'normal' | 'low';

export interface RenderTask {
  chunkIndex: number;
  priority: RenderPriority;
  queuedAt: number;
}
