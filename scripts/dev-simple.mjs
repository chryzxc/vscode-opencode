#!/usr/bin/env node

/**
 * Simple Hot Reload Development Script
 *
 * Uses Node.js built-in modules only - no external dependencies required
 */

import { spawn } from 'child_process';
import { watch } from 'fs';
import { join, dirname } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';

const __filename = import.meta.url;
const __dirname = dirname(pathToFileURL(__filename).pathname);

// ANSI color codes
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

// Track processes
let extensionWatch = null;
let webviewWatch = null;
let reloadTimeout = null;

const EXTENSION_SRC = join(__dirname, '../src');
const WEBVIEW_SRC = join(__dirname, '../webview/shared/src');
const RELOAD_DELAY = 500;

/**
 * Start a process and return it
 */
function startProcess(command, args, cwd, name) {
  const proc = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    cwd
  });

  proc.on('error', (err) => {
    log(`${name} error: ${err.message}`, colors.yellow);
  });

  log(`✓ ${name} started`, colors.green);
  return proc;
}

/**
 * Trigger VSCode to reload the extension
 */
function triggerReload() {
  try {
    // Create a temporary file to signal VSCode
    const markerPath = join(__dirname, '../.hotreload_marker');
    writeFileSync(markerPath, Date.now().toString());
    unlinkSync(markerPath);

    log('🔄 Extension reload signal sent', colors.yellow);
    log('   Reload VSCode window with Ctrl+R or Cmd+R', colors.yellow);
  } catch (err) {
    log(`Warning: ${err.message}`, colors.yellow);
  }
}

/**
 * Debounced reload
 */
function scheduleReload() {
  if (reloadTimeout) clearTimeout(reloadTimeout);

  reloadTimeout = setTimeout(() => {
    log('📦 Changes detected - rebuilding...', colors.blue);
    triggerReload();
  }, RELOAD_DELAY);
}

/**
 * Watch directory recursively
 */
function watchDirectory(dir, onChange) {
  const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
    if (filename && eventType === 'change') {
      const fullPath = join(dir, filename);
      onChange(fullPath);
    }
  });

  watcher.on('error', (err) => {
    log(`Watcher error: ${err.message}`, colors.yellow);
  });

  return watcher;
}

/**
 * Cleanup function
 */
function cleanup() {
  logSection('Stopping');

  if (extensionWatch) {
    extensionWatch.kill();
    log('✓ Extension watch stopped', colors.green);
  }

  if (webviewWatch) {
    webviewWatch.kill();
    log('✓ Webview watch stopped', colors.green);
  }

  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
  }

  log('👋 Goodbye!', colors.cyan);
}

/**
 * Main function
 */
async function main() {
  logSection('🔥 OpenCode Hot Reload Development');

  log('Starting development environment...\n', colors.bright);

  try {
    // Start extension watcher (esbuild)
    logSection('Extension Watch');
    extensionWatch = startProcess(
      'node',
      ['esbuild.config.js', '--watch'],
      join(__dirname, '..'),
      'Extension'
    );

    // Start webview watcher (vite)
    logSection('Webview Watch');
    webviewWatch = startProcess(
      'npm',
      ['run', 'dev'],
      join(__dirname, '../webview/shared'),
      'Webview'
    );

    // Watch extension source
    logSection('File Watchers');
    log('Watching extension source...', colors.blue);
    watchDirectory(EXTENSION_SRC, (path) => {
      log(`📝 Changed: ${path.replace(__dirname, '.')}`, colors.blue);
      scheduleReload();
    });

    log('Watching webview source...', colors.blue);
    watchDirectory(WEBVIEW_SRC, (path) => {
      log(`🎨 Changed: ${path.replace(__dirname, '.')}`, colors.blue);
      // Webview rebuilds automatically via Vite
    });

    log('✓ Watchers active\n', colors.green);

    log('\n✨ Development mode active!', colors.green);
    log('   - Extension changes trigger rebuild', colors.reset);
    log('   - Webview changes auto-rebuild via Vite', colors.reset);
    log('   - Press Ctrl+C to stop\n', colors.yellow);

    // Handle exit signals
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

  } catch (error) {
    log(`Error: ${error.message}`, colors.yellow);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
