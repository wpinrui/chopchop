/**
 * Preview Pipeline Indicator
 *
 * Status bar component showing unified preview pipeline progress
 * (proxy generation + preview rendering in one process).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { X } from 'lucide-react';
import { setMediaProxy } from '../../store/projectSlice';
import './PreviewPipelineIndicator.css';

interface PipelineProgress {
  phase: 'proxy' | 'render';
  overallPercent: number;
  currentTask: string;
  phasePercent: number;
}

const PreviewPipelineIndicator: React.FC = () => {
  const dispatch = useDispatch();
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Listen for pipeline progress events
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanupProgress = window.electronAPI.preview.onPipelineProgress((prog) => {
      setProgress(prog);
      setIsRunning(true);

      // Clear when complete
      if (prog.overallPercent >= 100) {
        setTimeout(() => {
          setIsRunning(false);
          setProgress(null);
        }, 1000);
      }
    });

    // Listen for proxy generation events to update Redux
    const cleanupProxy = window.electronAPI.preview.onProxyGenerated((data) => {
      dispatch(setMediaProxy({ mediaId: data.mediaId, proxyPath: data.proxyPath }));
    });

    return () => {
      cleanupProgress();
      cleanupProxy();
    };
  }, [dispatch]);

  // Cancel the pipeline
  const handleCancel = useCallback(() => {
    window.electronAPI?.preview.cancelPipeline();
    setIsRunning(false);
    setProgress(null);
  }, []);

  // Don't render if nothing is running
  if (!isRunning || !progress) {
    return null;
  }

  // Truncate task name if too long
  const truncatedTask = progress.currentTask.length > 30
    ? progress.currentTask.slice(0, 27) + '...'
    : progress.currentTask;

  return (
    <div className="pipeline-progress-status">
      <span className="pipeline-progress-label">
        {truncatedTask}
      </span>
      <div className="pipeline-progress-bar">
        <div
          className="pipeline-progress-fill"
          style={{ width: `${progress.overallPercent}%` }}
        />
      </div>
      <span className="pipeline-progress-percent">
        {Math.round(progress.overallPercent)}%
      </span>
      <button
        className="pipeline-cancel-btn"
        onClick={handleCancel}
        title="Cancel"
      >
        <X size={12} />
      </button>
    </div>
  );
};

export default PreviewPipelineIndicator;
