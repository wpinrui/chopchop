/**
 * Program Monitor Component - Hybrid Architecture Rewrite
 *
 * High-performance video playback using:
 * - Native video.play() for forward playback (4Hz Redux sync)
 * - RAF-driven for scrubbing, stepping, reverse (muted)
 * - Canvas overlay for future UI elements (markers, safe zones, waveforms)
 *
 * Performance: 60fps playback, 4Hz Redux updates (configurable), no legacy clip mode.
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
import { updateSettings } from '../../store/projectSlice';
import TimecodeInput from '../TimecodeInput/TimecodeInput';
import { usePlaybackEngine } from '../../hooks/usePlaybackEngine';
import { useJKLShuttle } from '../../hooks/useJKLShuttle';
import { useScrubbing } from '../../hooks/useScrubbing';
import './ProgramMonitor.css';

// Preview quality options
const PREVIEW_QUALITY_OPTIONS = [
  { value: 1, label: 'Full' },
  { value: 0.5, label: '1/2' },
  { value: 0.25, label: '1/4' },
  { value: 0.125, label: '1/8' },
];

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

  // Preview file state
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

  // Calculate timeline duration
  const timelineDuration = Math.max(
    ...tracks.flatMap(track =>
      track.clips.map(clip => clip.timelineStart + clip.duration)
    ),
    1 // Minimum 1 second
  );

  // Playback engine (hybrid architecture)
  const {
    playbackStateRef,
    play,
    pause,
    togglePlayPause,
    seek,
    setSpeed,
    stepFrame,
    goToStart,
    goToEnd,
  } = usePlaybackEngine({
    videoRef,
    reduxPlayheadPosition: playheadPosition,
    timelineDuration,
    previewReady,
  });

  // JKL shuttle control
  const { handleJ, handleK, handleL } = useJKLShuttle({
    playbackStateRef,
    play,
    pause,
    setSpeed,
  });

  // Scrubbing
  const { isScrubbing, handleScrubStart } = useScrubbing({
    playbackStateRef,
    scrubBarRef,
    timelineDuration,
    seek,
    pause,
    play,
  });

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

  // Play/Pause with loading dialog if preview not ready
  const handlePlayPause = useCallback(() => {
    const state = playbackStateRef.current;
    if (!state) return;

    if (state.isPlaying) {
      pause();
      dispatch(setPlayingPane(null));
    } else {
      // Check if preview is ready
      if (!previewReady) {
        setShowLoadingDialog(true);
        return;
      }
      play();
      dispatch(setPlayingPane('program'));
    }
  }, [playbackStateRef, pause, play, previewReady, dispatch]);

  // Note: Playing pane state is now managed directly in play/pause callbacks above
  // This ensures keyboard shortcuts work correctly

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
          handlePlayPause(); // Toggle play/pause (not just pause)
          break;

        case 'j':
          e.preventDefault();
          handleJ();
          break;

        case 'l':
          e.preventDefault();
          handleL();
          break;

        case 'arrowleft':
          e.preventDefault();
          stepFrame(-1, fps);
          break;

        case 'arrowright':
          e.preventDefault();
          stepFrame(1, fps);
          break;

        case 'home':
          e.preventDefault();
          goToStart();
          break;

        case 'end':
          e.preventDefault();
          goToEnd();
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
  }, [shouldHandleKeyboard, handleJ, handleK, handleL, handlePlayPause, stepFrame, goToStart, goToEnd, fps, isMuted]);

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
    // Pause if playing
    const state = playbackStateRef.current;
    if (state?.isPlaying) {
      pause();
    }
    seek(newTime);
  }, [playbackStateRef, pause, seek]);

  // Cancel loading dialog
  const handleCancelLoading = useCallback(() => {
    setShowLoadingDialog(false);
  }, []);

  // Auto-start playback when preview becomes ready (if loading dialog is showing)
  useEffect(() => {
    if (showLoadingDialog && previewReady) {
      setShowLoadingDialog(false);
      play();
      dispatch(setPlayingPane('program'));
    }
  }, [showLoadingDialog, previewReady, play, dispatch]);

  // Calculate playhead percentage for scrub bar
  const playheadPercent = timelineDuration > 0 ? (playheadPosition / timelineDuration) * 100 : 0;

  // Preview video source
  const previewSrc = preview.filePath
    ? `file:///${preview.filePath.replace(/\\/g, '/')}`
    : '';

  // Get display state from playback state ref
  const state = playbackStateRef.current;
  const isPlaying = state?.isPlaying ?? false;
  const playbackSpeed = state?.playbackSpeed ?? 1;
  const playbackDirection = state?.direction ?? 0;

  return (
    <div className="program-monitor" onClick={handlePaneClick}>
      <div className="program-video-container" ref={containerRef}>
        {/* Video element - primary display (hardware accelerated) */}
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
            }}
          />
        )}

        {/* Canvas overlay - for future UI elements (markers, safe zones, waveforms) */}
        {/* Positioned above video, transparent, only draws UI elements */}
        <canvas
          ref={canvasRef}
          width={seqWidth}
          height={seqHeight}
          className="program-canvas-overlay"
          style={{
            width: displaySize.width,
            height: displaySize.height,
            pointerEvents: 'none', // Don't block mouse events to video
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
          <button onClick={goToStart} title="Go to Start (Home)">
            <ChevronsLeft size={16} />
          </button>
          <button onClick={() => stepFrame(-1, fps)} title="Step Back (Left Arrow)">
            <SkipBack size={16} />
          </button>
          <button onClick={handlePlayPause} className="play-button" title="Play/Pause (Space)">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => stepFrame(1, fps)} title="Step Forward (Right Arrow)">
            <SkipForward size={16} />
          </button>
          <button onClick={goToEnd} title="Go to End (End)">
            <ChevronsRight size={16} />
          </button>
        </div>

        <div className="transport-right">
          {playbackDirection !== 0 && (
            <span className="playback-speed">
              {playbackDirection === -1 && '←'}{playbackSpeed}x{playbackDirection === 1 && '→'}
            </span>
          )}
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
