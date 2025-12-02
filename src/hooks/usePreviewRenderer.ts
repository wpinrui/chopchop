/**
 * Preview Renderer Hook
 *
 * Manages the unified preview pipeline that:
 * 1. Generates proxies for any clips that don't have them
 * 2. Renders a single low-bitrate preview video of the entire timeline
 *
 * - Automatically triggers when edits are made (debounced)
 * - Uses aggressive compression for fast encoding
 * - Reports unified progress via PreviewPipelineIndicator
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../store';
import {
  startPreviewRender,
  setPreviewProgress,
  setPreviewReady,
  setPreviewError,
  markPreviewStale,
  resetPreview,
} from '../store/previewSlice';

// Debounce time for timeline changes before triggering re-render (ms)
const DEBOUNCE_TIME = 1000;

/**
 * Hook to manage background preview rendering via unified pipeline
 */
export function usePreviewRenderer() {
  const dispatch = useDispatch();

  // State from Redux
  const timeline = useSelector((state: RootState) => state.timeline);
  const media = useSelector((state: RootState) => state.project.media);
  const settings = useSelector((state: RootState) => state.project.settings);
  const preview = useSelector((state: RootState) => state.preview.preview);

  // Refs for debouncing and tracking
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimelineHashRef = useRef<string>('');
  const isRenderingRef = useRef(false);

  // Calculate timeline duration from clips
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

  // Compute a hash of the timeline to detect changes
  const timelineHash = useMemo(() => {
    const clipData = timeline.tracks
      .flatMap((track) =>
        track.clips.map((clip) => `${clip.id}:${clip.timelineStart}:${clip.duration}:${clip.mediaIn}:${clip.enabled}`)
      )
      .join('|');
    return clipData;
  }, [timeline.tracks]);

  // Run the unified preview pipeline
  const renderPreview = useCallback(async () => {
    if (isRenderingRef.current) return;
    if (!window.electronAPI) return;
    if (timelineDuration <= 0) return;

    isRenderingRef.current = true;
    dispatch(startPreviewRender());

    try {
      // Use unified pipeline: proxy generation + preview rendering
      const result = await window.electronAPI.preview.runPipeline({
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
          previewBitrate: settings.previewBitrate,
        },
        duration: timelineDuration,
        proxyScale: 0.5, // Half resolution proxies
      });

      if (result.success && result.filePath) {
        dispatch(setPreviewReady(result.filePath));
      } else {
        dispatch(setPreviewError(result.error || 'Unknown error'));
      }
    } catch (error) {
      dispatch(
        setPreviewError(error instanceof Error ? error.message : 'Pipeline failed')
      );
    } finally {
      isRenderingRef.current = false;
    }
  }, [dispatch, timeline.tracks, media, settings, timelineDuration]);

  // Detect timeline edits and trigger re-render
  useEffect(() => {
    // Skip if hash hasn't changed
    if (timelineHash === lastTimelineHashRef.current) {
      return;
    }

    // Skip initial render (when ref is empty) - but still set the ref
    const isInitial = lastTimelineHashRef.current === '';
    lastTimelineHashRef.current = timelineHash;

    if (isInitial) {
      // On initial load, start a render if there's content
      if (timelineDuration > 0) {
        debounceTimerRef.current = setTimeout(() => {
          renderPreview();
        }, DEBOUNCE_TIME);
      }
      return;
    }

    // Timeline changed - mark as stale and debounce the re-render
    dispatch(markPreviewStale());

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      renderPreview();
    }, DEBOUNCE_TIME);
  }, [timelineHash, timelineDuration, dispatch, renderPreview]);

  // Listen for pipeline progress updates (unified progress from both phases)
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup = window.electronAPI.preview.onPipelineProgress((progress) => {
      dispatch(setPreviewProgress(progress.overallPercent));
    });

    return cleanup;
  }, [dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      window.electronAPI?.preview.cancelPipeline();
    };
  }, []);

  // Return control functions
  return {
    // Force re-render the preview
    forceRender: useCallback(() => {
      renderPreview();
    }, [renderPreview]),

    // Cancel current pipeline
    cancelRender: useCallback(() => {
      window.electronAPI?.preview.cancelPipeline();
      dispatch(resetPreview());
    }, [dispatch]),

    // Get preview state
    preview,
    isRendering: preview.status === 'rendering',
    isReady: preview.status === 'ready',
    isStale: preview.status === 'stale',
    progress: preview.progress,
    filePath: preview.filePath,
  };
}
