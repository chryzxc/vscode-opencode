import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { skillSchema } from './skillSchema';
import type {
  SkillDefinition,
  SkillsMetadata,
  InstallResult,
  ProgressUpdate,
  ValidationResult,
} from '../../webview/shared/src/chat/lib/types';

export class SkillManagerService {
  private skillsDir: string;
  private metadataPath: string;
  private cacheDir: string;
  private backupsDir: string;
  private metadata?: SkillsMetadata;
  private ajv: Ajv;
  private validate: Ajv['ValidateFunction'];

  constructor(private context: vscode.ExtensionContext) {
    this.ajv = new Ajv({ allErrors: true });
    addFormats(this.ajv);
    this.validate = this.ajv.compile(skillSchema);

    this.skillsDir = path.join(this.context.globalStorageUri.fsPath, 'skills');
    this.metadataPath = path.join(this.skillsDir, 'metadata.json');
    this.cacheDir = path.join(this.skillsDir, '.cache');
    this.backupsDir = path.join(this.skillsDir, '.backups');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.skillsDir, { recursive: true });
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.mkdir(this.backupsDir, { recursive: true });
    await this.loadMetadata();
  }

  private async loadMetadata(): Promise<void> {
    try {
      const content = await fs.readFile(this.metadataPath, 'utf-8');
      this.metadata = JSON.parse(content) as SkillsMetadata;
    } catch {
      this.metadata = {
        version: 1,
        skills: {},
        settings: {
          autoUpdate: false,
          updateCheckInterval: 24,
        },
      };
      await this.saveMetadata();
    }
  }

  private async saveMetadata(): Promise<void> {
    if (!this.metadata) {
      throw new Error('Metadata not loaded');
    }
    await fs.writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2));
  }

  async dispose(): Promise<void> {
    // Cleanup if needed
  }

  async listSkills(): Promise<SkillDefinition[]> {
    if (!this.metadata) {
      await this.loadMetadata();
    }

    const skills: SkillDefinition[] = [];
    for (const [name, info] of Object.entries(this.metadata!.skills)) {
      try {
        const skillPath = path.join(this.skillsDir, info.path);
        const content = await fs.readFile(skillPath, 'utf-8');
        const skill = JSON.parse(content) as SkillDefinition;
        skills.push(skill);
      } catch (error) {
        console.error(`Failed to load skill ${name}:`, error);
      }
    }
    return skills;
  }

  async getSkill(name: string): Promise<SkillDefinition | null> {
    const skills = await this.listSkills();
    return skills.find((s) => s.name === name) || null;
  }

  async saveSkill(skill: SkillDefinition): Promise<void> {
    if (!this.metadata) {
      await this.loadMetadata();
    }

    if (!skill.name || !skill.name.match(/^[a-z0-9-]+$/)) {
      throw new Error('Invalid skill name. Use lowercase letters, numbers, and hyphens only.');
    }

    const fileName = `${skill.name}.json`;
    const filePath = path.join(this.skillsDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(skill, null, 2));

    this.metadata!.skills[skill.name] = {
      path: fileName,
      version: skill.version,
      installedAt: skill.installedAt,
      installedFrom: skill.installedFrom,
      lastChecked: new Date().toISOString(),
    };

    await this.saveMetadata();
  }

  async deleteSkill(name: string): Promise<void> {
    if (!this.metadata) {
      await this.loadMetadata();
    }

    const skillInfo = this.metadata!.skills[name];
    if (!skillInfo) {
      throw new Error(`Skill ${name} not found`);
    }

    const filePath = path.join(this.skillsDir, skillInfo.path);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error(`Failed to delete skill file:`, error);
      throw new Error(`Failed to delete skill file for ${name}`);
    }

    delete this.metadata!.skills[name];
    await this.saveMetadata();
  }

  async updateSkill(name: string, updates: Partial<SkillDefinition>): Promise<void> {
    const skill = await this.getSkill(name);
    if (!skill) {
      throw new Error(`Skill ${name} not found`);
    }

    const updatedSkill = { ...skill, ...updates, lastUpdated: new Date().toISOString() };
    await this.saveSkill(updatedSkill);
  }

  validateSkill(skill: unknown): ValidationResult {
    const valid = this.validate(skill);

    if (valid) {
      return { valid: true };
    }

    const errors = this.validate.errors?.map((err) => ({
      field: err.instancePath.replace(/^\//, '') || 'root',
      message: err.message || 'Invalid value',
    })) || [];

    return { valid: false, errors };
  }

  async installFromUrl(
    url: string,
    onProgress?: (progress: ProgressUpdate) => void,
  ): Promise<InstallResult> {
    try {
      const axios = (await import('axios')).default;
      onProgress?.({ stage: 'downloading', percent: 10, message: 'Downloading skill...' });

      const response = await axios.get(url, { timeout: 30000 });
      const skillData = response.data;

      onProgress?.({ stage: 'validating', percent: 30, message: 'Validating skill...' });

      const validation = this.validateSkill(skillData);
      if (!validation.valid) {
        return {
          success: false,
          error: 'Invalid skill definition',
          details: validation.errors,
        };
      }

      onProgress?.({ stage: 'checking_conflicts', percent: 50, message: 'Checking for conflicts...' });

      const existingSkill = await this.getSkill(skillData.name);
      if (existingSkill) {
        const overwrite = await vscode.window.showWarningMessage(
          `Skill "${skillData.name}" already exists. Overwrite?`,
          'Yes',
          'No',
        );

        if (overwrite !== 'Yes') {
          return {
            success: false,
            error: 'Installation cancelled: skill already exists',
          };
        }
      }

      onProgress?.({ stage: 'saving', percent: 70, message: 'Installing skill...' });

      const skill: SkillDefinition = {
        ...skillData,
        installedAt: new Date().toISOString(),
        installedFrom: url,
        lastUpdated: new Date().toISOString(),
      };

      await this.saveSkill(skill);

      onProgress?.({ stage: 'updating_metadata', percent: 90, message: 'Finalizing...' });

      return { success: true, skill };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to install from URL: ${message}`,
      };
    }
  }

  async installFromFile(filePath: string): Promise<InstallResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const skillData = JSON.parse(content);

      const validation = this.validateSkill(skillData);
      if (!validation.valid) {
        return {
          success: false,
          error: 'Invalid skill definition',
          details: validation.errors,
        };
      }

      const existingSkill = await this.getSkill(skillData.name);
      if (existingSkill) {
        const overwrite = await vscode.window.showWarningMessage(
          `Skill "${skillData.name}" already exists. Overwrite?`,
          'Yes',
          'No',
        );

        if (overwrite !== 'Yes') {
          return {
            success: false,
            error: 'Installation cancelled: skill already exists',
          };
        }
      }

      const skill: SkillDefinition = {
        ...skillData,
        installedAt: new Date().toISOString(),
        installedFrom: filePath,
        lastUpdated: new Date().toISOString(),
      };

      await this.saveSkill(skill);

      return { success: true, skill };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to install from file: ${message}`,
      };
    }
  }
}
