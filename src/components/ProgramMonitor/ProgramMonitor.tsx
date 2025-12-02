/**
 * Program Monitor Component - Hybrid Preview Architecture
 *
 * High-performance video playback using:
 * - Native video.play() for forward playback of pre-rendered preview
 * - Canvas + frame extraction from source files for pause/scrub (full quality)
 * - Pitch-shifted audio during scrubbing
 * - Single-frame audio for frame stepping (accurate cutting)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  Volume2,
  VolumeX,
  Loader,
} from 'lucide-react';
import type { RootState } from '../../store';
import { setActivePane, setPlayingPane } from '../../store/uiSlice';
import { setPlayheadPosition } from '../../store/timelineSlice';
import { updateSettings } from '../../store/projectSlice';
import TimecodeInput from '../TimecodeInput/TimecodeInput';
import { useHybridPreview, useFrameRenderer } from '../../hooks/useHybridPreview';
import './ProgramMonitor.css';

// Preview quality options
const PREVIEW_QUALITY_OPTIONS = [
  { value: 1, label: 'Full' },
  { value: 0.5, label: '1/2' },
  { value: 0.25, label: '1/4' },
  { value: 0.125, label: '1/8' },
];

// Display mode: video for playback, canvas for pause/scrub
type DisplayMode = 'video' | 'canvas';

const ProgramMonitor: React.FC = () => {
  const dispatch = useDispatch();

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);

  // Container size for calculating display dimensions
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Redux state
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const playheadPosition = useSelector((state: RootState) => state.timeline.playheadPosition);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const playingPane = useSelector((state: RootState) => state.ui.playingPane);

  // Sequence settings
  const sequenceResolution = useSelector((state: RootState) => state.project.settings.resolution);
  const backgroundColor = useSelector((state: RootState) => state.project.settings.backgroundColor);
  const previewQuality = useSelector((state: RootState) => state.project.settings.previewQuality) ?? 1;

  // Preview file state (legacy - for video playback fallback)
  const preview = useSelector((state: RootState) => state.preview.preview);
  const previewReady = preview.status === 'ready';
  const previewRendering = preview.status === 'rendering';
  const renderProgress = preview.progress;

  const [fullWidth, fullHeight] = sequenceResolution;
  const seqWidth = Math.round(fullWidth * previewQuality);
  const seqHeight = Math.round(fullHeight * previewQuality);

  const isActive = activePane === 'program';
  const shouldHandleKeyboard = playingPane === 'program' ||
    (playingPane === null && (isActive || activePane === 'timeline'));

  // Local UI state
  const [isMuted, setIsMuted] = useState(false);
  const [showLoadingDialog, setShowLoadingDialog] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('canvas');

  // Hybrid preview system
  const [previewState, previewActions] = useHybridPreview();
  const renderFrame = useFrameRenderer(canvasRef);

  // Scrub state for velocity tracking
  const scrubStateRef = useRef({
    lastTime: 0,
    lastPosition: 0,
    isActive: false,
  });

  // Calculate timeline duration
  const timelineDuration = Math.max(
    ...tracks.flatMap(track =>
      track.clips.map(clip => clip.timelineStart + clip.duration)
    ),
    1 // Minimum 1 second
  );

  // Track container size with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Calculate canvas/video display size to fill container while maintaining aspect ratio
  const displaySize = (() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { width: seqWidth, height: seqHeight };
    }

    const containerAspect = containerSize.width / containerSize.height;
    const seqAspect = seqWidth / seqHeight;

    if (seqAspect > containerAspect) {
      return {
        width: containerSize.width,
        height: containerSize.width / seqAspect,
      };
    } else {
      return {
        width: containerSize.height * seqAspect,
        height: containerSize.height,
      };
    }
  })();

  // Format timecode as HH:MM:SS:FF
  const formatTimecode = useCallback((seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }, [fps]);

  // Extract and render frame at current playhead
  const extractAndRenderFrame = useCallback(async (time: number) => {
    const frame = await previewActions.extractFrame(time);
    if (frame.success && frame.data) {
      renderFrame(frame);
    }
  }, [previewActions, renderFrame]);

  // Initialize preview and extract first frame when ready
  useEffect(() => {
    if (previewState.isInitialized && !isPlaying) {
      extractAndRenderFrame(playheadPosition);
    }
  }, [previewState.isInitialized]);

  // Extract frame when paused and playhead changes (from timeline scrub, timecode input, etc.)
  const lastExtractedTimeRef = useRef<number>(-1);
  useEffect(() => {
    if (!isPlaying && !isScrubbing && previewState.isInitialized) {
      // Avoid extracting the same frame multiple times
      if (Math.abs(playheadPosition - lastExtractedTimeRef.current) > 0.001) {
        lastExtractedTimeRef.current = playheadPosition;
        extractAndRenderFrame(playheadPosition);
      }
    }
  }, [playheadPosition, isPlaying, isScrubbing, previewState.isInitialized, extractAndRenderFrame]);

  // Play handler
  const handlePlay = useCallback(() => {
    if (!previewReady) {
      setShowLoadingDialog(true);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    setIsPlaying(true);
    setDisplayMode('video');
    dispatch(setPlayingPane('program'));

    video.currentTime = playheadPosition;
    video.play();
  }, [previewReady, playheadPosition, dispatch]);

  // Pause handler
  const handlePause = useCallback(async () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
    }

    setIsPlaying(false);
    setDisplayMode('canvas');
    dispatch(setPlayingPane(null));

    // Extract frame at pause position for full quality display
    const currentTime = video?.currentTime ?? playheadPosition;
    dispatch(setPlayheadPosition(currentTime));
    lastExtractedTimeRef.current = currentTime;
    await extractAndRenderFrame(currentTime);
  }, [dispatch, playheadPosition, extractAndRenderFrame]);

  // Toggle play/pause
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  }, [isPlaying, handlePlay, handlePause]);

  // Frame step with audio
  const handleFrameStep = useCallback(async (direction: -1 | 1) => {
    // Pause if playing
    if (isPlaying) {
      const video = videoRef.current;
      if (video) video.pause();
      setIsPlaying(false);
      setDisplayMode('canvas');
      dispatch(setPlayingPane(null));
    }

    // Use hybrid preview frame step (includes audio)
    const frame = await previewActions.frameStep(direction);

    if (frame && frame.success && frame.data) {
      renderFrame(frame);
      // Update Redux with new time
      if (frame.time !== undefined) {
        lastExtractedTimeRef.current = frame.time;
        dispatch(setPlayheadPosition(frame.time));
      }
    } else {
      // Fallback: manual step
      const frameDuration = 1 / fps;
      const newTime = Math.max(0, Math.min(timelineDuration, playheadPosition + direction * frameDuration));
      lastExtractedTimeRef.current = newTime;
      dispatch(setPlayheadPosition(newTime));
      await extractAndRenderFrame(newTime);
    }
  }, [isPlaying, previewActions, renderFrame, fps, timelineDuration, playheadPosition, dispatch, extractAndRenderFrame]);

  // Seek to position
  const handleSeek = useCallback(async (time: number) => {
    const clampedTime = Math.max(0, Math.min(timelineDuration, time));
    lastExtractedTimeRef.current = clampedTime;
    dispatch(setPlayheadPosition(clampedTime));

    if (isPlaying) {
      const video = videoRef.current;
      if (video) {
        video.currentTime = clampedTime;
      }
    } else {
      await extractAndRenderFrame(clampedTime);
    }
  }, [timelineDuration, isPlaying, dispatch, extractAndRenderFrame]);

  // Go to start
  const handleGoToStart = useCallback(() => {
    if (isPlaying) handlePause();
    handleSeek(0);
  }, [isPlaying, handlePause, handleSeek]);

  // Go to end
  const handleGoToEnd = useCallback(() => {
    if (isPlaying) handlePause();
    handleSeek(timelineDuration);
  }, [isPlaying, handlePause, handleSeek, timelineDuration]);

  // Scrub bar handlers
  const getTimeFromMouseX = useCallback((clientX: number): number => {
    const scrubBar = scrubBarRef.current;
    if (!scrubBar) return 0;

    const rect = scrubBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * timelineDuration;
  }, [timelineDuration]);

  // Start scrubbing
  const handleScrubStart = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();

    // Pause if playing
    if (isPlaying) {
      const video = videoRef.current;
      if (video) video.pause();
      setIsPlaying(false);
      dispatch(setPlayingPane(null));
    }

    setIsScrubbing(true);
    setDisplayMode('canvas');

    const time = getTimeFromMouseX(e.clientX);
    lastExtractedTimeRef.current = time;
    dispatch(setPlayheadPosition(time));

    // Start hybrid scrub (for audio)
    await previewActions.startScrub(time);

    // Initialize scrub velocity tracking
    scrubStateRef.current = {
      lastTime: performance.now(),
      lastPosition: time,
      isActive: true,
    };

    // Extract initial frame
    await extractAndRenderFrame(time);
  }, [isPlaying, getTimeFromMouseX, previewActions, dispatch, extractAndRenderFrame]);

  // Handle scrub mouse move
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = async (e: MouseEvent) => {
      const time = getTimeFromMouseX(e.clientX);
      lastExtractedTimeRef.current = time;
      dispatch(setPlayheadPosition(time));

      // Calculate velocity for scrub audio
      const now = performance.now();
      const deltaTime = (now - scrubStateRef.current.lastTime) / 1000;
      const deltaPosition = time - scrubStateRef.current.lastPosition;
      const velocity = deltaTime > 0 ? deltaPosition / deltaTime : 0;

      scrubStateRef.current.lastTime = now;
      scrubStateRef.current.lastPosition = time;

      // Update scrub (includes audio)
      const frame = await previewActions.updateScrub(time, velocity);
      if (frame && frame.success && frame.data) {
        renderFrame(frame);
      } else {
        // Fallback to regular frame extraction
        await extractAndRenderFrame(time);
      }
    };

    const handleMouseUp = async () => {
      setIsScrubbing(false);
      scrubStateRef.current.isActive = false;

      // End hybrid scrub
      await previewActions.endScrub();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, getTimeFromMouseX, previewActions, renderFrame, dispatch, extractAndRenderFrame]);

  // Video timeupdate handler - sync to Redux during playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (isPlaying) {
        dispatch(setPlayheadPosition(video.currentTime));
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setDisplayMode('canvas');
      dispatch(setPlayingPane(null));
      dispatch(setPlayheadPosition(timelineDuration));
      lastExtractedTimeRef.current = timelineDuration;
      extractAndRenderFrame(timelineDuration);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [isPlaying, timelineDuration, dispatch, extractAndRenderFrame]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!shouldHandleKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'k':
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;

        case 'j':
          e.preventDefault();
          // TODO: JKL shuttle - for now just step back
          handleFrameStep(-1);
          break;

        case 'l':
          e.preventDefault();
          // TODO: JKL shuttle - for now just step forward or play
          if (!isPlaying) {
            handlePlay();
          } else {
            // Already playing, could increase speed here
          }
          break;

        case 'arrowleft':
          e.preventDefault();
          handleFrameStep(-1);
          break;

        case 'arrowright':
          e.preventDefault();
          handleFrameStep(1);
          break;

        case 'home':
          e.preventDefault();
          handleGoToStart();
          break;

        case 'end':
          e.preventDefault();
          handleGoToEnd();
          break;

        case 'm':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setIsMuted(!isMuted);
            if (videoRef.current) {
              videoRef.current.muted = !isMuted;
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldHandleKeyboard, handlePlayPause, handleFrameStep, handleGoToStart, handleGoToEnd, handlePlay, isPlaying, isMuted]);

  // Set active pane when clicked
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      dispatch(setActivePane('program'));
    }
  }, [dispatch, isActive]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  }, [isMuted]);

  // Handle timecode input change
  const handleTimecodeChange = useCallback((newTime: number) => {
    if (isPlaying) {
      handlePause();
    }
    handleSeek(newTime);
  }, [isPlaying, handlePause, handleSeek]);

  // Cancel loading dialog
  const handleCancelLoading = useCallback(() => {
    setShowLoadingDialog(false);
  }, []);

  // Auto-start playback when preview becomes ready (if loading dialog is showing)
  useEffect(() => {
    if (showLoadingDialog && previewReady) {
      setShowLoadingDialog(false);
      handlePlay();
    }
  }, [showLoadingDialog, previewReady, handlePlay]);

  // Calculate playhead percentage for scrub bar
  const playheadPercent = timelineDuration > 0 ? (playheadPosition / timelineDuration) * 100 : 0;

  // Preview video source
  const previewSrc = preview.filePath
    ? `file:///${preview.filePath.replace(/\\/g, '/')}`
    : '';

  return (
    <div className="program-monitor" onClick={handlePaneClick}>
      <div className="program-video-container" ref={containerRef}>
        {/* Video element - for continuous playback (hardware accelerated) */}
        {previewSrc && (
          <video
            key={previewSrc}
            ref={videoRef}
            src={previewSrc}
            className="program-preview-video"
            muted={isMuted}
            style={{
              width: displaySize.width,
              height: displaySize.height,
              backgroundColor,
              display: displayMode === 'video' ? 'block' : 'none',
            }}
          />
        )}

        {/* Canvas - for pause/scrub display (full quality from source) */}
        <canvas
          ref={canvasRef}
          width={fullWidth}
          height={fullHeight}
          className="program-preview-canvas"
          style={{
            width: displaySize.width,
            height: displaySize.height,
            backgroundColor,
            display: displayMode === 'canvas' ? 'block' : 'none',
          }}
        />

        {/* Loading dialog overlay - blocks playback when preview not ready */}
        {showLoadingDialog && (
          <div className="program-loading-overlay">
            <div className="program-loading-dialog">
              <Loader className="loading-spinner" size={32} />
              <p>Rendering preview...</p>
              <div className="loading-progress-bar">
                <div
                  className="loading-progress-fill"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
              <p className="loading-progress-text">{renderProgress.toFixed(1)}% complete</p>
              <button onClick={handleCancelLoading} className="loading-cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Frame extraction indicator */}
        {previewState.isExtracting && displayMode === 'canvas' && (
          <div className="program-extracting-indicator">
            <Loader className="extracting-spinner" size={16} />
          </div>
        )}

        {/* Indicator when preview not ready (not blocking) */}
        {!previewReady && !showLoadingDialog && (
          <div className="program-preview-not-ready">
            <p>Preview {preview.status === 'rendering' ? 'rendering' : 'not ready'}</p>
            {previewRendering && (
              <p className="render-progress">{renderProgress.toFixed(1)}%</p>
            )}
          </div>
        )}
      </div>

      {/* Timecode display */}
      <div className="program-info-bar">
        <TimecodeInput
          value={playheadPosition}
          fps={fps}
          onChange={handleTimecodeChange}
          max={timelineDuration}
          className="program-timecode"
        />
        <span className="program-duration">{formatTimecode(timelineDuration)}</span>
      </div>

      {/* Scrub bar */}
      <div className="program-scrub-container">
        <div
          ref={scrubBarRef}
          className={`program-scrub-bar ${isScrubbing ? 'scrubbing' : ''}`}
          onMouseDown={handleScrubStart}
        >
          <div className="program-playhead" style={{ left: `${playheadPercent}%` }} />
        </div>
      </div>

      {/* Transport controls */}
      <div className="program-transport">
        <div className="transport-left">
          <button onClick={toggleMute} title="Mute (M)">
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        </div>

        <div className="transport-center">
          <button onClick={handleGoToStart} title="Go to Start (Home)">
            <ChevronsLeft size={16} />
          </button>
          <button onClick={() => handleFrameStep(-1)} title="Step Back (Left Arrow)">
            <SkipBack size={16} />
          </button>
          <button onClick={handlePlayPause} className="play-button" title="Play/Pause (Space)">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => handleFrameStep(1)} title="Step Forward (Right Arrow)">
            <SkipForward size={16} />
          </button>
          <button onClick={handleGoToEnd} title="Go to End (End)">
            <ChevronsRight size={16} />
          </button>
        </div>

        <div className="transport-right">
          {previewRendering && (
            <span className="render-status" title="Background rendering in progress">
              {renderProgress.toFixed(1)}%
            </span>
          )}
          <span className="preview-quality-label">Quality:</span>
          <select
            className="preview-quality-select"
            value={previewQuality}
            onChange={(e) => dispatch(updateSettings({ previewQuality: parseFloat(e.target.value) }))}
            title="Preview Quality"
          >
            {PREVIEW_QUALITY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default ProgramMonitor;
