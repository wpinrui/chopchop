/**
 * Media Bin Component
 *
 * Displays imported media files with thumbnails and metadata.
 */

import React, { useCallback, useState, useImperativeHandle, forwardRef, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { addMediaItem, updateMediaItem, removeMediaItem } from '../../store/projectSlice';
import { setSourceMediaId, setSelectedMediaId, setActivePane } from '../../store/uiSlice';
import { removeClipsByMediaId } from '../../store/timelineSlice';
import type { MediaItem } from '@types';
import './MediaBin.css';

// Track proxy generation progress per media item
interface ProxyProgress {
  [mediaId: string]: number; // percent 0-100
}

export interface MediaBinHandle {
  triggerImport: () => void;
}

const MediaBin = forwardRef<MediaBinHandle>((_props, ref) => {
  const dispatch = useDispatch();
  const media = useSelector((state: RootState) => state.project.media);
  const timeline = useSelector((state: RootState) => state.timeline);
  const selectedMediaId = useSelector((state: RootState) => state.ui.selectedMediaId);
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const proxyEnabled = useSelector((state: RootState) => state.project.settings.proxyEnabled);
  const proxyScale = useSelector((state: RootState) => state.project.settings.proxyScale);
  const [isDragOver, setIsDragOver] = useState(false);
  const [proxyProgress, setProxyProgress] = useState<ProxyProgress>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for proxy generation progress events
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup = window.electronAPI.media.onProxyProgress((progress) => {
      setProxyProgress((prev) => ({
        ...prev,
        [progress.mediaId]: progress.percent,
      }));
    });

    return cleanup;
  }, []);

  // Generate proxy for a video file
  const generateProxyForMedia = useCallback(async (mediaItem: MediaItem) => {
    if (!window.electronAPI || mediaItem.type !== 'video' || !proxyEnabled) {
      return;
    }

    try {
      setProxyProgress((prev) => ({ ...prev, [mediaItem.id]: 0 }));

      const result = await window.electronAPI.media.generateProxy(
        mediaItem.path,
        mediaItem.id,
        proxyScale,
        mediaItem.duration
      );

      if (result.success && result.proxyPath) {
        dispatch(updateMediaItem({ id: mediaItem.id, updates: { proxyPath: result.proxyPath } }));
      }

      // Remove from progress tracking after completion
      setProxyProgress((prev) => {
        const next = { ...prev };
        delete next[mediaItem.id];
        return next;
      });
    } catch (err) {
      console.error('Failed to generate proxy:', err);
      setProxyProgress((prev) => {
        const next = { ...prev };
        delete next[mediaItem.id];
        return next;
      });
    }
  }, [dispatch, proxyEnabled, proxyScale]);

  const handleImport = useCallback(async () => {
    if (!window.electronAPI) {
      console.error('Electron API not available. Make sure you are running in Electron context.');
      alert('This feature requires Electron. Please run: npm run dev');
      return;
    }

    const filePaths = await window.electronAPI.media.showImportDialog();

    if (!filePaths || filePaths.length === 0) {
      return;
    }

    // Process each file
    for (const filePath of filePaths) {
      try {
        const probeResult = await window.electronAPI.media.probe(filePath);

        if (!probeResult.metadata) {
          console.error('Failed to probe media:', filePath);
          continue;
        }

        const fileName = filePath.split(/[\\/]/).pop() || 'Unknown';

        const mediaId = `media-${Date.now()}-${Math.random()}`;
        const mediaItem: MediaItem = {
          id: mediaId,
          name: fileName,
          path: filePath,
          proxyPath: null,
          type: probeResult.type,
          duration: probeResult.duration,
          metadata: probeResult.metadata,
          thumbnailPath: probeResult.thumbnailDataUrl,
          waveformData: null, // Will be loaded async
        };

        dispatch(addMediaItem(mediaItem));

        // Generate waveform async for audio/video files
        if (probeResult.type !== 'image') {
          window.electronAPI.media.generateWaveform(filePath).then((waveformData) => {
            if (waveformData) {
              dispatch(updateMediaItem({ id: mediaId, updates: { waveformData } }));
            }
          }).catch((err) => {
            console.error('Failed to generate waveform:', err);
          });
        }

        // Generate proxy async for video files (if proxies enabled)
        if (probeResult.type === 'video') {
          generateProxyForMedia(mediaItem);
        }
      } catch (error) {
        console.error('Error importing media:', error);
      }
    }
  }, [dispatch, generateProxyForMedia]);

  // Expose import function to parent via ref
  useImperativeHandle(ref, () => ({
    triggerImport: handleImport,
  }), [handleImport]);

  // Check if drag event contains external files (not internal media drag)
  const isExternalFileDrag = (e: React.DragEvent): boolean => {
    // Check if dragging files from OS (not internal media items)
    return e.dataTransfer.types.includes('Files') &&
           !e.dataTransfer.types.includes('application/chopchop-media');
  };

  // Drag and drop handlers - only activate for external file drops
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the media-bin itself, not a child
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // Ignore internal media drags
    if (e.dataTransfer.types.includes('application/chopchop-media')) {
      return;
    }

    if (!window.electronAPI) {
      console.error('Electron API not available');
      return;
    }

    const files = Array.from(e.dataTransfer.files);

    // Process each dropped file
    for (const file of files) {
      try {
        const filePath = (file as File & { path: string }).path; // Electron provides the full path

        const probeResult = await window.electronAPI.media.probe(filePath);

        if (!probeResult.metadata) {
          console.error('Failed to probe media:', filePath);
          continue;
        }

        const fileName = file.name;
        const mediaId = `media-${Date.now()}-${Math.random()}`;

        const mediaItem: MediaItem = {
          id: mediaId,
          name: fileName,
          path: filePath,
          proxyPath: null,
          type: probeResult.type,
          duration: probeResult.duration,
          metadata: probeResult.metadata,
          thumbnailPath: probeResult.thumbnailDataUrl,
          waveformData: null, // Will be loaded async
        };

        dispatch(addMediaItem(mediaItem));

        // Generate waveform async for audio/video files
        if (probeResult.type !== 'image') {
          window.electronAPI.media.generateWaveform(filePath).then((waveformData) => {
            if (waveformData) {
              dispatch(updateMediaItem({ id: mediaId, updates: { waveformData } }));
            }
          }).catch((err) => {
            console.error('Failed to generate waveform:', err);
          });
        }

        // Generate proxy async for video files (if proxies enabled)
        if (probeResult.type === 'video') {
          generateProxyForMedia(mediaItem);
        }
      } catch (error) {
        console.error('Error importing dropped media:', error);
      }
    }
  }, [dispatch, generateProxyForMedia]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `${mb.toFixed(1)} MB`;
    }
    return `${(mb / 1024).toFixed(1)} GB`;
  };

  // Find clips that use a specific media item
  const findClipsUsingMedia = useCallback((mediaId: string): number => {
    let count = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.mediaId === mediaId) {
          count++;
        }
      }
    }
    return count;
  }, [timeline.tracks]);

  // Handle media item selection
  const handleMediaClick = useCallback((mediaId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(setSelectedMediaId(mediaId));
    dispatch(setActivePane('mediaBin'));
  }, [dispatch]);

  // Handle media item deletion
  const handleDeleteMedia = useCallback(async (mediaId: string) => {
    const mediaItem = media.find(m => m.id === mediaId);
    if (!mediaItem) return;

    const clipCount = findClipsUsingMedia(mediaId);

    if (clipCount > 0) {
      // Warn user that media is in use
      const confirmed = window.confirm(
        `"${mediaItem.name}" is used by ${clipCount} clip${clipCount > 1 ? 's' : ''} in the timeline.\n\nRemoving this media will also remove those clips. Continue?`
      );

      if (!confirmed) return;

      // Remove clips from timeline first
      dispatch(removeClipsByMediaId(mediaId));
    }

    // Clean up proxy file if it exists
    if (mediaItem.proxyPath && window.electronAPI) {
      try {
        await window.electronAPI.media.deleteProxy(mediaItem.proxyPath);
      } catch (err) {
        console.error('Failed to delete proxy file:', err);
      }
    }

    // Remove media from project
    dispatch(removeMediaItem(mediaId));

    // Clear selection if this was the selected media
    if (selectedMediaId === mediaId) {
      dispatch(setSelectedMediaId(null));
    }

    // Clear source if this was the source media
    dispatch(setSourceMediaId(null));
  }, [dispatch, media, selectedMediaId, findClipsUsingMedia]);

  // Handle remove button click
  const handleRemoveClick = useCallback(() => {
    if (selectedMediaId) {
      handleDeleteMedia(selectedMediaId);
    }
  }, [selectedMediaId, handleDeleteMedia]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle delete if media bin is active and a media item is selected
      if (activePane !== 'mediaBin' || !selectedMediaId) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteMedia(selectedMediaId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePane, selectedMediaId, handleDeleteMedia]);

  // Clear selection when clicking on empty area
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).classList.contains('media-list')) {
      dispatch(setSelectedMediaId(null));
    }
  }, [dispatch]);

  return (
    <div
      ref={containerRef}
      className={`media-bin ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleContainerClick}
    >
      <div className="media-bin-toolbar">
        <button className="toolbar-button import-button" onClick={handleImport} title="Import Media">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Import</span>
        </button>
        <button
          className="toolbar-button remove-button"
          onClick={handleRemoveClick}
          disabled={!selectedMediaId}
          title="Remove Selected Media (Delete)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
          </svg>
          <span>Remove</span>
        </button>
      </div>

      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <p>Drop media files here</p>
          </div>
        </div>
      )}

      <div className="media-list">
        {media.length === 0 ? (
          <div className="media-empty">
            <p>No media imported</p>
            <button onClick={handleImport}>Import your first file</button>
          </div>
        ) : (
          media.map((item) => {
            const isGeneratingProxy = proxyProgress[item.id] !== undefined;
            const proxyPercent = proxyProgress[item.id] ?? 0;
            const hasProxy = !!item.proxyPath;
            const isSelected = selectedMediaId === item.id;

            return (
              <div
                key={item.id}
                className={`media-item ${isSelected ? 'selected' : ''}`}
                onClick={(e) => handleMediaClick(item.id, e)}
                onDoubleClick={() => dispatch(setSourceMediaId(item.id))}
              >
                <div className="media-thumbnail">
                  {item.thumbnailPath ? (
                    <img src={item.thumbnailPath} alt={item.name} />
                  ) : (
                    <div className="media-thumbnail-placeholder">
                      <span>{item.type[0].toUpperCase()}</span>
                    </div>
                  )}
                  {/* Proxy status indicator */}
                  {item.type === 'video' && (
                    <div className={`proxy-badge ${hasProxy ? 'ready' : isGeneratingProxy ? 'generating' : 'none'}`}>
                      {isGeneratingProxy ? `${Math.round(proxyPercent)}%` : hasProxy ? 'P' : ''}
                    </div>
                  )}
                  {/* Proxy progress bar */}
                  {isGeneratingProxy && (
                    <div className="proxy-progress-bar">
                      <div className="proxy-progress-fill" style={{ width: `${proxyPercent}%` }} />
                    </div>
                  )}
                </div>

                <div className="media-info">
                  <div className="media-name" title={item.name}>
                    {item.name}
                  </div>
                  <div className="media-details">
                    {(item.type === 'video' || item.type === 'image') && item.metadata.width && (
                      <span>{item.metadata.width}×{item.metadata.height}</span>
                    )}
                    {item.type === 'image' ? (
                      <span>Still</span>
                    ) : item.duration > 0 && (
                      <span>{formatDuration(item.duration)}</span>
                    )}
                    {item.metadata.fileSize && (
                      <span>{formatFileSize(item.metadata.fileSize)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

MediaBin.displayName = 'MediaBin';

export default MediaBin;
