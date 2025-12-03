/**
 * TimelineContextMenu Component
 *
 * Displays context menu for gap operations (ripple delete).
 * Single Responsibility: Gap context menu rendering only.
 */

import React from 'react';

interface ContextMenuState {
  x: number;
  y: number;
  gapStart: number;
}

interface TimelineContextMenuProps {
  contextMenu: ContextMenuState;
  onRippleDelete: (gapStart: number) => void;
}

export const TimelineContextMenu: React.FC<TimelineContextMenuProps> = ({
  contextMenu,
  onRippleDelete,
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
      <button
        className="context-menu-item"
        onClick={() => onRippleDelete(contextMenu.gapStart)}
      >
        Ripple Delete
      </button>
    </div>
  );
};
