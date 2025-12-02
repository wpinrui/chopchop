/**
 * Sequence Settings Component
 *
 * Allows users to configure sequence properties: resolution, frame rate,
 * background color. Auto-initializes from first clip metadata but can be
 * manually overridden.
 */

import React, { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { updateSettings } from '../../store/projectSlice';
import './SequenceSettings.css';

// Common resolution presets
const RESOLUTION_PRESETS = [
  { label: '4K UHD (3840x2160)', width: 3840, height: 2160 },
  { label: '1080p HD (1920x1080)', width: 1920, height: 1080 },
  { label: '720p HD (1280x720)', width: 1280, height: 720 },
  { label: '480p SD (854x480)', width: 854, height: 480 },
  { label: 'Square 1080 (1080x1080)', width: 1080, height: 1080 },
  { label: 'Square 720 (720x720)', width: 720, height: 720 },
  { label: 'Square 512 (512x512)', width: 512, height: 512 },
  { label: 'Portrait 9:16 (1080x1920)', width: 1080, height: 1920 },
  { label: 'Portrait 9:16 (720x1280)', width: 720, height: 1280 },
];

// Common frame rate presets
const FRAME_RATE_PRESETS = [24, 25, 30, 48, 50, 60];

const SequenceSettings: React.FC = () => {
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.project.settings);
  const sequenceInitialized = settings.sequenceInitialized;

  const [width, height] = settings.resolution;
  const frameRate = settings.frameRate;
  const backgroundColor = settings.backgroundColor;

  const handleWidthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newWidth = parseInt(e.target.value, 10);
    if (!isNaN(newWidth) && newWidth > 0) {
      dispatch(updateSettings({ resolution: [newWidth, height] }));
    }
  }, [dispatch, height]);

  const handleHeightChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newHeight = parseInt(e.target.value, 10);
    if (!isNaN(newHeight) && newHeight > 0) {
      dispatch(updateSettings({ resolution: [width, newHeight] }));
    }
  }, [dispatch, width]);

  const handleResolutionPreset = useCallback((preset: typeof RESOLUTION_PRESETS[0]) => {
    dispatch(updateSettings({ resolution: [preset.width, preset.height] }));
  }, [dispatch]);

  const handleFrameRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newRate = parseFloat(e.target.value);
    if (!isNaN(newRate) && newRate > 0) {
      dispatch(updateSettings({ frameRate: newRate }));
    }
  }, [dispatch]);

  const handleFrameRatePreset = useCallback((rate: number) => {
    dispatch(updateSettings({ frameRate: rate }));
  }, [dispatch]);

  const handleBackgroundColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(updateSettings({ backgroundColor: e.target.value }));
  }, [dispatch]);

  // Swap width and height
  const handleSwapDimensions = useCallback(() => {
    dispatch(updateSettings({ resolution: [height, width] }));
  }, [dispatch, width, height]);

  // Calculate aspect ratio display
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  const aspectRatio = `${width / divisor}:${height / divisor}`;

  return (
    <div className="sequence-settings">
      <div className="settings-section">
        <h3>Resolution</h3>

        <div className="settings-row">
          <label>
            Width
            <input
              type="number"
              value={width}
              onChange={handleWidthChange}
              min={1}
              max={7680}
            />
          </label>
          <button
            className="swap-btn"
            onClick={handleSwapDimensions}
            title="Swap width and height"
          >
            ↔
          </button>
          <label>
            Height
            <input
              type="number"
              value={height}
              onChange={handleHeightChange}
              min={1}
              max={4320}
            />
          </label>
        </div>

        <div className="aspect-ratio">
          Aspect Ratio: {aspectRatio}
        </div>

        <div className="presets">
          <span className="presets-label">Presets:</span>
          <div className="preset-buttons">
            {RESOLUTION_PRESETS.map((preset) => (
              <button
                key={`${preset.width}x${preset.height}`}
                className={`preset-btn ${width === preset.width && height === preset.height ? 'active' : ''}`}
                onClick={() => handleResolutionPreset(preset)}
                title={preset.label}
              >
                {preset.width}x{preset.height}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Frame Rate</h3>

        <div className="settings-row">
          <label>
            FPS
            <input
              type="number"
              value={frameRate}
              onChange={handleFrameRateChange}
              min={1}
              max={120}
              step={0.001}
            />
          </label>
        </div>

        <div className="presets">
          <span className="presets-label">Presets:</span>
          <div className="preset-buttons">
            {FRAME_RATE_PRESETS.map((rate) => (
              <button
                key={rate}
                className={`preset-btn ${frameRate === rate ? 'active' : ''}`}
                onClick={() => handleFrameRatePreset(rate)}
              >
                {rate} fps
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Background Color</h3>

        <div className="settings-row color-row">
          <input
            type="color"
            value={backgroundColor}
            onChange={handleBackgroundColorChange}
            className="color-picker"
          />
          <input
            type="text"
            value={backgroundColor}
            onChange={handleBackgroundColorChange}
            className="color-text"
            placeholder="#000000"
          />
          <span className="color-hint">
            Used for gaps and letterboxing
          </span>
        </div>
      </div>

      {sequenceInitialized && (
        <div className="settings-info">
          Sequence was auto-initialized from first clip. You can still change these settings.
        </div>
      )}

      {!sequenceInitialized && (
        <div className="settings-info pending">
          Sequence will auto-initialize from the first clip you add to the timeline.
        </div>
      )}
    </div>
  );
};

export default SequenceSettings;
