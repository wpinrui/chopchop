/**
 * FFmpeg Redux Slice
 *
 * Manages ffmpeg capabilities index and loading state.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { FFmpegCapabilities } from '@types';

interface FFmpegState {
  capabilities: FFmpegCapabilities | null;
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
}

const initialState: FFmpegState = {
  capabilities: null,
  capabilitiesLoading: false,
  capabilitiesError: null,
};

const ffmpegSlice = createSlice({
  name: 'ffmpeg',
  initialState,
  reducers: {
    setCapabilitiesLoading: (state, action: PayloadAction<boolean>) => {
      state.capabilitiesLoading = action.payload;
    },

    setCapabilities: (state, action: PayloadAction<FFmpegCapabilities>) => {
      state.capabilities = action.payload;
      state.capabilitiesLoading = false;
      state.capabilitiesError = null;
    },

    setCapabilitiesError: (state, action: PayloadAction<string>) => {
      state.capabilitiesError = action.payload;
      state.capabilitiesLoading = false;
    },

    clearCapabilities: (state) => {
      state.capabilities = null;
      state.capabilitiesError = null;
    },
  },
});

export const {
  setCapabilitiesLoading,
  setCapabilities,
  setCapabilitiesError,
  clearCapabilities,
} = ffmpegSlice.actions;

export default ffmpegSlice.reducer;
