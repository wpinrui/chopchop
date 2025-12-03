/**
 * Export Dialog Component
 *
 * Rich dialog for exporting timeline to video with ffmpeg.
 * Refactored to use custom hooks following Single Responsibility Principle.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { DEFAULT_EXPORT_PRESETS } from '@types';
import { useExportSettings } from './useExportSettings';
import { useExportProgress } from './useExportProgress';
import {
  VIDEO_CODECS,
  AUDIO_CODECS,
  FORMATS,
  RESOLUTIONS,
  FRAME_RATES,
  ENCODING_PRESETS,
  AUDIO_BITRATES,
  SAMPLE_RATES,
  CHANNEL_OPTIONS,
  getFormatExtension,
  codecSupportsPresets,
  getQualityHint,
} from './exportOptions';
import './ExportDialog.css';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose }) => {
  const project = useSelector((state: RootState) => state.project);
  const timeline = useSelector((state: RootState) => state.timeline);

  // Custom hooks for state management
  const settings = useExportSettings(project.name);
  const exportProgress = useExportProgress();

  // UI state
  const [nvencAvailable, setNvencAvailable] = useState<boolean | null>(null);
  const [videoExpanded, setVideoExpanded] = useState(true);
  const [audioExpanded, setAudioExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  // Calculate timeline duration
  const getTimelineDuration = useCallback(() => {
    let maxEnd = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const end = clip.timelineStart + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd;
  }, [timeline.tracks]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isAbsolutePath = (p: string) => {
    return /^[a-zA-Z]:[/\\]/.test(p) || p.startsWith('/');
  };

  // Check NVENC availability
  useEffect(() => {
    if (isOpen && nvencAvailable === null) {
      window.electronAPI.ffmpeg.checkNvenc().then((available: boolean) => {
        setNvencAvailable(available);
        if (!available && settings.useGpu) {
          settings.setUseGpu(false);
        }
      });
    }
  }, [isOpen, nvencAvailable, settings]);

  const handleBrowse = useCallback(async () => {
    const ext = getFormatExtension(settings.format);
    const filePath = await window.electronAPI.file.showSaveDialog(
      settings.outputPath || `${project.name}.${ext}`
    );
    if (filePath) {
      settings.setOutputPath(filePath);
    }
  }, [settings, project.name]);

  const handleExport = useCallback(async () => {
    if (!settings.outputPath) {
      return;
    }

    let exportPath = settings.outputPath;

    if (!isAbsolutePath(settings.outputPath)) {
      const ext = getFormatExtension(settings.format);
      const filePath = await window.electronAPI.file.showSaveDialog(
        settings.outputPath || `${project.name}.${ext}`
      );

      if (!filePath) return;

      settings.setOutputPath(filePath);
      exportPath = filePath;
    }

    const exportSettings = settings.buildExportSettings();
    exportSettings.outputPath = exportPath;

    await exportProgress.startExport(
      exportSettings,
      timeline,
      project.media,
      onClose
    );
  }, [settings, project, timeline, exportProgress, onClose]);

  if (!isOpen) return null;

  const duration = getTimelineDuration();

  return (
    <div className="export-dialog-overlay">
      <div className="export-dialog" onClick={e => e.stopPropagation()}>
        <div className="export-dialog-header">
          <h2>Export</h2>
          <button className="export-close-btn" onClick={onClose}>×</button>
        </div>

        {exportProgress.isExporting ? (
          <ExportProgressView
            progress={exportProgress.progress}
            speed={exportProgress.speed}
            eta={exportProgress.eta}
            duration={duration}
            formatTime={formatTime}
            onCancel={exportProgress.cancelExport}
          />
        ) : (
          <>
            {/* Output path */}
            <div className="export-section">
              <div className="export-row">
                <label className="export-label">Output:</label>
                <input
                  type="text"
                  className="export-input export-path-input"
                  value={settings.outputPath}
                  onChange={e => settings.setOutputPath(e.target.value)}
                  placeholder="Select output file..."
                />
                <button className="export-btn export-btn-browse" onClick={handleBrowse}>
                  Browse...
                </button>
              </div>
            </div>

            {/* Presets */}
            <div className="export-section">
              <div className="export-section-title">Presets</div>
              <div className="export-presets">
                {DEFAULT_EXPORT_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    className={`export-preset ${settings.selectedPreset === preset.id ? 'selected' : ''}`}
                    onClick={() => settings.applyPreset(preset)}
                  >
                    <div className="export-preset-name">{preset.name}</div>
                    <div className="export-preset-desc">{preset.description}</div>
                  </button>
                ))}
                <button
                  className={`export-preset ${settings.selectedPreset === 'custom' ? 'selected' : ''}`}
                  onClick={() => settings.setSelectedPreset('custom')}
                >
                  <div className="export-preset-name">Custom</div>
                  <div className="export-preset-desc">Configure manually</div>
                </button>
              </div>
            </div>

            {/* Video Settings */}
            <CollapsibleSection
              title="Video Settings"
              expanded={videoExpanded}
              onToggle={() => setVideoExpanded(!videoExpanded)}
            >
              <SettingsRow label="Format:">
                <select className="export-select" value={settings.format} onChange={e => settings.setFormat(e.target.value)}>
                  {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </SettingsRow>
              <SettingsRow label="Codec:">
                <select className="export-select" value={settings.videoCodec} onChange={e => settings.setVideoCodec(e.target.value)}>
                  {VIDEO_CODECS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </SettingsRow>
              <SettingsRow label="Resolution:">
                <select className="export-select" value={settings.resolution} onChange={e => settings.setResolution(e.target.value)}>
                  {RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </SettingsRow>
              <SettingsRow label="Frame Rate:">
                <select className="export-select" value={settings.frameRate} onChange={e => settings.setFrameRate(e.target.value)}>
                  {FRAME_RATES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </SettingsRow>
              <SettingsRow label="Quality (CRF):">
                <input type="range" className="export-slider" min="0" max="51" value={settings.crf} onChange={e => settings.setCrf(parseInt(e.target.value))} />
                <span className="export-slider-value">{settings.crf}</span>
                <span className="export-slider-hint">{getQualityHint(settings.crf)}</span>
              </SettingsRow>
              {codecSupportsPresets(settings.videoCodec) && (
                <SettingsRow label="Preset:">
                  <select className="export-select" value={settings.encodingPreset} onChange={e => settings.setEncodingPreset(e.target.value)}>
                    {ENCODING_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <span className="export-hint">(slower = smaller file)</span>
                </SettingsRow>
              )}
            </CollapsibleSection>

            {/* Audio Settings */}
            <CollapsibleSection
              title="Audio Settings"
              expanded={audioExpanded}
              onToggle={() => setAudioExpanded(!audioExpanded)}
            >
              <SettingsRow label="Codec:">
                <select className="export-select" value={settings.audioCodec} onChange={e => settings.setAudioCodec(e.target.value)}>
                  {AUDIO_CODECS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </SettingsRow>
              <SettingsRow label="Bitrate:">
                <select className="export-select" value={settings.audioBitrate} onChange={e => settings.setAudioBitrate(e.target.value)}>
                  {AUDIO_BITRATES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </SettingsRow>
              <SettingsRow label="Sample Rate:">
                <select className="export-select" value={settings.sampleRate} onChange={e => settings.setSampleRate(e.target.value)}>
                  {SAMPLE_RATES.map(r => <option key={r} value={r}>{parseInt(r).toLocaleString()} Hz</option>)}
                </select>
              </SettingsRow>
              <SettingsRow label="Channels:">
                <select className="export-select" value={settings.channels} onChange={e => settings.setChannels(e.target.value)}>
                  {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </SettingsRow>
            </CollapsibleSection>

            {/* Advanced Settings */}
            <CollapsibleSection
              title="Advanced"
              expanded={advancedExpanded}
              onToggle={() => setAdvancedExpanded(!advancedExpanded)}
            >
              <div className="export-row">
                <label className={`export-checkbox-label ${nvencAvailable === false ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={settings.useGpu}
                    onChange={e => settings.setUseGpu(e.target.checked)}
                    disabled={nvencAvailable === false}
                  />
                  Use GPU encoding (NVENC)
                  {nvencAvailable === null && <span className="export-hint"> (checking...)</span>}
                  {nvencAvailable === false && <span className="export-hint export-hint-error"> (not available)</span>}
                  {nvencAvailable === true && <span className="export-hint export-hint-success"> (available)</span>}
                </label>
              </div>
              <SettingsRow label="Custom ffmpeg args:">
                <input
                  type="text"
                  className="export-input"
                  value={settings.customArgs}
                  onChange={e => settings.setCustomArgs(e.target.value)}
                  placeholder="-movflags +faststart"
                />
              </SettingsRow>
            </CollapsibleSection>

            {/* Summary */}
            <div className="export-summary">
              <span>Duration: {formatTime(duration)}</span>
            </div>

            {/* Error display */}
            {exportProgress.error && (
              <div className="export-error">{exportProgress.error}</div>
            )}

            {/* Actions */}
            <div className="export-actions">
              <button className="export-btn export-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="export-btn export-btn-export" onClick={handleExport} disabled={!settings.outputPath}>
                Export
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Sub-components
interface CollapsibleSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, expanded, onToggle, children }) => (
  <div className="export-section export-collapsible">
    <div className="export-section-header" onClick={onToggle}>
      <span className={`export-chevron ${expanded ? 'expanded' : ''}`}>▶</span>
      <span className="export-section-title">{title}</span>
    </div>
    {expanded && <div className="export-section-content">{children}</div>}
  </div>
);

interface SettingsRowProps {
  label: string;
  children: React.ReactNode;
}

const SettingsRow: React.FC<SettingsRowProps> = ({ label, children }) => (
  <div className="export-row">
    <label className="export-label">{label}</label>
    {children}
  </div>
);

interface ExportProgressViewProps {
  progress: number;
  speed: string;
  eta: string;
  duration: number;
  formatTime: (seconds: number) => string;
  onCancel: () => void;
}

const ExportProgressView: React.FC<ExportProgressViewProps> = ({
  progress, speed, eta, duration, formatTime, onCancel
}) => (
  <div className="export-progress-view">
    <div className="export-progress-title">Exporting...</div>
    <div className="export-progress-bar-container">
      <div className="export-progress-bar-fill" style={{ width: `${progress}%` }} />
    </div>
    <div className="export-progress-percent">{Math.round(progress)}%</div>
    <div className="export-progress-stats">
      <div className="export-stat">
        <span className="export-stat-label">Time:</span>
        <span className="export-stat-value">
          {formatTime(duration * progress / 100)} / {formatTime(duration)}
        </span>
      </div>
      {speed && (
        <div className="export-stat">
          <span className="export-stat-label">Speed:</span>
          <span className="export-stat-value">{speed}</span>
        </div>
      )}
      {eta && (
        <div className="export-stat">
          <span className="export-stat-label">ETA:</span>
          <span className="export-stat-value">{eta}</span>
        </div>
      )}
    </div>
    <div className="export-progress-actions">
      <button className="export-btn export-btn-cancel" onClick={onCancel}>Cancel</button>
    </div>
  </div>
);

export default ExportDialog;
