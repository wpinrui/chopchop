/**
 * Preview IPC Handlers
 *
 * Handles preview rendering operations.
 * Single Responsibility: Preview chunk and full preview rendering.
 */

import { ipcMain } from 'electron';
import fsSync from 'node:fs';
import {
  renderChunk,
  cancelChunkRender,
  cancelAllChunkRenders,
  getChunkOutputDir,
  clearChunkCache,
  renderFullPreview,
  cancelPreviewRender,
  runPreviewPipeline,
  cancelPipeline,
  type PipelineProgress,
} from '../ffmpeg/chunkRenderer';
import { getSimplePreviewEngine, disposeSimplePreviewEngine } from '../preview/SimplePreviewEngine';
import type { IpcContext } from './types';

export function registerPreviewHandlers(context: IpcContext): void {
  // Chunk-based preview handlers
  registerChunkHandlers(context);

  // Full preview handlers
  registerFullPreviewHandlers(context);

  // Simple preview system handlers
  registerSimplePreviewHandlers(context);
}

function registerChunkHandlers(context: IpcContext): void {
  ipcMain.handle('preview:renderChunk', async (
    _event,
    options: {
      chunkId: string;
      startTime: number;
      endTime: number;
      timeline: any;
      media: any[];
      settings: any;
      useProxies: boolean;
    }
  ) => {
    const outputDir = getChunkOutputDir();

    const onProgress = (progress: { chunkId: string; percent: number; fps?: number }) => {
      context.mainWindow?.webContents.send('preview:chunkProgress', progress);
    };

    return await renderChunk({ ...options, outputDir }, onProgress);
  });

  ipcMain.handle('preview:cancelChunk', async (_event, chunkId: string) => {
    return cancelChunkRender(chunkId);
  });

  ipcMain.handle('preview:cancelAllChunks', async () => {
    cancelAllChunkRenders();
  });

  ipcMain.handle('preview:clearCache', async () => {
    await clearChunkCache();
  });

  ipcMain.handle('preview:getChunkDir', async () => {
    return getChunkOutputDir();
  });
}

function registerFullPreviewHandlers(context: IpcContext): void {
  ipcMain.handle('preview:renderFullPreview', async (
    _event,
    options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      useProxies: boolean;
    }
  ) => {
    const onProgress = (progress: { percent: number; fps?: number }) => {
      context.mainWindow?.webContents.send('preview:previewProgress', progress);
    };

    return await renderFullPreview(options, onProgress);
  });

  ipcMain.handle('preview:cancelPreview', async () => {
    cancelPreviewRender();
  });

  ipcMain.handle('preview:runPipeline', async (
    _event,
    options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      proxyScale?: number;
    }
  ) => {
    const onProgress = (progress: PipelineProgress) => {
      context.mainWindow?.webContents.send('preview:pipelineProgress', progress);
    };

    const onProxyGenerated = (mediaId: string, proxyPath: string) => {
      context.mainWindow?.webContents.send('preview:proxyGenerated', { mediaId, proxyPath });
    };

    return await runPreviewPipeline(options, onProgress, onProxyGenerated);
  });

  ipcMain.handle('preview:cancelPipeline', async () => {
    cancelPipeline();
  });
}

function registerSimplePreviewHandlers(context: IpcContext): void {
  ipcMain.handle('preview:init', async (
    _event,
    options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
      projectPath: string | null;
    }
  ) => {
    if (!context.mainWindow) return { success: false, error: 'No main window' };

    try {
      const sanitizedMedia = sanitizeMediaProxyPaths(options.media);
      const engine = getSimplePreviewEngine();
      const state = await engine.initialize(
        options.timeline,
        sanitizedMedia,
        options.settings,
        options.duration,
        options.projectPath,
        context.mainWindow
      );

      return {
        success: true,
        chunks: state.chunks.map(c => ({
          index: c.index,
          startTime: c.startTime,
          endTime: c.endTime,
          status: c.status,
          filePath: c.filePath,
          isComplex: c.isComplex,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('preview:updateTimeline', async (
    _event,
    options: {
      timeline: any;
      media: any[];
      settings: any;
      duration: number;
    }
  ) => {
    try {
      const sanitizedMedia = sanitizeMediaProxyPaths(options.media);
      const engine = getSimplePreviewEngine();
      await engine.onTimelineEdit(
        options.timeline,
        sanitizedMedia,
        options.settings,
        options.duration
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('preview:clearAllCache', async () => {
    try {
      const engine = getSimplePreviewEngine();
      await engine.clearCache();
      await clearChunkCache();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('simplePreview:init', async () => {
    return { success: true };
  });

  ipcMain.handle('simplePreview:renderFullPreview', async () => {
    if (!context.mainWindow) return { success: false, error: 'No main window' };

    try {
      const engine = getSimplePreviewEngine();
      const existingPath = engine.getFullPreviewPath();
      if (existingPath) {
        return { success: true, previewPath: existingPath };
      }

      const previewPath = await engine.renderFullPreview();
      return { success: true, previewPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('simplePreview:getState', async () => {
    const engine = getSimplePreviewEngine();
    return engine.getState();
  });

  ipcMain.handle('simplePreview:getFullPreviewPath', async () => {
    const engine = getSimplePreviewEngine();
    return engine.getFullPreviewPath();
  });

  ipcMain.handle('simplePreview:clearCache', async () => {
    try {
      const engine = getSimplePreviewEngine();
      await engine.clearCache();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}

function sanitizeMediaProxyPaths(media: any[]): any[] {
  return media.map(m => {
    if (m.proxyPath && !fsSync.existsSync(m.proxyPath)) {
      console.log(`[preview] Clearing missing proxy: ${m.proxyPath}`);
      return { ...m, proxyPath: null };
    }
    return m;
  });
}

export function disposePreviewEngine(): void {
  disposeSimplePreviewEngine();
}
