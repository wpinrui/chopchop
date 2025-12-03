/**
 * useExportProgress Hook
 *
 * Manages export progress state and operations.
 * Single Responsibility: Export execution and progress tracking.
 */

import { useState, useCallback } from 'react';
import type { ExportSettings } from '@types';

interface ExportProgressState {
  isExporting: boolean;
  progress: number;
  speed: string;
  eta: string;
  error: string | null;
}

interface ExportProgressActions {
  startExport: (
    exportSettings: ExportSettings,
    timeline: any,
    media: any[],
    onSuccess: () => void
  ) => Promise<void>;
  cancelExport: () => Promise<void>;
  clearError: () => void;
}

export function useExportProgress(): ExportProgressState & ExportProgressActions {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('');
  const [eta, setEta] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startExport = useCallback(async (
    exportSettings: ExportSettings,
    timeline: any,
    media: any[],
    onSuccess: () => void
  ) => {
    setIsExporting(true);
    setProgress(0);
    setError(null);
    setSpeed('');
    setEta('');

    try {
      const removeListener = window.electronAPI.export.onProgress(
        (progressData: { percent?: number; speed?: string; eta?: string }) => {
          setProgress(progressData.percent || 0);
          if (progressData.speed) setSpeed(progressData.speed);
          if (progressData.eta) setEta(progressData.eta);
        }
      );

      const result = await window.electronAPI.export.start({
        timeline,
        media,
        exportSettings,
      });

      removeListener();

      if (result.success) {
        setIsExporting(false);
        onSuccess();
      } else {
        setError(result.error || 'Export failed');
        setIsExporting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setIsExporting(false);
    }
  }, []);

  const cancelExport = useCallback(async () => {
    await window.electronAPI.export.cancel();
    setIsExporting(false);
    setProgress(0);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isExporting,
    progress,
    speed,
    eta,
    error,
    startExport,
    cancelExport,
    clearError,
  };
}
