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
  Link2,
} from 'lucide-react';
import type { RootState } from '../../store';
import { setSourceInPoint, setSourceOutPoint } from '../../store/uiSlice';
import './SourcePreview.css';

const SourcePreview: React.FC = () => {
  const dispatch = useDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Get selected source media from Redux
  const sourceMediaId = useSelector((state: RootState) => state.ui.sourceMediaId);
  const sourceInPoint = useSelector((state: RootState) => state.ui.sourceInPoint);
  const sourceOutPoint = useSelector((state: RootState) => state.ui.sourceOutPoint);
  const media = useSelector((state: RootState) => state.project.media);
  const fps = useSelector((state: RootState) => state.project.settings.frameRate);

  const sourceMedia = media.find((m) => m.id === sourceMediaId) || null;

  // Local state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

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
    if (sourceMedia) {
      setDuration(sourceMedia.duration);
    }
  }, [sourceMediaId, sourceMedia]);

  // Play/Pause
  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
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

    e.dataTransfer.setData('application/chopchop-source', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copy';
  }, [sourceMedia, sourceInPoint, sourceOutPoint]);

  // Calculate in/out region for display
  const inPercent = sourceInPoint !== null ? (sourceInPoint / duration) * 100 : 0;
  const outPercent = sourceOutPoint !== null ? (sourceOutPoint / duration) * 100 : 100;
  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // No media selected
  if (!sourceMedia) {
    return (
      <div className="source-preview">
        <div className="source-preview-empty">
          <p>No source clip selected</p>
          <p className="hint">Double-click a clip in the Media Bin to preview</p>
        </div>
      </div>
    );
  }

  // Convert file path to file:// URL for video element
  // Using forward slashes and proper file:// format (file:///C:/path/to/file)
  const videoSrc = sourceMedia.path
    ? `file:///${sourceMedia.path.replace(/\\/g, '/')}`
    : '';

  return (
    <div className="source-preview">
      {/* Video display */}
      <div className="source-video-container">
        <video
          ref={videoRef}
          src={videoSrc}
          className="source-video"
          onClick={handlePlayPause}
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
            title="Drag Video Only"
            disabled={sourceMedia.type === 'audio'}
          >
            <Film size={14} />
          </button>
          <button
            draggable
            onDragStart={(e) => handleDragStart(e, 'audio')}
            title="Drag Audio Only"
          >
            <Music size={14} />
          </button>
          <button
            draggable
            onDragStart={(e) => handleDragStart(e, 'both')}
            title="Drag Video + Audio"
            disabled={sourceMedia.type === 'audio'}
          >
            <Link2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SourcePreview;
