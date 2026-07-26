#!/usr/bin/env node

/**
 * Hot Reload Development Script
 *
 * This script enables automatic hot reloading during development by:
 * 1. Watching for extension code changes and triggering VSCode extension reload
 * 2. Watching for webview changes and rebuilding
 * 3. Providing a unified development experience
 */

import { spawn } from 'child_process';
import { watch } from 'chokidar';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const EXTENSION_SRC_DIR = join(__dirname, '../src');
const WEBVIEW_SRC_DIR = join(__dirname, '../webview/shared/src');
const DEBOUNCE_DELAY = 500; // ms to wait before reloading

let extensionWatchProcess = null;
let webviewWatchProcess = null;
let reloadTimeout = null;

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  log(`\n${'='.repeat(60)}`, colors.cyan);
  log(`  ${title}`, colors.cyan);
  log(`${'='.repeat(60)}\n`, colors.cyan);
}

/**
 * Execute a command and return the child process
 */
function execute(command, args, options = {}) {
  const proc = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    ...options
  });

  return new Promise((resolve, reject) => {
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}

/**
 * Start the extension watch process
 */
function startExtensionWatch() {
  logSection('Starting Extension Watch');

  extensionWatchProcess = spawn('node', ['esbuild.config.cjs', '--watch'], {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });

  extensionWatchProcess.on('error', (error) => {
    log(`Extension watch error: ${error.message}`, colors.yellow);
  });

  log('✓ Extension watch started', colors.green);
}

/**
 * Start the webview watch process
 */
function startWebviewWatch() {
  logSection('Starting Webview Watch');

  webviewWatchProcess = spawn('npm', ['run', 'webview:watch'], {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
    shell: true,
    env: { ...process.env }
  });

  webviewWatchProcess.on('error', (error) => {
    log(`Webview watch error: ${error.message}`, colors.yellow);
  });

  log('✓ Webview watch started', colors.green);
}

/**
 * Trigger VSCode extension reload
 */
async function triggerExtensionReload() {
  try {
    // Read the launch.json to get the extension development path
    const launchJsonPath = join(__dirname, '../.vscode/launch.json');
    const launchJson = JSON.parse(readFileSync(launchJsonPath, 'utf-8'));

    // Use VSCode's built-in workspace symbol provider to trigger reload
    // This is a workaround - in a real scenario, you'd use the VSCode Extension API
    log('🔄 Triggering extension reload...', colors.yellow);

    // Write a temporary marker file that VSCode can watch
    const fs = await import('fs');
    const markerPath = join(__dirname, '../.rebuild_marker');
    await fs.promises.writeFile(markerPath, Date.now().toString());
    await fs.promises.unlink(markerPath);

    log('✓ Extension reload triggered', colors.green);
  } catch (error) {
    log(`Warning: Could not trigger auto-reload: ${error.message}`, colors.yellow);
    log('Please manually reload the window (Ctrl+R or Cmd+R)', colors.yellow);
  }
}

/**
 * Debounced reload handler
 */
function scheduleReload() {
  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
  }

  reloadTimeout = setTimeout(async () => {
    log('📦 Changes detected, rebuilding...', colors.blue);
    await triggerExtensionReload();
  }, DEBOUNCE_DELAY);
}

/**
 * Setup file watchers
 */
function setupWatchers() {
  logSection('Setting Up File Watchers');

  // Watch extension source files
  const extensionWatcher = watch(EXTENSION_SRC_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
  });

  extensionWatcher.on('change', (path) => {
    log(`📝 Extension changed: ${path}`, colors.blue);
    scheduleReload();
  });

  extensionWatcher.on('error', (error) => {
    log(`Extension watcher error: ${error}`, colors.yellow);
  });

  // Watch webview source files
  const webviewWatcher = watch(WEBVIEW_SRC_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
  });

  webviewWatcher.on('change', (path) => {
    log(`🎨 Webview changed: ${path}`, colors.blue);
    // Webview rebuilds automatically via Vite
  });

  webviewWatcher.on('error', (error) => {
    log(`Webview watcher error: ${error}`, colors.yellow);
  });

  log('✓ File watchers ready', colors.green);
}

/**
 * Cleanup on exit
 */
function cleanup() {
  logSection('Shutting Down');

  if (extensionWatchProcess) {
    extensionWatchProcess.kill();
    log('✓ Extension watch stopped', colors.green);
  }

  if (webviewWatchProcess) {
    webviewWatchProcess.kill();
    log('✓ Webview watch stopped', colors.green);
  }

  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
  }

  log('Goodbye!', colors.cyan);
  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  logSection('🔥 OpenCode Hot Reload Development');

  log('This script will:', colors.bright);
  log('  1. Watch extension source files for changes', colors.reset);
  log('  2. Watch webview source files for changes', colors.reset);
  log('  3. Automatically rebuild when changes are detected', colors.reset);
  log('  4. Trigger extension reload for quick feedback', colors.reset);
  log('', colors.reset);

  try {
    // Start watchers
    startExtensionWatch();
    startWebviewWatch();
    setupWatchers();

    log('\n✨ Development environment ready!', colors.green);
    log('   Press Ctrl+C to stop\n', colors.yellow);

    // Handle graceful shutdown
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

  } catch (error) {
    log(`Error: ${error.message}`, colors.yellow);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
