/**
 * Development server script
 *
 * Runs Vite dev server which handles both Electron and renderer process.
 */

const { spawn } = require('child_process');

const vite = spawn('vite', [], {
  stdio: 'inherit',
  shell: true,
});

vite.on('error', (err) => {
  console.error('Failed to start Vite:', err);
  process.exit(1);
});

vite.on('exit', (code) => {
  process.exit(code || 0);
});
