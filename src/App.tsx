/**
 * ChopChop Main App Component
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from './store';
import MediaBin, { type MediaBinHandle } from './components/MediaBin/MediaBin';
import Timeline from './components/Timeline/Timeline';
import SourcePreview from './components/SourcePreview/SourcePreview';
import SimpleProgramMonitor from './components/ProgramMonitor/SimpleProgramMonitor';
import SequenceSettings from './components/SequenceSettings/SequenceSettings';
import ExportDialog from './components/ExportDialog/ExportDialog';
import ProxyProgressIndicator from './components/ProxyProgressIndicator/ProxyProgressIndicator';
import PreviewPipelineIndicator from './components/PreviewPipelineIndicator/PreviewPipelineIndicator';
import { addTrack, loadTimeline } from './store/timelineSlice';
import { setActivePane } from './store/uiSlice';
import { loadProject, setProjectPath, setProjectName, markClean, updateMediaItemSilent, clearAllProxies } from './store/projectSlice';
import { performUndo, performRedo, selectCanUndo, selectCanRedo, clearHistory } from './store/historySlice';
import type { AppDispatch } from './store';
import type { Project, Timeline as TimelineType, MediaItem } from '@types';
import './App.css';

// Project file format interface
interface ProjectFile {
  version: string;
  name: string;
  settings: Project['settings'];
  media: Array<Omit<MediaItem, 'thumbnailPath' | 'waveformData'> & {
    thumbnailPath?: string | null;
    waveformData?: number[] | null;
  }>;
  timeline: TimelineType;
}

const App: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();

  // Undo/redo state
  const canUndo = useSelector(selectCanUndo);
  const canRedo = useSelector(selectCanRedo);

  const project = useSelector((state: RootState) => state.project);
  const timeline = useSelector((state: RootState) => state.timeline);
  const projectName = project.name;
  const projectPath = project.path;
  const projectDirty = project.dirty;
  const projectMedia = project.media;
  const tracks = timeline.tracks;
  const activePane = useSelector((state: RootState) => state.ui.activePane);
  const mediaBinRef = useRef<MediaBinHandle>(null);
  const tracksInitialized = useRef(false);
  const checkedProxiesRef = useRef<Set<string>>(new Set());

  // Default layout values
  const DEFAULT_TOP_ROW_HEIGHT = 60;
  const DEFAULT_TOP_LEFT_WIDTH = 50;
  const DEFAULT_BOTTOM_LEFT_WIDTH = 30;

  // Layout state - Top row is 1.5x bottom row = 60% height
  const [topRowHeight, setTopRowHeight] = useState(DEFAULT_TOP_ROW_HEIGHT); // percentage
  const [topLeftWidth, setTopLeftWidth] = useState(DEFAULT_TOP_LEFT_WIDTH); // percentage - half/half
  const [bottomLeftWidth, setBottomLeftWidth] = useState(DEFAULT_BOTTOM_LEFT_WIDTH); // percentage - 3:7 ratio

  // Reset layout to defaults
  const handleResetLayout = useCallback(() => {
    setTopRowHeight(DEFAULT_TOP_ROW_HEIGHT);
    setTopLeftWidth(DEFAULT_TOP_LEFT_WIDTH);
    setBottomLeftWidth(DEFAULT_BOTTOM_LEFT_WIDTH);
    setStatusMessage('Layout reset to default');
    setTimeout(() => setStatusMessage('Ready'), 2000);
  }, []);

  // Tab states
  const [topLeftTab, setTopLeftTab] = useState<'source' | 'effects'>('source');
  const [bottomLeftTab, setBottomLeftTab] = useState<'media' | 'effects-browser' | 'markers' | 'history'>('media');
  const [timelineTab, setTimelineTab] = useState<'timeline' | 'sequence'>('timeline');

  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Status message
  const [statusMessage, setStatusMessage] = useState('Ready');

  // Save project to file
  const saveProjectToFile = useCallback(async (filePath: string) => {
    try {
      setStatusMessage('Saving...');

      // Derive project name from filename (without extension)
      const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
      const derivedName = fileName.replace(/\.chpchp$/i, '');

      // Update project name if it was still "Untitled"
      const finalName = project.name === 'Untitled' ? derivedName : project.name;
      if (finalName !== project.name) {
        dispatch(setProjectName(finalName));
      }

      // Build project file data (exclude thumbnails and waveforms - they'll be regenerated)
      const projectFile: ProjectFile = {
        version: project.version,
        name: finalName,
        settings: project.settings,
        media: projectMedia.map(m => ({
          id: m.id,
          name: m.name,
          path: m.path,
          proxyPath: m.proxyPath,
          type: m.type,
          duration: m.duration,
          metadata: m.metadata,
          thumbnailPath: null, // Will be regenerated on load
          waveformData: null,  // Will be regenerated on load
        })),
        timeline: timeline,
      };

      const content = JSON.stringify(projectFile, null, 2);
      await window.electronAPI.file.writeText(filePath, content);

      dispatch(setProjectPath(filePath));
      dispatch(markClean());

      // Save as recent project
      await window.electronAPI.settings.setRecentProject(filePath);

      setStatusMessage('Project saved');

      // Reset status after 2 seconds
      setTimeout(() => setStatusMessage('Ready'), 2000);
    } catch (error) {
      console.error('Failed to save project:', error);
      setStatusMessage('Failed to save project');
    }
  }, [dispatch, project, projectMedia, timeline]);

  // Save project (Ctrl+S)
  const handleSave = useCallback(async () => {
    if (projectPath) {
      // Save to existing path
      await saveProjectToFile(projectPath);
    } else {
      // No path yet, show Save As dialog
      const filePath = await window.electronAPI.project.showSaveDialog(projectName + '.chpchp');
      if (filePath) {
        await saveProjectToFile(filePath);
      }
    }
  }, [projectPath, projectName, saveProjectToFile]);

  // Save As (Ctrl+Shift+S)
  const handleSaveAs = useCallback(async () => {
    const filePath = await window.electronAPI.project.showSaveDialog(projectName + '.chpchp');
    if (filePath) {
      await saveProjectToFile(filePath);
    }
  }, [projectName, saveProjectToFile]);

  // Load project from a specific path
  const loadProjectFromPath = useCallback(async (filePath: string) => {
    try {
      setStatusMessage('Loading project...');

      const content = await window.electronAPI.file.readText(filePath);
      const projectFile: ProjectFile = JSON.parse(content);

      // Derive project name from filename if stored name is "Untitled"
      let projectName = projectFile.name;
      if (projectName === 'Untitled') {
        const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
        projectName = fileName.replace(/\.chpchp$/i, '');
      }

      // Clear history for fresh project
      dispatch(clearHistory());

      // Clear checked proxies so they get rechecked
      checkedProxiesRef.current.clear();

      // Load the timeline first
      dispatch(loadTimeline(projectFile.timeline));

      // Build media items with null thumbnails/waveforms (will regenerate)
      const mediaItems: MediaItem[] = projectFile.media.map(m => ({
        ...m,
        thumbnailPath: null,
        waveformData: null,
      }));

      // Load project state
      dispatch(loadProject({
        version: projectFile.version,
        name: projectName,
        path: filePath,
        dirty: false,
        settings: projectFile.settings,
        media: mediaItems,
      }));

      tracksInitialized.current = true; // Don't re-add default tracks

      // Save as recent project
      await window.electronAPI.settings.setRecentProject(filePath);

      setStatusMessage('Regenerating thumbnails...');

      // Regenerate thumbnails and waveforms asynchronously (silent - don't mark dirty)
      for (const mediaItem of mediaItems) {
        try {
          // Regenerate thumbnail
          const probeResult = await window.electronAPI.media.probe(mediaItem.path);
          if (probeResult?.thumbnailDataUrl) {
            dispatch(updateMediaItemSilent({
              id: mediaItem.id,
              updates: { thumbnailPath: probeResult.thumbnailDataUrl },
            }));
          }

          // Regenerate waveform for audio/video
          if (mediaItem.type !== 'image') {
            const waveformData = await window.electronAPI.media.generateWaveform(mediaItem.path);
            if (waveformData) {
              dispatch(updateMediaItemSilent({
                id: mediaItem.id,
                updates: { waveformData },
              }));
            }
          }
        } catch (err) {
          console.warn(`Failed to regenerate data for ${mediaItem.name}:`, err);
        }
      }
      setStatusMessage('Project loaded');
      setTimeout(() => setStatusMessage('Ready'), 2000);
      return true;
    } catch (error) {
      console.error('Failed to open project:', error);
      setStatusMessage('Failed to open project');
      return false;
    }
  }, [dispatch]);

  // Open project (Ctrl+O)
  const handleOpen = useCallback(async () => {
    const filePath = await window.electronAPI.project.showOpenDialog();
    if (!filePath) return;
    await loadProjectFromPath(filePath);
  }, [loadProjectFromPath]);

  // Export (Ctrl+M)
  const handleExport = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  // Undo (Ctrl+Z)
  const handleUndo = useCallback(() => {
    if (canUndo) {
      dispatch(performUndo());
      setStatusMessage('Undo');
      setTimeout(() => setStatusMessage('Ready'), 1000);
    }
  }, [dispatch, canUndo]);

  // Redo (Ctrl+Shift+Z or Ctrl+Y)
  const handleRedo = useCallback(() => {
    if (canRedo) {
      dispatch(performRedo());
      setStatusMessage('Redo');
      setTimeout(() => setStatusMessage('Ready'), 1000);
    }
  }, [dispatch, canRedo]);

  // Check and cleanup missing proxy files (silent - don't mark dirty)
  useEffect(() => {
    const cleanupMissingProxies = async () => {
      let cleanedCount = 0;
      for (const item of projectMedia) {
        if (item.proxyPath && !checkedProxiesRef.current.has(item.proxyPath)) {
          checkedProxiesRef.current.add(item.proxyPath);
          try {
            const exists = await window.electronAPI.file.exists(item.proxyPath);
            if (!exists) {
              dispatch(updateMediaItemSilent({ id: item.id, updates: { proxyPath: null } }));
              cleanedCount++;
            }
          } catch (err) {
            console.error(`[App] Error checking proxy ${item.proxyPath}:`, err);
            // If check fails, clear the proxy path to be safe
            dispatch(updateMediaItemSilent({ id: item.id, updates: { proxyPath: null } }));
            cleanedCount++;
          }
        }
      }
      if (cleanedCount > 0) {
        console.log(`[App] Cleaned up ${cleanedCount} missing proxy reference(s)`);
      }
    };

    if (projectMedia.length > 0) {
      cleanupMissingProxies();
    }
  }, [projectMedia, dispatch]);

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
        visible: true,
        volume: 1,
      }));
      dispatch(addTrack({
        id: 'audio-1',
        name: 'Audio 1',
        type: 'audio',
        clips: [],
        locked: false,
        muted: false,
        visible: true,
        volume: 1,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Handle menu events from main process
  useEffect(() => {
    const cleanups = [
      window.electronAPI.menu.onNewProject(() => {
        // TODO: Create new project, with confirmation if dirty
        setStatusMessage('New Project (not implemented yet)');
      }),
      window.electronAPI.menu.onOpenProject(handleOpen),
      window.electronAPI.menu.onOpenRecent(async () => {
        const recentPath = await window.electronAPI.settings.getRecentProject();
        if (recentPath) {
          await loadProjectFromPath(recentPath);
        }
      }),
      window.electronAPI.menu.onSave(handleSave),
      window.electronAPI.menu.onSaveAs(handleSaveAs),
      window.electronAPI.menu.onImportMedia(() => {
        mediaBinRef.current?.triggerImport();
      }),
      window.electronAPI.menu.onExport(handleExport),
      window.electronAPI.menu.onUndo(handleUndo),
      window.electronAPI.menu.onRedo(handleRedo),
      window.electronAPI.menu.onResetLayout(handleResetLayout),
      window.electronAPI.menu.onRegeneratePreview(async () => {
        setStatusMessage('Regenerating preview...');
        await window.electronAPI.simplePreview.clearCache();
        await window.electronAPI.simplePreview.renderFullPreview();
      }),
      window.electronAPI.menu.onClearPreviewCache(async () => {
        setStatusMessage('Clearing preview cache...');
        try {
          await window.electronAPI.preview.clearAllCache();
          setStatusMessage('Preview cache cleared');
          setTimeout(() => setStatusMessage('Ready'), 2000);
        } catch (error) {
          setStatusMessage('Failed to clear cache');
          console.error('Failed to clear preview cache:', error);
        }
      }),
      window.electronAPI.menu.onClearProxyReferences(() => {
        dispatch(clearAllProxies());
        setStatusMessage('Proxy references cleared');
        setTimeout(() => setStatusMessage('Ready'), 2000);
      }),
    ];

    return () => cleanups.forEach(cleanup => cleanup());
  }, [handleOpen, handleSave, handleSaveAs, handleExport, handleUndo, handleRedo, loadProjectFromPath, handleResetLayout]);

  // Handle unsaved changes check when closing
  useEffect(() => {
    const cleanup = window.electronAPI.app.onCheckUnsavedChanges(async () => {
      if (!projectDirty) {
        // No unsaved changes, allow close
        window.electronAPI.app.sendCloseResponse('discard');
        return;
      }

      // Show save dialog
      const response = await window.electronAPI.app.showUnsavedChangesDialog();

      if (response === 'save') {
        // Save the project first
        if (projectPath) {
          await saveProjectToFile(projectPath);
        } else {
          const filePath = await window.electronAPI.project.showSaveDialog(projectName + '.chpchp');
          if (filePath) {
            await saveProjectToFile(filePath);
          } else {
            // User cancelled save dialog, cancel close
            window.electronAPI.app.sendCloseResponse('cancel');
            return;
          }
        }
        // After saving, allow close
        window.electronAPI.app.sendCloseResponse('discard');
      } else if (response === 'discard') {
        // User chose not to save, allow close
        window.electronAPI.app.sendCloseResponse('discard');
      } else {
        // User cancelled
        window.electronAPI.app.sendCloseResponse('cancel');
      }
    });

    return cleanup;
  }, [projectDirty, projectPath, projectName, saveProjectToFile]);

  // Handle recent project notification on app start
  useEffect(() => {
    const cleanup = window.electronAPI.app.onRecentProject(async (recentPath: string) => {
      // Automatically try to load the recent project
      setStatusMessage(`Loading recent project: ${recentPath.split(/[\\/]/).pop()}`);
      await loadProjectFromPath(recentPath);
    });

    return cleanup;
  }, [loadProjectFromPath]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+I - Import Media
      if (ctrl && e.key === 'i') {
        e.preventDefault();
        mediaBinRef.current?.triggerImport();
      }

      // Ctrl+S - Save Project
      if (ctrl && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }

      // Ctrl+Shift+S - Save As
      if (ctrl && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        handleSaveAs();
      }

      // Ctrl+O - Open Project
      if (ctrl && e.key === 'o') {
        e.preventDefault();
        handleOpen();
      }

      // Ctrl+M - Export (Make)
      if (ctrl && e.key === 'm') {
        e.preventDefault();
        handleExport();
      }

      // Ctrl+Z - Undo
      if (ctrl && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }

      // Ctrl+Shift+Z or Ctrl+Y - Redo
      if ((ctrl && e.shiftKey && e.key === 'Z') || (ctrl && e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleSaveAs, handleOpen, handleExport, handleUndo, handleRedo]);

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

  // Update window title with project name and dirty indicator
  useEffect(() => {
    const dirtyIndicator = projectDirty ? ' *' : '';
    document.title = `ChopChop - ${projectName}${dirtyIndicator}`;
  }, [projectName, projectDirty]);

  // Pane activation handlers
  const handleProgramClick = useCallback(() => {
    if (activePane !== 'program') {
      dispatch(setActivePane('program'));
    }
  }, [dispatch, activePane]);

  const handleTimelineClick = useCallback(() => {
    if (activePane !== 'timeline') {
      dispatch(setActivePane('timeline'));
    }
  }, [dispatch, activePane]);

  const handleMediaBinClick = useCallback(() => {
    if (activePane !== 'mediaBin') {
      dispatch(setActivePane('mediaBin'));
    }
  }, [dispatch, activePane]);

  return (
    <div className="app">
      <div className="app-body">
        {/* Top row: Source/Effects (left) | Sequence Preview (right) */}
        <div className="top-row" style={{ height: `${topRowHeight}%` }}>
          <div
            className={`panel effects-panel ${activePane === 'source' ? 'active' : ''}`}
            style={{ width: `${topLeftWidth}%` }}
          >
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
                <SourcePreview />
              ) : (
                <div className="placeholder-content">
                  <p>Effect controls and properties</p>
                </div>
              )}
            </div>
          </div>

          <div className="vertical-resizer" onMouseDown={handleTopVerticalResize} />

          <div
            className={`panel sequence-preview-panel ${activePane === 'program' ? 'active' : ''}`}
            onClick={handleProgramClick}
          >
            <div className="panel-header">Program Monitor</div>
            <div className="panel-content viewer-content">
              <SimpleProgramMonitor />
            </div>
          </div>
        </div>

        <div className="horizontal-resizer" onMouseDown={handleHorizontalResize} />

        {/* Bottom row: Media Bin/Effects Browser/etc (left) | Timeline (right) */}
        <div className="bottom-row">
          <div
            className={`panel media-bin-panel ${activePane === 'mediaBin' ? 'active' : ''}`}
            style={{ width: `${bottomLeftWidth}%` }}
            onClick={handleMediaBinClick}
          >
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

          <div
            className={`panel timeline-panel ${activePane === 'timeline' ? 'active' : ''}`}
            onClick={handleTimelineClick}
          >
            <div className="panel-header">
              <div className="tab-bar">
                <button
                  className={`tab ${timelineTab === 'timeline' ? 'active' : ''}`}
                  onClick={() => setTimelineTab('timeline')}
                >
                  Timeline
                </button>
                <button
                  className={`tab ${timelineTab === 'sequence' ? 'active' : ''}`}
                  onClick={() => setTimelineTab('sequence')}
                >
                  Sequence
                </button>
              </div>
            </div>
            <div className="panel-content timeline-content">
              {timelineTab === 'timeline' ? <Timeline /> : <SequenceSettings />}
            </div>
          </div>
        </div>
      </div>

      <div className="app-footer">
        <div className="status-bar">
          <span className="status-message">{statusMessage}</span>
          {projectDirty && <span className="status-dirty">Modified</span>}
          {projectPath && <span className="status-path">{projectPath}</span>}
          <PreviewPipelineIndicator />
          <ProxyProgressIndicator />
        </div>
      </div>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
    </div>
  );
};

export default App;
