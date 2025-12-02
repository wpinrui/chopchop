/**
 * Media Bin Component
 *
 * Displays imported media files with thumbnails and metadata.
 */

import React, { useCallback, useState, useImperativeHandle, forwardRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { addMediaItem, updateMediaItem } from '../../store/projectSlice';
import { setSourceMediaId } from '../../store/uiSlice';
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
  const proxyEnabled = useSelector((state: RootState) => state.project.settings.proxyEnabled);
  const proxyScale = useSelector((state: RootState) => state.project.settings.proxyScale);
  const [isDragOver, setIsDragOver] = useState(false);
  const [proxyProgress, setProxyProgress] = useState<ProxyProgress>({});

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

  return (
    <div
      className={`media-bin ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="media-bin-toolbar">
        <button className="import-button" onClick={handleImport}>
          Import Media
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

            return (
              <div
                key={item.id}
                className="media-item"
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
