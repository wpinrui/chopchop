/**
 * ChopChop Main App Component
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from './store';
import MediaBin, { type MediaBinHandle } from './components/MediaBin/MediaBin';
import Timeline from './components/Timeline/Timeline';
import { addTrack } from './store/timelineSlice';
import './App.css';

const App: React.FC = () => {
  const dispatch = useDispatch();
  const projectName = useSelector((state: RootState) => state.project.name);
  const tracks = useSelector((state: RootState) => state.timeline.tracks);
  const mediaBinRef = useRef<MediaBinHandle>(null);
  const tracksInitialized = useRef(false);

  // Layout state - Top row is 1.5x bottom row = 60% height
  const [topRowHeight, setTopRowHeight] = useState(60); // percentage
  const [topLeftWidth, setTopLeftWidth] = useState(50); // percentage - half/half
  const [bottomLeftWidth, setBottomLeftWidth] = useState(30); // percentage - 3:7 ratio

  // Tab states
  const [topLeftTab, setTopLeftTab] = useState<'source' | 'effects'>('source');
  const [bottomLeftTab, setBottomLeftTab] = useState<'media' | 'effects-browser' | 'markers' | 'history'>('media');

  // Initialize default tracks
  useEffect(() => {
    if (!tracksInitialized.current && tracks.length === 0) {
      tracksInitialized.current = true;
      // Add default video and audio tracks
      dispatch(addTrack({
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        clips: [],
        locked: false,
        muted: false,
        solo: false,
      }));
      dispatch(addTrack({
        id: 'audio-1',
        name: 'Audio 1',
        type: 'audio',
        clips: [],
        locked: false,
        muted: false,
        solo: false,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+I - Import Media
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        // Trigger import via MediaBin component
        mediaBinRef.current?.triggerImport();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Horizontal resizer (between top and bottom rows)
  const handleHorizontalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = topRowHeight;
    const appBody = (e.target as HTMLElement).parentElement;
    if (!appBody) return;

    const bodyRect = appBody.getBoundingClientRect();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaPercent = (deltaY / bodyRect.height) * 100;
      const newHeight = Math.max(20, Math.min(80, startHeight + deltaPercent));
      setTopRowHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [topRowHeight]);

  // Vertical resizer for top row
  const handleTopVerticalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = topLeftWidth;
    const row = (e.target as HTMLElement).parentElement;
    if (!row) return;

    const rowRect = row.getBoundingClientRect();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / rowRect.width) * 100;
      const newWidth = Math.max(15, Math.min(50, startWidth + deltaPercent));
      setTopLeftWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [topLeftWidth]);

  // Vertical resizer for bottom row
  const handleBottomVerticalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = bottomLeftWidth;
    const row = (e.target as HTMLElement).parentElement;
    if (!row) return;

    const rowRect = row.getBoundingClientRect();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / rowRect.width) * 100;
      const newWidth = Math.max(15, Math.min(50, startWidth + deltaPercent));
      setBottomLeftWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [bottomLeftWidth]);

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-title">ChopChop</div>
        <div className="project-name">{projectName}</div>
      </div>

      <div className="app-body">
        {/* Top row: Source/Effects (left) | Sequence Preview (right) */}
        <div className="top-row" style={{ height: `${topRowHeight}%` }}>
          <div className="panel effects-panel" style={{ width: `${topLeftWidth}%` }}>
            <div className="panel-header">
              <div className="tab-bar">
                <button
                  className={`tab ${topLeftTab === 'source' ? 'active' : ''}`}
                  onClick={() => setTopLeftTab('source')}
                >
                  Source Clip
                </button>
                <button
                  className={`tab ${topLeftTab === 'effects' ? 'active' : ''}`}
                  onClick={() => setTopLeftTab('effects')}
                >
                  Effect Controls
                </button>
              </div>
            </div>
            <div className="panel-content">
              {topLeftTab === 'source' ? (
                <>
                  {/* TODO: Source clip preview */}
                  <p>Source clip preview and controls</p>
                </>
              ) : (
                <>
                  {/* TODO: Effect controls */}
                  <p>Effect controls and properties</p>
                </>
              )}
            </div>
          </div>

          <div className="vertical-resizer" onMouseDown={handleTopVerticalResize} />

          <div className="panel sequence-preview-panel">
            <div className="panel-header">Program Monitor</div>
            <div className="panel-content viewer-content">
              {/* TODO: Viewer component */}
              <div className="viewer-placeholder">
                <p>Sequence preview</p>
              </div>
            </div>
          </div>
        </div>

        <div className="horizontal-resizer" onMouseDown={handleHorizontalResize} />

        {/* Bottom row: Media Bin/Effects Browser/etc (left) | Timeline (right) */}
        <div className="bottom-row">
          <div className="panel media-bin-panel" style={{ width: `${bottomLeftWidth}%` }}>
            <div className="panel-header">
              <div className="tab-bar">
                <button
                  className={`tab ${bottomLeftTab === 'media' ? 'active' : ''}`}
                  onClick={() => setBottomLeftTab('media')}
                >
                  Media Bin
                </button>
                <button
                  className={`tab ${bottomLeftTab === 'effects-browser' ? 'active' : ''}`}
                  onClick={() => setBottomLeftTab('effects-browser')}
                >
                  Effects
                </button>
                <button
                  className={`tab ${bottomLeftTab === 'markers' ? 'active' : ''}`}
                  onClick={() => setBottomLeftTab('markers')}
                >
                  Markers
                </button>
                <button
                  className={`tab ${bottomLeftTab === 'history' ? 'active' : ''}`}
                  onClick={() => setBottomLeftTab('history')}
                >
                  History
                </button>
              </div>
            </div>
            <div className="panel-content media-bin-content">
              {bottomLeftTab === 'media' && <MediaBin ref={mediaBinRef} />}
              {bottomLeftTab === 'effects-browser' && <p>Effects browser</p>}
              {bottomLeftTab === 'markers' && <p>Markers panel</p>}
              {bottomLeftTab === 'history' && <p>History / Undo stack</p>}
            </div>
          </div>

          <div className="vertical-resizer" onMouseDown={handleBottomVerticalResize} />

          <div className="panel timeline-panel">
            <div className="panel-header">Timeline</div>
            <div className="panel-content timeline-content">
              <Timeline />
            </div>
          </div>
        </div>
      </div>

      <div className="app-footer">
        <div className="status-bar">
          Ready
        </div>
      </div>
    </div>
  );
};

export default App;
