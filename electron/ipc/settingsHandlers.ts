/**
 * Settings IPC Handlers
 *
 * Handles application settings persistence.
 * Single Responsibility: Load/save app settings.
 */

import { ipcMain, app, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { AppSettings } from './types';

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

export async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await fs.readFile(getSettingsPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { recentProject: null };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

export async function updateRecentProjectMenu(): Promise<void> {
  const settings = await loadSettings();
  const menu = Menu.getApplicationMenu();
  if (menu) {
    const recentItem = menu.getMenuItemById('recent-project');
    if (recentItem && settings.recentProject) {
      recentItem.enabled = true;
      recentItem.label = `Open Recent: ${path.basename(settings.recentProject)}`;
    }
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:setRecentProject', async (_event, projectPath: string | null) => {
    const settings = await loadSettings();
    settings.recentProject = projectPath;
    await saveSettings(settings);
    await updateRecentProjectMenu();
  });

  ipcMain.handle('settings:getRecentProject', async () => {
    const settings = await loadSettings();
    return settings.recentProject;
  });
}
