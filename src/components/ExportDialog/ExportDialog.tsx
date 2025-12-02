/**
 * Export Dialog Component
 *
 * Rich dialog for exporting timeline to video with ffmpeg.
 * Supports presets and full customization of encoding settings.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import type { ExportSettings, ExportPreset } from '@types';
import { DEFAULT_EXPORT_PRESETS } from '@types';
import './ExportDialog.css';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Video codec options
const VIDEO_CODECS = [
  { value: 'libx264', label: 'H.264 (libx264)', presets: true },
  { value: 'libx265', label: 'H.265/HEVC (libx265)', presets: true },
  { value: 'libvpx-vp9', label: 'VP9 (libvpx)', presets: false },
  { value: 'libaom-av1', label: 'AV1 (libaom)', presets: false },
  { value: 'prores_ks', label: 'ProRes (prores_ks)', presets: false },
  { value: 'dnxhd', label: 'DNxHD/DNxHR', presets: false },
];

// Audio codec options
const AUDIO_CODECS = [
  { value: 'aac', label: 'AAC' },
  { value: 'libmp3lame', label: 'MP3' },
  { value: 'libopus', label: 'Opus' },
  { value: 'flac', label: 'FLAC (lossless)' },
  { value: 'pcm_s16le', label: 'PCM 16-bit (uncompressed)' },
];

// Container formats
const FORMATS = [
  { value: 'mp4', label: 'MP4', extensions: ['mp4'] },
  { value: 'mov', label: 'QuickTime (MOV)', extensions: ['mov'] },
  { value: 'webm', label: 'WebM', extensions: ['webm'] },
  { value: 'mkv', label: 'Matroska (MKV)', extensions: ['mkv'] },
  { value: 'avi', label: 'AVI', extensions: ['avi'] },
];

// Resolution presets
const RESOLUTIONS = [
  { value: 'source', label: 'Source' },
  { value: '3840x2160', label: '4K (3840×2160)' },
  { value: '2560x1440', label: '1440p (2560×1440)' },
  { value: '1920x1080', label: '1080p (1920×1080)' },
  { value: '1280x720', label: '720p (1280×720)' },
  { value: '854x480', label: '480p (854×480)' },
];

// Frame rate options
const FRAME_RATES = [
  { value: 'source', label: 'Source' },
  { value: '60', label: '60 fps' },
  { value: '59.94', label: '59.94 fps' },
  { value: '50', label: '50 fps' },
  { value: '30', label: '30 fps' },
  { value: '29.97', label: '29.97 fps' },
  { value: '25', label: '25 fps' },
  { value: '24', label: '24 fps' },
  { value: '23.976', label: '23.976 fps' },
];

// Encoding presets (x264/x265)
const ENCODING_PRESETS = [
  'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
  'medium', 'slow', 'slower', 'veryslow'
];

// Audio bitrates
const AUDIO_BITRATES = ['96k', '128k', '192k', '256k', '320k'];

// Audio sample rates
const SAMPLE_RATES = ['44100', '48000', '96000'];

// Audio channels
const CHANNEL_OPTIONS = [
  { value: '1', label: 'Mono' },
  { value: '2', label: 'Stereo' },
  { value: '6', label: '5.1 Surround' },
];

const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose }) => {
  const project = useSelector((state: RootState) => state.project);
  const timeline = useSelector((state: RootState) => state.timeline);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportSpeed, setExportSpeed] = useState('');
  const [exportEta, setExportEta] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);

  // Settings state
  const [outputPath, setOutputPath] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>('youtube-1080p');
  const [format, setFormat] = useState('mp4');
  const [videoCodec, setVideoCodec] = useState('libx264');
  const [crf, setCrf] = useState(18);
  const [encodingPreset, setEncodingPreset] = useState('slow');
  const [resolution, setResolution] = useState<string>('1920x1080');
  const [frameRate, setFrameRate] = useState<string>('source');
  const [audioCodec, setAudioCodec] = useState('aac');
  const [audioBitrate, setAudioBitrate] = useState('192k');
  const [sampleRate, setSampleRate] = useState('48000');
  const [channels, setChannels] = useState('2');
  const [useGpu, setUseGpu] = useState(false);
  const [nvencAvailable, setNvencAvailable] = useState<boolean | null>(null);
  const [customArgs, setCustomArgs] = useState('');

  // Collapsible sections
  const [videoExpanded, setVideoExpanded] = useState(true);
  const [audioExpanded, setAudioExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  // Calculate timeline duration
  const timelineDuration = useCallback(() => {
    let maxEnd = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const end = clip.timelineStart + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd;
  }, [timeline.tracks]);

  // Format time for display
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Initialize default output path
  useEffect(() => {
    if (isOpen && !outputPath) {
      const defaultName = project.name.replace(/\s+/g, '_');
      setOutputPath(`${defaultName}.mp4`);
    }
  }, [isOpen, project.name, outputPath]);

  // Check for NVENC availability when dialog opens
  useEffect(() => {
    if (isOpen && nvencAvailable === null) {
      window.electronAPI.ffmpeg.checkNvenc().then((available: boolean) => {
        setNvencAvailable(available);
        // If user had GPU enabled but it's not available, disable it
        if (!available && useGpu) {
          setUseGpu(false);
        }
      });
    }
  }, [isOpen, nvencAvailable, useGpu]);

  // Apply preset
  const applyPreset = useCallback((preset: ExportPreset) => {
    setSelectedPreset(preset.id);
    if (preset.settings.format) setFormat(preset.settings.format);
    if (preset.settings.videoCodec) setVideoCodec(preset.settings.videoCodec);
    if (preset.settings.audioCodec) setAudioCodec(preset.settings.audioCodec);

    if (preset.settings.videoCodecOptions) {
      if (preset.settings.videoCodecOptions.crf !== undefined) {
        setCrf(preset.settings.videoCodecOptions.crf as number);
      }
      if (preset.settings.videoCodecOptions.preset !== undefined) {
        setEncodingPreset(preset.settings.videoCodecOptions.preset as string);
      }
    }

    if (preset.settings.audioCodecOptions?.b) {
      setAudioBitrate(preset.settings.audioCodecOptions.b as string);
    }

    if (preset.settings.resolution) {
      if (preset.settings.resolution === 'source') {
        setResolution('source');
      } else {
        setResolution(`${preset.settings.resolution[0]}x${preset.settings.resolution[1]}`);
      }
    }
  }, []);

  // Handle browse
  const handleBrowse = useCallback(async () => {
    const formatInfo = FORMATS.find(f => f.value === format);
    const extensions = formatInfo?.extensions || ['mp4'];

    const filePath = await window.electronAPI.file.showSaveDialog(
      outputPath || `${project.name}.${extensions[0]}`
    );
    if (filePath) {
      setOutputPath(filePath);
    }
  }, [format, outputPath, project.name]);

  // Build export settings
  const buildExportSettings = useCallback((): ExportSettings => {
    const res: [number, number] | 'source' = resolution === 'source'
      ? 'source'
      : resolution.split('x').map(Number) as [number, number];

    const fr = frameRate === 'source' ? 'source' : parseFloat(frameRate);

    return {
      outputPath,
      format,
      videoCodec,
      videoCodecOptions: {
        crf,
        preset: encodingPreset,
      },
      audioCodec,
      audioCodecOptions: {
        b: audioBitrate,
        ar: parseInt(sampleRate),
        ac: parseInt(channels),
      },
      resolution: res,
      frameRate: fr,
      useGpuEncoding: useGpu,
      gpuEncoder: useGpu ? 'h264_nvenc' : null,
    };
  }, [
    outputPath, format, videoCodec, crf, encodingPreset,
    audioCodec, audioBitrate, sampleRate, channels,
    resolution, frameRate, useGpu
  ]);

  // Check if path is absolute (Windows or Unix style)
  const isAbsolutePath = (p: string) => {
    // Windows: starts with drive letter like C:\ or C:/
    // Unix: starts with /
    return /^[a-zA-Z]:[/\\]/.test(p) || p.startsWith('/');
  };

  // Actual export logic (defined first so handleExport can use it)
  const doExport = useCallback(async (exportPath: string) => {
    setIsExporting(true);
    setExportProgress(0);
    setExportError(null);

    try {
      const exportSettings = buildExportSettings();
      // Override outputPath with the absolute path
      exportSettings.outputPath = exportPath;

      // Set up progress listener
      const removeListener = window.electronAPI.export.onProgress((progress: { percent?: number; speed?: string; eta?: string }) => {
        setExportProgress(progress.percent || 0);
        if (progress.speed) setExportSpeed(progress.speed);
        if (progress.eta) setExportEta(progress.eta);
      });

      // Call export with timeline, media, and settings
      const result = await window.electronAPI.export.start({
        timeline,
        media: project.media,
        exportSettings,
      });

      removeListener();

      if (result.success) {
        setIsExporting(false);
        onClose();
      } else {
        setExportError(result.error || 'Export failed');
        setIsExporting(false);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
      setIsExporting(false);
    }
  }, [buildExportSettings, onClose, timeline, project.media]);

  // Handle export button click
  const handleExport = useCallback(async () => {
    if (!outputPath) {
      setExportError('Please select an output file');
      return;
    }

    // If path is relative, prompt user to select location via Browse dialog
    if (!isAbsolutePath(outputPath)) {
      const formatInfo = FORMATS.find(f => f.value === format);
      const extensions = formatInfo?.extensions || ['mp4'];

      const filePath = await window.electronAPI.file.showSaveDialog(
        outputPath || `${project.name}.${extensions[0]}`
      );

      if (!filePath) {
        // User cancelled the dialog
        return;
      }

      setOutputPath(filePath);
      // Continue with the export using the selected path
      await doExport(filePath);
      return;
    }

    await doExport(outputPath);
  }, [outputPath, format, project.name, doExport]);

  // Handle cancel export
  const handleCancelExport = useCallback(async () => {
    await window.electronAPI.export.cancel();
    setIsExporting(false);
    setExportProgress(0);
  }, []);

  // Update output extension when format changes
  useEffect(() => {
    if (outputPath) {
      const formatInfo = FORMATS.find(f => f.value === format);
      const ext = formatInfo?.extensions[0] || 'mp4';
      const baseName = outputPath.replace(/\.[^/.]+$/, '');
      setOutputPath(`${baseName}.${ext}`);
    }
  }, [format]);

  if (!isOpen) return null;

  const duration = timelineDuration();

  return (
    <div className="export-dialog-overlay">
      <div className="export-dialog" onClick={e => e.stopPropagation()}>
        <div className="export-dialog-header">
          <h2>Export</h2>
          <button className="export-close-btn" onClick={onClose}>×</button>
        </div>

        {isExporting ? (
          // Export progress view
          <div className="export-progress-view">
            <div className="export-progress-title">Exporting...</div>

            <div className="export-progress-bar-container">
              <div
                className="export-progress-bar-fill"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <div className="export-progress-percent">{Math.round(exportProgress)}%</div>

            <div className="export-progress-stats">
              <div className="export-stat">
                <span className="export-stat-label">Time:</span>
                <span className="export-stat-value">
                  {formatTime(duration * exportProgress / 100)} / {formatTime(duration)}
                </span>
              </div>
              {exportSpeed && (
                <div className="export-stat">
                  <span className="export-stat-label">Speed:</span>
                  <span className="export-stat-value">{exportSpeed}</span>
                </div>
              )}
              {exportEta && (
                <div className="export-stat">
                  <span className="export-stat-label">ETA:</span>
                  <span className="export-stat-value">{exportEta}</span>
                </div>
              )}
            </div>

            <div className="export-progress-actions">
              <button className="export-btn export-btn-cancel" onClick={handleCancelExport}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          // Settings view
          <>
            {/* Output path */}
            <div className="export-section">
              <div className="export-row">
                <label className="export-label">Output:</label>
                <input
                  type="text"
                  className="export-input export-path-input"
                  value={outputPath}
                  onChange={e => setOutputPath(e.target.value)}
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
                    className={`export-preset ${selectedPreset === preset.id ? 'selected' : ''}`}
                    onClick={() => applyPreset(preset)}
                  >
                    <div className="export-preset-name">{preset.name}</div>
                    <div className="export-preset-desc">{preset.description}</div>
                  </button>
                ))}
                <button
                  className={`export-preset ${selectedPreset === 'custom' ? 'selected' : ''}`}
                  onClick={() => setSelectedPreset('custom')}
                >
                  <div className="export-preset-name">Custom</div>
                  <div className="export-preset-desc">Configure manually</div>
                </button>
              </div>
            </div>

            {/* Video Settings */}
            <div className="export-section export-collapsible">
              <div
                className="export-section-header"
                onClick={() => setVideoExpanded(!videoExpanded)}
              >
                <span className={`export-chevron ${videoExpanded ? 'expanded' : ''}`}>▶</span>
                <span className="export-section-title">Video Settings</span>
              </div>
              {videoExpanded && (
                <div className="export-section-content">
                  <div className="export-row">
                    <label className="export-label">Format:</label>
                    <select
                      className="export-select"
                      value={format}
                      onChange={e => { setFormat(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {FORMATS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Codec:</label>
                    <select
                      className="export-select"
                      value={videoCodec}
                      onChange={e => { setVideoCodec(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {VIDEO_CODECS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Resolution:</label>
                    <select
                      className="export-select"
                      value={resolution}
                      onChange={e => { setResolution(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {RESOLUTIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Frame Rate:</label>
                    <select
                      className="export-select"
                      value={frameRate}
                      onChange={e => { setFrameRate(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {FRAME_RATES.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Quality (CRF):</label>
                    <input
                      type="range"
                      className="export-slider"
                      min="0"
                      max="51"
                      value={crf}
                      onChange={e => { setCrf(parseInt(e.target.value)); setSelectedPreset('custom'); }}
                    />
                    <span className="export-slider-value">{crf}</span>
                    <span className="export-slider-hint">
                      {crf <= 18 ? '(High quality)' : crf <= 28 ? '(Balanced)' : '(Smaller file)'}
                    </span>
                  </div>

                  {VIDEO_CODECS.find(c => c.value === videoCodec)?.presets && (
                    <div className="export-row">
                      <label className="export-label">Preset:</label>
                      <select
                        className="export-select"
                        value={encodingPreset}
                        onChange={e => { setEncodingPreset(e.target.value); setSelectedPreset('custom'); }}
                      >
                        {ENCODING_PRESETS.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <span className="export-hint">(slower = smaller file)</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Audio Settings */}
            <div className="export-section export-collapsible">
              <div
                className="export-section-header"
                onClick={() => setAudioExpanded(!audioExpanded)}
              >
                <span className={`export-chevron ${audioExpanded ? 'expanded' : ''}`}>▶</span>
                <span className="export-section-title">Audio Settings</span>
              </div>
              {audioExpanded && (
                <div className="export-section-content">
                  <div className="export-row">
                    <label className="export-label">Codec:</label>
                    <select
                      className="export-select"
                      value={audioCodec}
                      onChange={e => { setAudioCodec(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {AUDIO_CODECS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Bitrate:</label>
                    <select
                      className="export-select"
                      value={audioBitrate}
                      onChange={e => { setAudioBitrate(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {AUDIO_BITRATES.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Sample Rate:</label>
                    <select
                      className="export-select"
                      value={sampleRate}
                      onChange={e => { setSampleRate(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {SAMPLE_RATES.map(r => (
                        <option key={r} value={r}>{parseInt(r).toLocaleString()} Hz</option>
                      ))}
                    </select>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Channels:</label>
                    <select
                      className="export-select"
                      value={channels}
                      onChange={e => { setChannels(e.target.value); setSelectedPreset('custom'); }}
                    >
                      {CHANNEL_OPTIONS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Advanced Settings */}
            <div className="export-section export-collapsible">
              <div
                className="export-section-header"
                onClick={() => setAdvancedExpanded(!advancedExpanded)}
              >
                <span className={`export-chevron ${advancedExpanded ? 'expanded' : ''}`}>▶</span>
                <span className="export-section-title">Advanced</span>
              </div>
              {advancedExpanded && (
                <div className="export-section-content">
                  <div className="export-row">
                    <label className={`export-checkbox-label ${nvencAvailable === false ? 'disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={useGpu}
                        onChange={e => setUseGpu(e.target.checked)}
                        disabled={nvencAvailable === false}
                      />
                      Use GPU encoding (NVENC)
                      {nvencAvailable === null && <span className="export-hint"> (checking...)</span>}
                      {nvencAvailable === false && <span className="export-hint export-hint-error"> (not available - CUDA drivers required)</span>}
                      {nvencAvailable === true && <span className="export-hint export-hint-success"> (available)</span>}
                    </label>
                  </div>

                  <div className="export-row">
                    <label className="export-label">Custom ffmpeg args:</label>
                    <input
                      type="text"
                      className="export-input"
                      value={customArgs}
                      onChange={e => setCustomArgs(e.target.value)}
                      placeholder="-movflags +faststart"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="export-summary">
              <span>Duration: {formatTime(duration)}</span>
              {/* Could add estimated file size here */}
            </div>

            {/* Error display */}
            {exportError && (
              <div className="export-error">{exportError}</div>
            )}

            {/* Actions */}
            <div className="export-actions">
              <button className="export-btn export-btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="export-btn export-btn-export"
                onClick={handleExport}
                disabled={!outputPath}
              >
                Export
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ExportDialog;
