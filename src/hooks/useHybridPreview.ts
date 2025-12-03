/**
 * Hybrid Preview Hook
 *
 * Manages the hybrid preview system that combines:
 * - Real-time decode for simple clips
 * - Pre-rendered chunks for complex segments
 * - Frame extraction from source files for scrub/pause (full quality)
 * - Pitch-shifted audio during scrubbing
 * - Single-frame audio for frame stepping
 */

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';

// Chunk status types
type ChunkStatus = 'valid' | 'stale' | 'missing' | 'rendering' | 'error';

// Chunk status from the preview engine
interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  status: ChunkStatus;
  filePath: string | null;
  isComplex: boolean;
}

// Frame data from extraction
interface ExtractedFrame {
  success: boolean;
  time?: number;
  width?: number;
  height?: number;
  data?: ArrayBuffer;
  error?: string;
}

export interface HybridPreviewState {
  isInitialized: boolean;
  chunks: ChunkInfo[];
  isExtracting: boolean;
  lastExtractedFrame: ExtractedFrame | null;
  cacheStats: { totalChunks: number; cachedChunks: number; totalSize: number } | null;
}

export interface HybridPreviewActions {
  // Initialization
  initialize: () => Promise<void>;
  updateTimeline: () => Promise<void>;

  // Frame extraction (for canvas rendering)
  extractFrame: (time: number) => Promise<ExtractedFrame>;

  // Scrub mode
  startScrub: (time: number) => Promise<void>;
  updateScrub: (time: number, velocity: number) => Promise<ExtractedFrame | null>;
  endScrub: () => Promise<void>;

  // Frame stepping
  frameStep: (direction: -1 | 1, frameRate: number) => Promise<ExtractedFrame | null>;

  // Playback info
  getPlaybackInfo: (time: number) => Promise<{
    mode: 'realtime' | 'chunk';
    chunkPath: string | null;
    chunkStartTime: number;
    chunkEndTime: number;
    isComplex: boolean;
  }>;

  // Get clip for realtime playback
  getClipAtTime: (time: number) => Promise<{
    mediaPath: string;
    mediaTime: number;
    hasClip: boolean;
  } | null>;

  // Cache management
  clearCache: () => Promise<void>;
  invalidateRange: (startTime: number, endTime: number) => Promise<void>;
  prioritizeChunks: (time: number) => Promise<void>;

  // Frame prefetching for smoother playback
  prefetchFrames: (time: number, count?: number, direction?: -1 | 1) => Promise<void>;
}

