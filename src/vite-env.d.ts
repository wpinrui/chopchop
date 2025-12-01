/// <reference types="vite/client" />

import type { MediaMetadata, MediaType } from './types';

// Electron API types
interface Window {
  electronAPI: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<string>;

    ffmpeg: {
      check: () => Promise<boolean>;
      getVersion: () => Promise<string | null>;
    };

    media: {
      showImportDialog: () => Promise<string[] | null>;
      probe: (filePath: string) => Promise<{
        metadata: MediaMetadata | null;
        duration: number;
        type: MediaType;
        thumbnailDataUrl: string | null;
      }>;
    };

    file: {
      readText: (filePath: string) => Promise<string>;
      writeText: (filePath: string, content: string) => Promise<void>;
      showSaveDialog: (options: any) => Promise<string | undefined>;
    };
  };
}
