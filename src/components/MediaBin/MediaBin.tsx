/**
 * Media Bin Component
 *
 * Displays imported media files with thumbnails and metadata.
 */

import React, { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { addMediaItem } from '../../store/projectSlice';
import type { MediaItem } from '@types';
import './MediaBin.css';

const MediaBin: React.FC = () => {
  const dispatch = useDispatch();
  const media = useSelector((state: RootState) => state.project.media);

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
    <div className="media-bin">
      <div className="media-bin-toolbar">
        <button className="import-button" onClick={handleImport}>
          Import Media
        </button>
      </div>

      <div className="media-list">
        {media.length === 0 ? (
          <div className="media-empty">
            <p>No media imported</p>
            <button onClick={handleImport}>Import your first file</button>
          </div>
        ) : (
          media.map((item) => (
            <div key={item.id} className="media-item">
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
                  {item.type === 'video' && item.metadata.width && (
                    <span>{item.metadata.width}×{item.metadata.height}</span>
                  )}
                  {item.duration > 0 && (
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
};

export default MediaBin;
