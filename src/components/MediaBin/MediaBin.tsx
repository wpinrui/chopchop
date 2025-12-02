/**
 * Media Bin Component
 *
 * Displays imported media files with thumbnails and metadata.
 */

import React, { useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { addMediaItem } from '../../store/projectSlice';
import { setSourceMediaId } from '../../store/uiSlice';
import type { MediaItem } from '@types';
import './MediaBin.css';

export interface MediaBinHandle {
  triggerImport: () => void;
}

const MediaBin = forwardRef<MediaBinHandle>((props, ref) => {
  const dispatch = useDispatch();
  const media = useSelector((state: RootState) => state.project.media);
  const [isDragOver, setIsDragOver] = useState(false);

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

        const mediaItem: MediaItem = {
          id: `media-${Date.now()}-${Math.random()}`,
          name: fileName,
          path: filePath,
          proxyPath: null,
          type: probeResult.type,
          duration: probeResult.duration,
          metadata: probeResult.metadata,
          thumbnailPath: probeResult.thumbnailDataUrl,
        };

        dispatch(addMediaItem(mediaItem));
      } catch (error) {
        console.error('Error importing media:', error);
      }
    }
  }, [dispatch]);

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
        const filePath = file.path; // Electron provides the full path

        const probeResult = await window.electronAPI.media.probe(filePath);

        if (!probeResult.metadata) {
          console.error('Failed to probe media:', filePath);
          continue;
        }

        const fileName = file.name;

        const mediaItem: MediaItem = {
          id: `media-${Date.now()}-${Math.random()}`,
          name: fileName,
          path: filePath,
          proxyPath: null,
          type: probeResult.type,
          duration: probeResult.duration,
          metadata: probeResult.metadata,
          thumbnailPath: probeResult.thumbnailDataUrl,
        };

        dispatch(addMediaItem(mediaItem));
      } catch (error) {
        console.error('Error importing dropped media:', error);
      }
    }
  }, [dispatch]);

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
          media.map((item) => (
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
          ))
        )}
      </div>
    </div>
  );
});

MediaBin.displayName = 'MediaBin';

export default MediaBin;
