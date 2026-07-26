#!/usr/bin/env node

/**
 * Simple Hot Reload Development Script
 *
 * Uses Node.js built-in modules only - no external dependencies required
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      ['esbuild.config.cjs', '--watch'],
      join(__dirname, '..'),
      'Extension'
    );

    // Start webview watcher (vite)
    logSection('Webview Watch');
    webviewWatch = startProcess(
      'npm',
      ['run', 'webview:watch'],
      join(__dirname, '..'),
      'Webview'
    );

    log('✓ Build watchers active\n', colors.green);

    log('\n✨ Development mode active!', colors.green);
    log('   - Extension and webview changes rebuild automatically', colors.reset);
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
