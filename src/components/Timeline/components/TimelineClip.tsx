/**
 * TimelineClip Component
 *
 * Renders a single clip on the timeline.
 * Single Responsibility: Clip visual rendering only.
 */

import React from 'react';
import { Link } from 'lucide-react';
import type { Clip, MediaItem } from '@types';
import WaveformCanvas from '../WaveformCanvas';

interface TimelineClipProps {
  clip: Clip;
  media: MediaItem | null;
  isSelected: boolean;
  isDragging: boolean;
  left: number;
  width: number;
  onMouseDown: (e: React.MouseEvent, clip: Clip) => void;
}

export const TimelineClip: React.FC<TimelineClipProps> = ({
  clip,
  media,
  isSelected,
  isDragging,
  left,
  width,
  onMouseDown,
}) => {
  const isVideoClip = clip.type === 'video';
  const isAudioClip = clip.type === 'audio';

  return (
    <div
      className={`clip ${isVideoClip ? 'video-clip' : ''} ${isAudioClip ? 'audio-clip' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ left: `${left}px`, width: `${width}px` }}
      onMouseDown={(e) => onMouseDown(e, clip)}
    >
      <div className="clip-content">
        <div className="clip-info">
          {clip.linkId && <Link size={12} className="clip-link-indicator" />}
          <span className="clip-name">{clip.name}</span>
        </div>

        {isVideoClip && (
          <div className="clip-thumbnail">
            {media?.thumbnailPath ? (
              <img src={media.thumbnailPath} alt="" />
            ) : (
              <div className="clip-thumbnail-placeholder">▶</div>
            )}
          </div>
        )}

        {isAudioClip && (
          <div className="clip-waveform">
            {media?.waveformData ? (
              <WaveformCanvas
                waveformData={media.waveformData}
                mediaDuration={media.duration}
                mediaIn={clip.mediaIn}
                mediaOut={clip.mediaOut}
                width={width}
                height={52}
              />
            ) : (
              <div className="clip-waveform-placeholder" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
