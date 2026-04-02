import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const FILE_COLORS: Record<string, string> = {
  ts: '#3178c6',
  js: '#f1e05a',
  tsx: '#3178c6',
  jsx: '#f1e05a',
  css: '#563d7c',
  html: '#e34c26',
  json: '#f1e05a',
  md: '#083fa1',
  vue: '#41b883',
  py: '#3572A5',
  go: '#00ADD8',
  java: '#b07219',
  rs: '#dea584',
  php: '#4F5D95',
  rb: '#701516',
  swift: '#ffac45',
  kt: '#F18E33',
  c: '#555555',
  cpp: '#f34b7d'
};

export function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return FILE_COLORS[ext] ?? '#858585';
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * Extracts the filename from a file path, handling both Unix and Windows path separators.
 * This is type-safe and works with relative, absolute, and UNC paths.
 *
 * @param filePath - The file path to extract the filename from
 * @returns The filename (basename) of the file, or the original path if no separator is found
 *
 * @example
 * ```ts
 * getFilename('/path/to/file.md') // 'file.md'
 * getFilename('C:\\path\\to\\file.md') // 'file.md'
 * getFilename('./relative/path.ts') // 'path.ts'
 * getFilename('simple-file.txt') // 'simple-file.txt'
 * ```
 */
export function getFilename(filePath: string): string {
  if (!filePath) return '';
  // Split by both forward slash and backslash to handle Unix and Windows paths
  const segments = filePath.split(/[/\\]/);
  // Get the last segment (filename)
  return segments[segments.length - 1] || filePath;
}
