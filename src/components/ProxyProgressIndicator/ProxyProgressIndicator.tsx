/**
 * Proxy Progress Indicator
 *
 * Inline component for the status bar showing proxy generation progress.
 */

import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import './ProxyProgressIndicator.css';

interface ProxyProgress {
  [mediaId: string]: number; // percent 0-100
}

const ProxyProgressIndicator: React.FC = () => {
  const [proxyProgress, setProxyProgress] = useState<ProxyProgress>({});
  const media = useSelector((state: RootState) => state.project.media);

  // Listen for proxy progress events
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup = window.electronAPI.media.onProxyProgress((progress) => {
      setProxyProgress((prev) => {
        if (progress.percent >= 100) {
          // Remove completed items after a short delay
          const next = { ...prev };
          delete next[progress.mediaId];
          return next;
        }
        return {
          ...prev,
          [progress.mediaId]: progress.percent,
        };
      });
    });

    return cleanup;
  }, []);

  // Get active items
  const activeItems = Object.entries(proxyProgress);

  // Don't render if nothing is generating
  if (activeItems.length === 0) {
    return null;
  }

  // Calculate overall progress
  const overallPercent = activeItems.reduce((sum, [, percent]) => sum + percent, 0) / activeItems.length;

  // Get current file name
  const currentMediaId = activeItems[0]?.[0];
  const currentMedia = media.find((m) => m.id === currentMediaId);
  const currentName = currentMedia?.name || 'video';
  const truncatedName = currentName.length > 15 ? currentName.slice(0, 12) + '...' : currentName;

  return (
    <div className="proxy-progress-status">
      <span className="proxy-progress-label">
        Generating proxy{activeItems.length > 1 ? ` (${activeItems.length})` : ''}: {truncatedName}
      </span>
      <div className="proxy-progress-bar">
        <div
          className="proxy-progress-fill"
          style={{ width: `${overallPercent}%` }}
        />
      </div>
      <span className="proxy-progress-percent">{Math.round(overallPercent)}%</span>
    </div>
  );
};

export default ProxyProgressIndicator;
