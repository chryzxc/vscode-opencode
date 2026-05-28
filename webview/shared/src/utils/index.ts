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

/**
 * Formats a duration in milliseconds to a human-readable string.
 * Examples: "500ms", "3.5s", "2m 30s", "1h 15m 30s"
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
  // Handle invalid values
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return 'n/a';
  }

  // Less than 1 second: show milliseconds
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  // Less than 1 minute: show seconds with decimal
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`;
  }

  // Less than 1 hour: show minutes and seconds
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  // 1 hour or more: show hours, minutes, and optionally seconds
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);

  const parts: string[] = [];
  parts.push(`${hours}h`);

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 && minutes < 5) {
    // Only show seconds if less than 5 minutes for cleaner display
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
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

export function toWorkspaceRelativePath(
  filePath?: string,
  workspaceRoot?: string,
): string {
  const rawPath = (filePath || "").trim();
  if (!rawPath) return "";
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "");

  const normalizedFilePath = normalize(rawPath);
  const rootFromGlobal =
    typeof globalThis !== "undefined"
      ? String(
          (globalThis as { __workspace_root__?: string }).__workspace_root__ ||
            "",
        )
      : "";
  const normalizedWorkspaceRoot = normalize((workspaceRoot || rootFromGlobal).trim());

  if (!normalizedWorkspaceRoot) return rawPath;
  if (
    normalizedFilePath === normalizedWorkspaceRoot ||
    normalizedFilePath.startsWith(`${normalizedWorkspaceRoot}/`)
  ) {
    const relative = normalizedFilePath
      .slice(normalizedWorkspaceRoot.length)
      .replace(/^\/+/, "");
    return relative || rawPath;
  }
  return rawPath;
}
