// Configuration file scanner and manager

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface ConfigFile {
  name: string;
  path: string;
  content: string;
  lastModified: number;
  size: number;
}


// Manages scanning and saving of configuration files
export class ConfigFilesProvider {
  private configDir: string;
  private readonly SKIPPED_FILES = ['bun.lock', 'package.json'];

  // Uses ~/.config/opencode if no configDir provided
  constructor(configDir?: string) {
    this.configDir = configDir ?? path.join(os.homedir(), '.config', 'opencode');
  }

  // Scans top-level directory for JSON/JSONC files, sorted alphabetically
  async scanFiles(): Promise<ConfigFile[]> {
    let entries;
    try {
      entries = await fs.readdir(this.configDir, { withFileTypes: true });
    } catch (error) {
      // Directory doesn't exist or can't be read
      return [];
    }
    const files: ConfigFile[] = [];

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory()) continue;

      // Skip non-JSON/JSONC files
      if (!entry.name.endsWith('.json') && !entry.name.endsWith('.jsonc')) continue;

      // Skip backup files
      if (entry.name.endsWith('.bak')) continue;

      // Skip specific unwanted files
      if (this.SKIPPED_FILES.includes(entry.name)) continue;

      const filePath = path.join(this.configDir, entry.name);
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');

      files.push({
        name: entry.name,
        path: filePath,
        content,
        lastModified: stats.mtimeMs,
        size: stats.size,
      });
    }

    // Sort alphabetically by filename
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Saves file with timestamped backup and JSON validation
  async saveFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate that filePath is within config directory
      const resolvedFilePath = path.resolve(filePath);
      const resolvedConfigDir = path.resolve(this.configDir);
      if (!resolvedFilePath.startsWith(resolvedConfigDir)) {
        return {
          success: false,
          error: 'File path must be within the config directory'
        };
      }

      // Step 1: Create backup
      const backupPath = `${filePath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await fs.copyFile(filePath, backupPath);

      // Step 2: Validate JSON
      try {
        JSON.parse(content);
      } catch (jsonError) {
        return {
          success: false,
          error: `Invalid JSON: ${jsonError instanceof Error ? jsonError.message : 'Unknown error'}`
        };
      }

      // Step 3: Write new content
      await fs.writeFile(filePath, content, 'utf-8');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Returns the config directory path
  getConfigDirectory(): string {
    return this.configDir;
  }
}
