/**
 * TrackContextMenu Component
 *
 * Displays context menu for track operations (add, rename, delete).
 * Single Responsibility: Track context menu rendering only.
 */

import React from 'react';

interface TrackContextMenuState {
  x: number;
  y: number;
  trackId: string;
}

interface TrackContextMenuProps {
  contextMenu: TrackContextMenuState;
  onAddVideoTrack: () => void;
  onAddAudioTrack: () => void;
  onRename: (trackId: string) => void;
  onDelete: (trackId: string) => void;
}

export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  contextMenu,
  onAddVideoTrack,
  onAddAudioTrack,
  onRename,
  onDelete,
}) => {
  return (
    <div
      className="timeline-context-menu"
      style={{
        position: 'fixed',
        left: contextMenu.x,
        top: contextMenu.y,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="context-menu-item" onClick={onAddVideoTrack}>
        Add Video Track
      </button>
      <button className="context-menu-item" onClick={onAddAudioTrack}>
        Add Audio Track
      </button>
      {contextMenu.trackId && (
        <>
          <button
            className="context-menu-item"
            onClick={() => onRename(contextMenu.trackId)}
          >
            Rename Track
          </button>
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={() => onDelete(contextMenu.trackId)}
          >
            Delete Track
          </button>
        </>
      )}
    </div>
  );
};
