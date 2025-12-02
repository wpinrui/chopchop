/**
 * Source Preview Component
 *
 * Video preview with transport controls for source clips.
 * Allows setting in/out points and dragging to timeline.
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
  Scissors,
  Film,
  Music,
  Image,
} from 'lucide-react';
import type { RootState } from '../../store';
import { setSourceInPoint, setSourceOutPoint, setActivePane, setPlayingPane } from '../../store/uiSlice';
import './SourcePreview.css';

// Playback speeds for J/L shuttle control
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

const SourcePreview: React.FC = () => {
  const dispatch = useDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Get selected source media from Redux
  const sourceMediaId = useSelector((state: RootState) => state.ui.sourceMediaId);
  const sourceInPoint = useSelector((state: RootState) => state.ui.sourceInPoint);
  const sourceOutPoint = useSelector((state: RootState) => state.ui.sourceOutPoint);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const playingPane = useSelector((state: RootState) => state.ui.playingPane);
  const media = useSelector((state: RootState) => state.project.media);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);

  const sourceMedia = media.find((m) => m.id === sourceMediaId) || null;
  const isActive = activePane === 'source';

  // This pane should receive keyboard shortcuts if:
  // 1. It's currently playing (playingPane === 'source'), OR
  // 2. No player is playing AND this is the active pane
  const shouldHandleKeyboard = playingPane === 'source' || (playingPane === null && isActive);

  // Local state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // Current speed magnitude
  const [playbackDirection, setPlaybackDirection] = useState<-1 | 0 | 1>(0); // -1 = backward, 0 = paused, 1 = forward

  // Format timecode as HH:MM:SS:FF
  const formatTimecode = useCallback((seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }, [fps]);

  // Local state for errors
  const [videoError, setVideoError] = useState<string | null>(null);

  // Update current time during playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!isScrubbing) {
        setCurrentTime(video.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      setCurrentTime(0);
      setVideoError(null);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    const handleError = () => {
      const error = video.error;
      let errorMsg = 'Unknown error';
      if (error) {
        switch (error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMsg = 'Playback aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMsg = 'Network error';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMsg = 'Decoding error - format may not be supported';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMsg = 'Format not supported by browser';
            break;
        }
      }
      console.error('Video error:', errorMsg, error);
      setVideoError(errorMsg);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [isScrubbing]);

  // Reset state when source media changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoError(null);
    setPlaybackSpeed(1);
    setPlaybackDirection(0);
    if (sourceMedia) {
      setDuration(sourceMedia.duration);
    }
  }, [sourceMediaId, sourceMedia]);

  // Sync isPlaying state with Redux playingPane for keyboard routing
  useEffect(() => {
    if (isPlaying) {
      dispatch(setPlayingPane('source'));
    } else {
      // Only clear playingPane if we were the ones playing
      if (playingPane === 'source') {
        dispatch(setPlayingPane(null));
      }
    }
  }, [isPlaying, dispatch, playingPane]);

  // Handle reverse playback using requestAnimationFrame (HTML5 video doesn't support negative playbackRate)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playbackDirection !== -1) return;

    let animationId: number;
    let lastTime = performance.now();

    const updateReverse = (now: number) => {
      const delta = (now - lastTime) / 1000; // Convert to seconds
      lastTime = now;

      const newTime = video.currentTime - delta * playbackSpeed;
      if (newTime <= 0) {
        video.currentTime = 0;
        setCurrentTime(0);
        setPlaybackDirection(0);
        setIsPlaying(false);
        return;
      }

      video.currentTime = newTime;
      setCurrentTime(newTime);
      animationId = requestAnimationFrame(updateReverse);
    };

    animationId = requestAnimationFrame(updateReverse);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [playbackDirection, playbackSpeed]);

  // Keyboard shortcuts - route based on playingPane or activePane
  useEffect(() => {
    if (!shouldHandleKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video || !sourceMedia) return;

      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'i':
          e.preventDefault();
          dispatch(setSourceInPoint(video.currentTime));
          break;

        case 'o':
          e.preventDefault();
          dispatch(setSourceOutPoint(video.currentTime));
          break;

        case 'k':
        case ' ':
          // Toggle play/pause - if paused, play at 1x; if playing, pause
          e.preventDefault();
          if (playbackDirection === 0) {
            // Was paused, play forward at 1x
            video.playbackRate = 1;
            setPlaybackSpeed(1);
            setPlaybackDirection(1);
            video.play();
            setIsPlaying(true);
          } else {
            // Was playing, pause
            video.pause();
            setIsPlaying(false);
            setPlaybackDirection(0);
          }
          break;

        case 'j':
          // Play backwards or increase backward speed
          e.preventDefault();
          if (playbackDirection === 1) {
            // Was playing forward, switch to backward at first speed
            video.pause();
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setIsPlaying(true);
          } else if (playbackDirection === -1) {
            // Already playing backward, increase speed
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
          } else {
            // Was paused, start backward at first speed
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(-1);
            setIsPlaying(true);
          }
          break;

        case 'l':
          // Play forward or increase forward speed
          e.preventDefault();
          if (playbackDirection === -1) {
            // Was playing backward, switch to forward at first speed
            setPlaybackDirection(1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            video.playbackRate = PLAYBACK_SPEEDS[0];
            video.play();
            setIsPlaying(true);
          } else if (playbackDirection === 1) {
            // Already playing forward, increase speed
            const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
            const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
            setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
            video.playbackRate = PLAYBACK_SPEEDS[nextIndex];
          } else {
            // Was paused, start forward at first speed
            setPlaybackSpeed(PLAYBACK_SPEEDS[0]);
            setPlaybackDirection(1);
            video.playbackRate = PLAYBACK_SPEEDS[0];
            video.play();
            setIsPlaying(true);
          }
          break;

        case 'arrowleft':
          // Step back one frame
          e.preventDefault();
          video.pause();
          setIsPlaying(false);
          setPlaybackDirection(0);
          {
            const frameDuration = 1 / fps;
            const newTime = Math.max(0, video.currentTime - frameDuration);
            video.currentTime = newTime;
            setCurrentTime(newTime);
          }
          break;

        case 'arrowright':
          // Step forward one frame
          e.preventDefault();
          video.pause();
          setIsPlaying(false);
          setPlaybackDirection(0);
          {
            const frameDuration = 1 / fps;
            const newTime = Math.min(duration, video.currentTime + frameDuration);
            video.currentTime = newTime;
            setCurrentTime(newTime);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldHandleKeyboard, sourceMedia, playbackDirection, playbackSpeed, fps, duration, dispatch]);

  // Set this pane as active when clicked
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      dispatch(setActivePane('source'));
    }
  }, [dispatch, isActive]);

  // Play/Pause (resets to normal speed)
  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      setPlaybackDirection(0);
    } else {
      video.playbackRate = 1;
      setPlaybackSpeed(1);
      setPlaybackDirection(1);
      video.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  // Step forward/back by one frame
  const stepFrame = useCallback((direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video) return;

    const frameDuration = 1 / fps;
    const newTime = Math.max(0, Math.min(duration, video.currentTime + direction * frameDuration));
    video.currentTime = newTime;
    setCurrentTime(newTime);
  }, [fps, duration]);

  // Go to in/out point
  const goToInPoint = useCallback(() => {
    const video = videoRef.current;
    if (!video || sourceInPoint === null) return;
    video.currentTime = sourceInPoint;
    setCurrentTime(sourceInPoint);
  }, [sourceInPoint]);

  const goToOutPoint = useCallback(() => {
    const video = videoRef.current;
    if (!video || sourceOutPoint === null) return;
    video.currentTime = sourceOutPoint;
    setCurrentTime(sourceOutPoint);
  }, [sourceOutPoint]);

  // Set in/out points
  const setInPoint = useCallback(() => {
    dispatch(setSourceInPoint(currentTime));
  }, [dispatch, currentTime]);

  const setOutPoint = useCallback(() => {
    dispatch(setSourceOutPoint(currentTime));
  }, [dispatch, currentTime]);

  // Scrub bar handlers
  const handleScrubStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const scrubBar = e.currentTarget;
    const rect = scrubBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;

    setIsScrubbing(true);
    setCurrentTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      const percent = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
      const newTime = percent * duration;
      setCurrentTime(newTime);
      if (videoRef.current) {
        videoRef.current.currentTime = newTime;
      }
    };

    const onMouseUp = () => {
      setIsScrubbing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [duration]);

  // Drag handlers for inserting into timeline
  const handleDragStart = useCallback((e: React.DragEvent, type: 'video' | 'audio' | 'both') => {
    if (!sourceMedia) return;

    const dragData = {
      mediaId: sourceMedia.id,
      type,
      inPoint: sourceInPoint ?? 0,
      outPoint: sourceOutPoint ?? sourceMedia.duration,
    };

    // Store in both dataTransfer (for drop) and global (for dragOver preview)
    e.dataTransfer.setData('application/chopchop-source', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copy';

    // Hide the default browser drag ghost - use a transparent 1x1 image
    const emptyImg = document.createElement('img');
    emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(emptyImg, 0, 0);

    // Store globally for Timeline preview during dragOver (browsers block getData during dragOver)
    (window as any).__chopchopDragSource = dragData;
  }, [sourceMedia, sourceInPoint, sourceOutPoint]);

  // Clear global drag data on drag end
  const handleDragEnd = useCallback(() => {
    (window as any).__chopchopDragSource = null;
  }, []);

  // Calculate in/out region for display
  const inPercent = sourceInPoint !== null ? (sourceInPoint / duration) * 100 : 0;
  const outPercent = sourceOutPoint !== null ? (sourceOutPoint / duration) * 100 : 100;
  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // No media selected
  if (!sourceMedia) {
    return (
      <div className="source-preview" onClick={handlePaneClick}>
        <div className="source-preview-empty">
          <p>No source clip selected</p>
          <p className="hint">Double-click a clip in the Media Bin to preview</p>
        </div>
      </div>
    );
  }

  // Convert file path to file:// URL for media element
  // Using forward slashes and proper file:// format (file:///C:/path/to/file)
  const mediaSrc = sourceMedia.path
    ? `file:///${sourceMedia.path.replace(/\\/g, '/')}`
    : '';

  const isImage = sourceMedia.type === 'image';

  // Render image preview (simplified - no playback controls)
  if (isImage) {
    return (
      <div className="source-preview" onClick={handlePaneClick}>
        {/* Image display */}
        <div className="source-video-container">
          <img
            src={mediaSrc}
            className="source-video"
            alt={sourceMedia.name}
          />
        </div>

        {/* Info bar */}
        <div className="source-info-bar">
          <span className="source-timecode">
            {sourceMedia.metadata.width}×{sourceMedia.metadata.height}
          </span>
          <span className="source-name" title={sourceMedia.name}>{sourceMedia.name}</span>
          <span className="source-duration">5s still</span>
        </div>

        {/* Simplified transport - just drag to timeline */}
        <div className="source-transport">
          <div className="transport-left">
            <Image size={14} />
            <span className="btn-label" style={{ marginLeft: 4 }}>Still Image</span>
          </div>

          <div className="transport-center" />

          <div className="transport-right">
            <button
              draggable
              onDragStart={(e) => handleDragStart(e, 'video')}
              onDragEnd={handleDragEnd}
              title="Drag Image to Timeline"
            >
              <Film size={14} />
              <span className="btn-label">Add</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render video/audio preview with full transport controls
  return (
    <div className="source-preview" onClick={handlePaneClick}>
      {/* Video display - draggable to add both video+audio to timeline */}
      <div className="source-video-container">
        <video
          ref={videoRef}
          src={mediaSrc}
          className="source-video"
          draggable
          onDragStart={(e) => handleDragStart(e, 'both')}
          onDragEnd={handleDragEnd}
        />
        {videoError && (
          <div className="source-video-error">
            <p>{videoError}</p>
            <p className="hint">This format may need to be converted before preview</p>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="source-info-bar">
        <span className="source-timecode">{formatTimecode(currentTime)}</span>
        <span className="source-name" title={sourceMedia.name}>{sourceMedia.name}</span>
        <span className="source-duration">{formatTimecode(duration)}</span>
      </div>

      {/* Scrub bar */}
      <div className="source-scrub-container">
        <div className="source-scrub-bar" onMouseDown={handleScrubStart}>
          {/* In/Out region highlight */}
          <div
            className="source-in-out-region"
            style={{
              left: `${inPercent}%`,
              width: `${outPercent - inPercent}%`,
            }}
          />
          {/* In point marker */}
          {sourceInPoint !== null && (
            <div className="source-in-marker" style={{ left: `${inPercent}%` }} />
          )}
          {/* Out point marker */}
          {sourceOutPoint !== null && (
            <div className="source-out-marker" style={{ left: `${outPercent}%` }} />
          )}
          {/* Playhead */}
          <div className="source-playhead" style={{ left: `${playheadPercent}%` }} />
        </div>
      </div>

      {/* Transport controls */}
      <div className="source-transport">
        <div className="transport-left">
          <button onClick={setInPoint} title="Set In Point (I)">
            <Scissors size={14} style={{ transform: 'scaleX(-1)' }} />
            <span className="btn-label">In</span>
          </button>
          <button onClick={setOutPoint} title="Set Out Point (O)">
            <Scissors size={14} />
            <span className="btn-label">Out</span>
          </button>
        </div>

        <div className="transport-center">
          <button onClick={goToInPoint} title="Go to In Point" disabled={sourceInPoint === null}>
            <ChevronsLeft size={16} />
          </button>
          <button onClick={() => stepFrame(-1)} title="Step Back (Left Arrow)">
            <SkipBack size={16} />
          </button>
          <button onClick={handlePlayPause} className="play-button" title="Play/Pause (Space)">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => stepFrame(1)} title="Step Forward (Right Arrow)">
            <SkipForward size={16} />
          </button>
          <button onClick={goToOutPoint} title="Go to Out Point" disabled={sourceOutPoint === null}>
            <ChevronsRight size={16} />
          </button>
        </div>

        <div className="transport-right">
          <button
            draggable
            onDragStart={(e) => handleDragStart(e, 'video')}
            onDragEnd={handleDragEnd}
            title="Drag Video Only"
            disabled={sourceMedia.type === 'audio'}
          >
            <Film size={14} />
          </button>
          <button
            draggable
            onDragStart={(e) => handleDragStart(e, 'audio')}
            onDragEnd={handleDragEnd}
            title="Drag Audio Only"
          >
            <Music size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SourcePreview;
