/// <reference types="vite/client" />

// Electron API types
interface Window {
  electronAPI: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
  };
}
