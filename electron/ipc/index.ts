/**
 * IPC Handlers Index
 *
 * Exports all IPC handler registration functions.
 */

export { registerFFmpegHandlers } from './ffmpegHandlers';
export { registerMediaHandlers } from './mediaHandlers';
export { registerFileHandlers } from './fileHandlers';
export { registerProjectHandlers } from './projectHandlers';
export { registerExportHandlers } from './exportHandlers';
export { registerSettingsHandlers, loadSettings, updateRecentProjectMenu } from './settingsHandlers';
export { registerAppHandlers, getForceQuit, setForceQuit } from './appHandlers';
export { registerPreviewHandlers, disposePreviewEngine } from './previewHandlers';
export type { IpcContext, AppSettings } from './types';
