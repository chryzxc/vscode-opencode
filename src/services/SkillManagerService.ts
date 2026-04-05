import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { skillSchema } from './skillSchema';
import { createLogger } from '../utils/Logger';
import { LoggingCategories } from '../utils/LoggingSchema';
import type {
  SkillDefinition,
  SkillsMetadata,
  InstallResult,
  ProgressUpdate,
  ValidationResult,
} from './skillTypes';

export class SkillManagerService {
  private skillsDir: string;
  private metadataPath: string;
  private cacheDir: string;
  private backupsDir: string;
  private metadata?: SkillsMetadata;
  private ajv: Ajv;
  private validate: ReturnType<Ajv['compile']>;
  private logger = createLogger(LoggingCategories.UI_INTERACTION);

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
    // Clear cache on dispose
    this.skillsCache = null;
    this.skillsCacheTime = 0;
  }

  /**
   * Clears the skills cache. Useful when skills are modified externally.
   */
  clearCache(): void {
    this.skillsCache = null;
    this.skillsCacheTime = 0;
  }

  // Add caching for skills to avoid repeated file reads
  private skillsCache: SkillDefinition[] | null = null;
  private skillsCacheTime: number = 0;
  private readonly SKILLS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  async listSkills(): Promise<SkillDefinition[]> {
    // Return cache if fresh (even with expired cache, prefer stale cache over blocking)
    if (this.skillsCache && Date.now() - this.skillsCacheTime < this.SKILLS_CACHE_TTL_MS) {
      return this.skillsCache;
    }

    if (!this.metadata) {
      await this.loadMetadata();
    }

    // If we have cached skills (even if expired), return them immediately
    // and refresh in background
    if (this.skillsCache && this.skillsCache.length > 0) {
      // Trigger background refresh without waiting
      this.refreshSkillsCache().catch((error) => {
        this.logger.error('Failed to refresh skills cache', {}, error as Error);
      });
      return this.skillsCache;
    }

    // No cache available, must load synchronously
    return await this.refreshSkillsCache();
  }

  private async refreshSkillsCache(): Promise<SkillDefinition[]> {
    const skills: SkillDefinition[] = [];
    for (const [name, info] of Object.entries(this.metadata!.skills)) {
      try {
        const skillPath = path.join(this.skillsDir, info.path);
        const content = await fs.readFile(skillPath, 'utf-8');
        const skill = JSON.parse(content) as SkillDefinition;
        skills.push(skill);
      } catch (error) {
        this.logger.error('Failed to load skill', { skillName: name }, error as Error);
      }
    }
    this.skillsCache = skills;
    this.skillsCacheTime = Date.now();
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

    // Invalidate cache when skill is saved
    this.skillsCache = null;
    this.skillsCacheTime = 0;
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
      this.logger.error('Failed to delete skill file', { skillName: name, filePath }, error as Error);
      throw new Error(`Failed to delete skill file for ${name}`);
    }

    delete this.metadata!.skills[name];
    await this.saveMetadata();

    // Invalidate cache when skill is deleted
    this.skillsCache = null;
    this.skillsCacheTime = 0;
  }

  async updateSkill(name: string, updates: Partial<SkillDefinition>): Promise<void> {
    const skill = await this.getSkill(name);
    if (!skill) {
      throw new Error(`Skill ${name} not found`);
    }

    const updatedSkill = { ...skill, ...updates, lastUpdated: new Date().toISOString() };
    await this.saveSkill(updatedSkill);

    // Cache is already invalidated in saveSkill, but let's be explicit
    this.skillsCache = null;
    this.skillsCacheTime = 0;
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

      // Cache is already invalidated in saveSkill
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
