/**
 * Chunk Renderer Hook
 *
 * Manages background rendering of timeline preview chunks.
 * Automatically renders pending chunks and updates Redux state.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../store';
import {
  initializeChunks,
  markChunksStaleInRange,
  markAllChunksStale,
  setChunkRendering,
  setChunkReady,
  setChunkError,
  selectPendingChunks,
  selectRenderingChunks,
  CHUNK_DURATION,
} from '../store/previewSlice';

// Maximum concurrent chunk renders
const MAX_CONCURRENT_RENDERS = 2;

// Debounce time for timeline changes before triggering re-render (ms)
const DEBOUNCE_TIME = 500;

/**
 * Hook to manage background chunk rendering
 */
export function useChunkRenderer() {
  const dispatch = useDispatch();

  // State from Redux
  const timeline = useSelector((state: RootState) => state.timeline);
  const media = useSelector((state: RootState) => state.project.media);
  const settings = useSelector((state: RootState) => state.project.settings);
  const chunks = useSelector((state: RootState) => state.preview.chunks);
  const proxyMode = useSelector((state: RootState) => state.preview.proxyMode);

  // Selectors
  const pendingChunks = useSelector(selectPendingChunks);
  const renderingChunks = useSelector(selectRenderingChunks);

  // Refs for debouncing and tracking
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimelineHashRef = useRef<string>('');
  const isRenderingRef = useRef(false);

  // Calculate timeline duration from clips
  const getTimelineDuration = useCallback(() => {
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

  // Compute a hash of the timeline to detect changes (memoized value, not function)
  const timelineHash = useMemo(() => {
    // Simple hash based on clip positions and durations
    const clipData = timeline.tracks
      .flatMap((track) =>
        track.clips.map((clip) => `${clip.id}:${clip.timelineStart}:${clip.duration}:${clip.mediaIn}:${clip.enabled}`)
      )
      .join('|');
    return clipData;
  }, [timeline.tracks]);

  // Render a single chunk
  const renderChunk = useCallback(
    async (chunkId: string, startTime: number, endTime: number) => {
      if (!window.electronAPI) return;

      dispatch(setChunkRendering(chunkId));

      try {
        const result = await window.electronAPI.preview.renderChunk({
          chunkId,
          startTime,
          endTime,
          timeline: {
            tracks: timeline.tracks,
          },
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
          },
          useProxies: proxyMode && settings.proxyEnabled,
        });

        if (result.success && result.filePath) {
          dispatch(setChunkReady({ id: chunkId, filePath: result.filePath }));
        } else {
          dispatch(setChunkError({ id: chunkId, error: result.error || 'Unknown error' }));
        }
      } catch (error) {
        dispatch(
          setChunkError({
            id: chunkId,
            error: error instanceof Error ? error.message : 'Render failed',
          })
        );
      }
    },
    [dispatch, timeline.tracks, media, settings, proxyMode]
  );

  // Process the render queue - renders pending chunks up to MAX_CONCURRENT_RENDERS
  // Note: Does not self-schedule; the effect below handles triggering when state changes
  const processQueue = useCallback(async () => {
    if (isRenderingRef.current) return;
    if (!window.electronAPI) return;

    // Calculate how many more we can start
    const canStart = MAX_CONCURRENT_RENDERS - renderingChunks.length;
    if (canStart <= 0 || pendingChunks.length === 0) {
      return;
    }

    isRenderingRef.current = true;

    try {
      // Start rendering the next batch
      const toRender = pendingChunks.slice(0, canStart);
      await Promise.all(
        toRender.map((chunk) =>
          renderChunk(chunk.id, chunk.startTime, chunk.endTime)
        )
      );
    } finally {
      isRenderingRef.current = false;
    }
  }, [pendingChunks, renderingChunks, renderChunk]);

  // Initialize chunks when timeline duration changes
  useEffect(() => {
    const duration = getTimelineDuration();
    const numChunks = Math.ceil(duration / CHUNK_DURATION);

    // Only reinitialize if duration changed significantly
    if (numChunks !== chunks.length && duration > 0) {
      dispatch(initializeChunks({ duration }));
    }
  }, [getTimelineDuration, chunks.length, dispatch]);

  // Detect timeline edits and mark affected chunks as stale
  useEffect(() => {
    // Skip if hash hasn't actually changed (comparing values, not references)
    if (timelineHash === lastTimelineHashRef.current) {
      return;
    }

    // Skip initial render (when ref is empty)
    if (lastTimelineHashRef.current !== '') {
      // Timeline changed - debounce the stale marking
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        // Mark all chunks as stale for now (could optimize to only mark affected chunks)
        dispatch(markAllChunksStale());
      }, DEBOUNCE_TIME);
    }

    lastTimelineHashRef.current = timelineHash;
  }, [timelineHash, dispatch]);

  // Start processing queue when chunks become pending
  useEffect(() => {
    if (pendingChunks.length > 0 && renderingChunks.length < MAX_CONCURRENT_RENDERS) {
      processQueue();
    }
  }, [pendingChunks.length, renderingChunks.length, processQueue]);

  // Listen for chunk progress updates
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup = window.electronAPI.preview.onChunkProgress((progress) => {
      // Progress updates are handled by the chunk itself
      // Could add progress to Redux if needed for UI
      console.log(`Chunk ${progress.chunkId}: ${progress.percent.toFixed(1)}%`);
    });

    return cleanup;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Cancel any active renders
      window.electronAPI?.preview.cancelAllChunks();
    };
  }, []);

  // Return control functions
  return {
    // Force re-render all chunks
    forceRenderAll: useCallback(() => {
      dispatch(markAllChunksStale());
    }, [dispatch]),

    // Mark chunks in a time range as stale
    invalidateRange: useCallback(
      (startTime: number, endTime: number) => {
        dispatch(markChunksStaleInRange({ startTime, endTime }));
      },
      [dispatch]
    ),

    // Cancel all renders
    cancelAll: useCallback(() => {
      window.electronAPI?.preview.cancelAllChunks();
    }, []),

    // Clear chunk cache
    clearCache: useCallback(async () => {
      await window.electronAPI?.preview.clearCache();
      dispatch(initializeChunks({ duration: getTimelineDuration() }));
    }, [dispatch, getTimelineDuration]),
  };
}
