/**
 * Skill type definitions for the extension host.
 *
 * These types mirror webview/shared/src/chat/lib/types.ts for use within src/
 * without crossing the package boundary. Keep in sync with the webview types.
 */

export interface SkillDefinition {
  name: string;
  displayName: string;
  version: string;
  description: string;
  agent?: string;
  model?: string;
  template?: string;
  subtask?: boolean;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  installedAt: string;
  installedFrom: string;
  lastUpdated: string;
  dependencies?: {
    skills?: string[];
    minVersion?: string;
  };
  $schema?: string;
}

export interface SkillsMetadata {
  version: number;
  skills: {
    [skillName: string]: {
      path: string;
      version: string;
      installedAt: string;
      installedFrom: string;
      lastChecked: string;
      hash?: string;
    };
  };
  settings: {
    autoUpdate: boolean;
    updateCheckInterval: number;
  };
}

export interface InstallResult {
  success: boolean;
  skill?: SkillDefinition;
  error?: string;
  details?: Array<{ field: string; message: string }>;
}

export interface ProgressUpdate {
  stage: 'downloading' | 'validating' | 'checking_conflicts' | 'saving' | 'updating_metadata';
  percent: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{ field: string; message: string }>;
}