export function useHybridPreview(): [HybridPreviewState, HybridPreviewActions] {
  // Redux state
  const timeline = useSelector((state: RootState) => state.timeline);
  const media = useSelector((state: RootState) => state.project.media);
  const settings = useSelector((state: RootState) => state.project.settings);
  const projectPath = useSelector((state: RootState) => state.project.path);

  // Local state
  const [isInitialized, setIsInitialized] = useState(false);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [lastExtractedFrame, setLastExtractedFrame] = useState<ExtractedFrame | null>(null);
  const [cacheStats, setCacheStats] = useState<HybridPreviewState['cacheStats']>(null);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastTimelineHashRef = useRef<string>('');

  // Calculate timeline duration
  const timelineDuration = useMemo(() => {
    let maxEnd = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.timelineStart + clip.duration;
        if (clipEnd > maxEnd) {
          maxEnd = clipEnd;
        }
      }
    }
    return maxEnd;
  }, [timeline.tracks]);

  // Timeline hash for change detection (clips only)
  const timelineHash = useMemo(() => {
    return timeline.tracks
      .flatMap((track) =>
        track.clips.map(
          (clip) =>
            `${clip.id}:${clip.timelineStart}:${clip.duration}:${clip.mediaIn}:${clip.enabled}`
        )
      )
      .join('|');
  }, [timeline.tracks]);

  // Settings hash for detecting resolution/framerate changes
  const settingsHash = useMemo(() => {
    return `${settings.resolution[0]}x${settings.resolution[1]}@${settings.frameRate}`;
  }, [settings.resolution, settings.frameRate]);

  // Track last settings hash to detect changes
  const lastSettingsHashRef = useRef<string>('');

  // Initialize audio context for scrub audio
  useEffect(() => {
    audioContextRef.current = new AudioContext();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Listen for chunk status updates from main process
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup = window.electronAPI.preview.onChunksUpdate((updatedChunks) => {
      setChunks(updatedChunks as ChunkInfo[]);
    });

    return cleanup;
  }, []);

  // Listen for audio snippets and play them
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup = window.electronAPI.preview.onAudioSnippet(async (data) => {
      if (!audioContextRef.current) return;

      try {
        // Convert ArrayBuffer to AudioBuffer
        const audioBuffer = await audioContextRef.current.decodeAudioData(
          data.audioData.slice(0)
        );

        // Create and play buffer source
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start();
      } catch (error) {
        // Silently fail - scrub audio is best effort
        console.warn('[HybridPreview] Failed to play audio snippet:', error);
      }
    });

    return cleanup;
  }, []);

  // Initialize the preview engine
  const initialize = useCallback(async () => {
    if (!window.electronAPI || timelineDuration <= 0) return;

    try {
      const result = await window.electronAPI.preview.init({
        timeline: { tracks: timeline.tracks },
        media: media.map((m) => ({
          id: m.id,
          name: m.name,
          path: m.path,
          proxyPath: m.proxyPath,
          type: m.type,
          duration: m.duration,
          metadata: m.metadata,
        })),
        settings: {
          resolution: settings.resolution,
          frameRate: settings.frameRate,
          backgroundColor: settings.backgroundColor,
          proxyEnabled: settings.proxyEnabled,
          previewBitrate: settings.previewBitrate,
        },
        duration: timelineDuration,
        projectPath,
      });

      if (result.success) {
        setIsInitialized(true);
        setChunks((result.chunks || []) as ChunkInfo[]);
        lastTimelineHashRef.current = timelineHash;
        lastSettingsHashRef.current = settingsHash;

        // Get initial cache stats
        const stats = await window.electronAPI.preview.getCacheStats();
        setCacheStats(stats);
      }
    } catch (error) {
      console.error('[HybridPreview] Failed to initialize:', error);
    }
  }, [timeline.tracks, media, settings, timelineDuration, projectPath, timelineHash, settingsHash]);

  // Update timeline after edits
  const updateTimeline = useCallback(async () => {
    if (!window.electronAPI || !isInitialized) return;

    try {
      await window.electronAPI.preview.updateTimeline({
        timeline: { tracks: timeline.tracks },
        media: media.map((m) => ({
          id: m.id,
          name: m.name,
          path: m.path,
          proxyPath: m.proxyPath,
          type: m.type,
          duration: m.duration,
          metadata: m.metadata,
        })),
        settings: {
          resolution: settings.resolution,
          frameRate: settings.frameRate,
          backgroundColor: settings.backgroundColor,
          proxyEnabled: settings.proxyEnabled,
          previewBitrate: settings.previewBitrate,
        },
        duration: timelineDuration,
      });

      lastTimelineHashRef.current = timelineHash;
    } catch (error) {
      console.error('[HybridPreview] Failed to update timeline:', error);
    }
  }, [timeline.tracks, media, settings, timelineDuration, isInitialized, timelineHash]);

  // Auto-initialize on mount and when timeline has content
  useEffect(() => {
    if (!isInitialized && timelineDuration > 0) {
      initialize();
    }
  }, [isInitialized, timelineDuration, initialize]);

  // Auto-update when timeline changes
  useEffect(() => {
    if (isInitialized && timelineHash !== lastTimelineHashRef.current) {
      updateTimeline();
    }
  }, [isInitialized, timelineHash, updateTimeline]);

  // Re-initialize when settings change (resolution, frame rate)
  // This requires clearing cache since all chunks are at the wrong resolution
  useEffect(() => {
    if (isInitialized && settingsHash !== lastSettingsHashRef.current) {
      lastSettingsHashRef.current = settingsHash;

      // Clear cache and re-initialize with new settings
      (async () => {
        if (window.electronAPI) {
          await window.electronAPI.preview.clearAllCache();
        }
        setIsInitialized(false);
        // Re-initialization will happen via the auto-initialize effect
      })();
    }
  }, [isInitialized, settingsHash]);

  // Extract a single frame
  const extractFrame = useCallback(async (time: number): Promise<ExtractedFrame> => {
    if (!window.electronAPI) {
      return { success: false, error: 'API not available' };
    }

    setIsExtracting(true);

    try {
      const result = await window.electronAPI.preview.extractFrame(time);
      setLastExtractedFrame(result);
      return result;
    } catch (error) {
      const errorResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      setLastExtractedFrame(errorResult);
      return errorResult;
    } finally {
      setIsExtracting(false);
    }
  }, []);

  // Start scrub mode
  const startScrub = useCallback(async (time: number) => {
    if (!window.electronAPI) return;
    await window.electronAPI.preview.scrubStart(time);
  }, []);

  // Update scrub position
  const updateScrub = useCallback(
    async (time: number, velocity: number): Promise<ExtractedFrame | null> => {
      if (!window.electronAPI) return null;

      try {
        const result = await window.electronAPI.preview.scrubUpdate(time, velocity);
        if (result.success && result.data) {
          setLastExtractedFrame(result);
          return result;
        }
        return null;
      } catch (error) {
        console.error('[HybridPreview] Scrub update error:', error);
        return null;
      }
    },
    []
  );

  // End scrub mode
  const endScrub = useCallback(async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.preview.scrubEnd();
  }, []);

  // Frame step
  const frameStep = useCallback(
    async (direction: -1 | 1, frameRate: number): Promise<ExtractedFrame | null> => {
      if (!window.electronAPI) return null;

      try {
        const result = await window.electronAPI.preview.frameStep(direction, frameRate);
        if (result.success) {
          setLastExtractedFrame(result);
          return result;
        }
        return null;
      } catch (error) {
        console.error('[HybridPreview] Frame step error:', error);
        return null;
      }
    },
    []
  );

  // Get playback info
  const getPlaybackInfo = useCallback(async (time: number) => {
    if (!window.electronAPI) {
      return { mode: 'realtime' as const, chunkPath: null, chunkStartTime: 0, chunkEndTime: 0, isComplex: false };
    }
    return window.electronAPI.preview.getPlaybackInfo(time);
  }, []);

  // Get clip at time for realtime playback
  const getClipAtTime = useCallback(async (time: number) => {
    if (!window.electronAPI) return null;
    return window.electronAPI.preview.getClipAtTime(time);
  }, []);

  // Clear cache
  const clearCache = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      await window.electronAPI.preview.clearAllCache();
      setChunks((prev) =>
        prev.map((c) => ({ ...c, status: 'missing' as const, filePath: null }))
      );

      const stats = await window.electronAPI.preview.getCacheStats();
      setCacheStats(stats);
    } catch (error) {
      console.error('[HybridPreview] Failed to clear cache:', error);
    }
  }, []);

  // Invalidate range
  const invalidateRange = useCallback(async (startTime: number, endTime: number) => {
    if (!window.electronAPI) return;
    await window.electronAPI.preview.invalidateRange(startTime, endTime);
  }, []);

  // Prioritize chunks near playhead
  const prioritizeChunks = useCallback(async (time: number) => {
    if (!window.electronAPI) return;
    await window.electronAPI.preview.prioritizeChunks(time);
  }, []);

  // Prefetch frames for smoother playback
  const prefetchFrames = useCallback(async (time: number, count?: number, direction?: -1 | 1) => {
    if (!window.electronAPI) return;
    await window.electronAPI.preview.prefetchFrames(time, count, direction);
  }, []);

  // State object
  const state: HybridPreviewState = {
    isInitialized,
    chunks,
    isExtracting,
    lastExtractedFrame,
    cacheStats,
  };

  // Actions object
  const actions: HybridPreviewActions = {
    initialize,
    updateTimeline,
    extractFrame,
    startScrub,
    updateScrub,
    endScrub,
    frameStep,
    getPlaybackInfo,
    getClipAtTime,
    clearCache,
    invalidateRange,
    prioritizeChunks,
    prefetchFrames,
  };

  return [state, actions];
}

/**
 * Helper hook to render extracted frame data to a canvas
 */
export function useFrameRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement>
) {
  const renderFrame = useCallback(
    (frame: ExtractedFrame) => {
      if (!frame.success || !frame.data || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Ensure canvas matches frame size
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width!;
        canvas.height = frame.height!;
      }

      // Create ImageData from RGBA buffer
      const imageData = new ImageData(
        new Uint8ClampedArray(frame.data),
        frame.width!,
        frame.height!
      );

      ctx.putImageData(imageData, 0, 0);
    },
    [canvasRef]
  );

  return renderFrame;
}
