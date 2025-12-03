/**
 * useExportSettings Hook
 *
 * Manages all export settings state in one place.
 * Single Responsibility: Export settings state management.
 */

import { useState, useCallback, useEffect } from 'react';
import type { ExportSettings, ExportPreset } from '@types';
import { getFormatExtension } from './exportOptions';

interface ExportSettingsState {
  outputPath: string;
  selectedPreset: string | null;
  format: string;
  videoCodec: string;
  crf: number;
  encodingPreset: string;
  resolution: string;
  frameRate: string;
  audioCodec: string;
  audioBitrate: string;
  sampleRate: string;
  channels: string;
  useGpu: boolean;
  customArgs: string;
}

interface ExportSettingsActions {
  setOutputPath: (path: string) => void;
  setSelectedPreset: (preset: string | null) => void;
  setFormat: (format: string) => void;
  setVideoCodec: (codec: string) => void;
  setCrf: (crf: number) => void;
  setEncodingPreset: (preset: string) => void;
  setResolution: (resolution: string) => void;
  setFrameRate: (frameRate: string) => void;
  setAudioCodec: (codec: string) => void;
  setAudioBitrate: (bitrate: string) => void;
  setSampleRate: (rate: string) => void;
  setChannels: (channels: string) => void;
  setUseGpu: (useGpu: boolean) => void;
  setCustomArgs: (args: string) => void;
  applyPreset: (preset: ExportPreset) => void;
  buildExportSettings: () => ExportSettings;
  markAsCustom: () => void;
}

const DEFAULT_STATE: ExportSettingsState = {
  outputPath: '',
  selectedPreset: 'youtube-1080p',
  format: 'mp4',
  videoCodec: 'libx264',
  crf: 18,
  encodingPreset: 'slow',
  resolution: '1920x1080',
  frameRate: 'source',
  audioCodec: 'aac',
  audioBitrate: '192k',
  sampleRate: '48000',
  channels: '2',
  useGpu: false,
  customArgs: '',
};

export function useExportSettings(projectName: string): ExportSettingsState & ExportSettingsActions {
  const [state, setState] = useState<ExportSettingsState>(DEFAULT_STATE);

  // Initialize output path from project name
  useEffect(() => {
    if (!state.outputPath && projectName) {
      const defaultName = projectName.replace(/\s+/g, '_');
      setState(s => ({ ...s, outputPath: `${defaultName}.mp4` }));
    }
  }, [projectName, state.outputPath]);

  // Update extension when format changes
  useEffect(() => {
    if (state.outputPath) {
      const ext = getFormatExtension(state.format);
      const baseName = state.outputPath.replace(/\.[^/.]+$/, '');
      setState(s => ({ ...s, outputPath: `${baseName}.${ext}` }));
    }
  }, [state.format]);

  const markAsCustom = useCallback(() => {
    setState(s => ({ ...s, selectedPreset: 'custom' }));
  }, []);

  const setOutputPath = useCallback((outputPath: string) => {
    setState(s => ({ ...s, outputPath }));
  }, []);

  const setSelectedPreset = useCallback((selectedPreset: string | null) => {
    setState(s => ({ ...s, selectedPreset }));
  }, []);

  const setFormat = useCallback((format: string) => {
    setState(s => ({ ...s, format, selectedPreset: 'custom' }));
  }, []);

  const setVideoCodec = useCallback((videoCodec: string) => {
    setState(s => ({ ...s, videoCodec, selectedPreset: 'custom' }));
  }, []);

  const setCrf = useCallback((crf: number) => {
    setState(s => ({ ...s, crf, selectedPreset: 'custom' }));
  }, []);

  const setEncodingPreset = useCallback((encodingPreset: string) => {
    setState(s => ({ ...s, encodingPreset, selectedPreset: 'custom' }));
  }, []);

  const setResolution = useCallback((resolution: string) => {
    setState(s => ({ ...s, resolution, selectedPreset: 'custom' }));
  }, []);

  const setFrameRate = useCallback((frameRate: string) => {
    setState(s => ({ ...s, frameRate, selectedPreset: 'custom' }));
  }, []);

  const setAudioCodec = useCallback((audioCodec: string) => {
    setState(s => ({ ...s, audioCodec, selectedPreset: 'custom' }));
  }, []);

  const setAudioBitrate = useCallback((audioBitrate: string) => {
    setState(s => ({ ...s, audioBitrate, selectedPreset: 'custom' }));
  }, []);

  const setSampleRate = useCallback((sampleRate: string) => {
    setState(s => ({ ...s, sampleRate, selectedPreset: 'custom' }));
  }, []);

  const setChannels = useCallback((channels: string) => {
    setState(s => ({ ...s, channels, selectedPreset: 'custom' }));
  }, []);

  const setUseGpu = useCallback((useGpu: boolean) => {
    setState(s => ({ ...s, useGpu }));
  }, []);

  const setCustomArgs = useCallback((customArgs: string) => {
    setState(s => ({ ...s, customArgs }));
  }, []);

  const applyPreset = useCallback((preset: ExportPreset) => {
    setState(s => {
      const newState = { ...s, selectedPreset: preset.id };

      if (preset.settings.format) newState.format = preset.settings.format;
      if (preset.settings.videoCodec) newState.videoCodec = preset.settings.videoCodec;
      if (preset.settings.audioCodec) newState.audioCodec = preset.settings.audioCodec;

      if (preset.settings.videoCodecOptions) {
        if (preset.settings.videoCodecOptions.crf !== undefined) {
          newState.crf = preset.settings.videoCodecOptions.crf as number;
        }
        if (preset.settings.videoCodecOptions.preset !== undefined) {
          newState.encodingPreset = preset.settings.videoCodecOptions.preset as string;
        }
      }

      if (preset.settings.audioCodecOptions?.b) {
        newState.audioBitrate = preset.settings.audioCodecOptions.b as string;
      }

      if (preset.settings.resolution) {
        if (preset.settings.resolution === 'source') {
          newState.resolution = 'source';
        } else {
          newState.resolution = `${preset.settings.resolution[0]}x${preset.settings.resolution[1]}`;
        }
      }

      return newState;
    });
  }, []);

  const buildExportSettings = useCallback((): ExportSettings => {
    const res: [number, number] | 'source' = state.resolution === 'source'
      ? 'source'
      : state.resolution.split('x').map(Number) as [number, number];

    const fr = state.frameRate === 'source' ? 'source' : parseFloat(state.frameRate);

    return {
      outputPath: state.outputPath,
      format: state.format,
      videoCodec: state.videoCodec,
      videoCodecOptions: {
        crf: state.crf,
        preset: state.encodingPreset,
      },
      audioCodec: state.audioCodec,
      audioCodecOptions: {
        b: state.audioBitrate,
        ar: parseInt(state.sampleRate),
        ac: parseInt(state.channels),
      },
      resolution: res,
      frameRate: fr,
      useGpuEncoding: state.useGpu,
      gpuEncoder: state.useGpu ? 'h264_nvenc' : null,
    };
  }, [state]);

  return {
    ...state,
    setOutputPath,
    setSelectedPreset,
    setFormat,
    setVideoCodec,
    setCrf,
    setEncodingPreset,
    setResolution,
    setFrameRate,
    setAudioCodec,
    setAudioBitrate,
    setSampleRate,
    setChannels,
    setUseGpu,
    setCustomArgs,
    applyPreset,
    buildExportSettings,
    markAsCustom,
  };
}
