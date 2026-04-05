import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { createLogger } from '../utils/Logger';
import { LoggingCategories } from '../utils/LoggingSchema';

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  category?: string;
  source: 'project' | 'global';
}

interface SkillPermissionConfig {
  permission?: {
    skill?: Record<string, 'allow' | 'deny' | 'ask'>;
  };
  agent?: Record<string, {
    permission?: {
      skill?: Record<string, 'allow' | 'deny' | 'ask'>;
    };
  }>;
}

export class SkillManagementService {
  private configPath: string;
  private skills: Map<string, SkillInfo> = new Map();
  private config: SkillPermissionConfig = {};
  private _onDidChangeSkills = new vscode.EventEmitter<Map<string, SkillInfo>>();
  private logger = createLogger(LoggingCategories.UI_INTERACTION);
  readonly onDidChangeSkills = this._onDidChangeSkills.event;

  constructor(private context: vscode.ExtensionContext) {
    this.configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  }

  async initialize(): Promise<void> {
    await this.loadConfig();
    await this.discoverSkills();
  }

  private async loadConfig(): Promise<void> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(content);
    } catch (error) {
      this.logger.error('Failed to load opencode.json', { configPath: this.configPath }, error as Error);
      this.config = {};
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
      await this.loadConfig(); // Reload to verify
    } catch (error) {
      this.logger.error('Failed to save opencode.json', { configPath: this.configPath }, error as Error);
      throw error;
    }
  }

  private async discoverSkills(): Promise<void> {
    this.skills.clear();

    const skillDirs = [
      { path: path.join(os.homedir(), '.agents', 'skills'), source: 'global' as const },
      { path: path.join(os.homedir(), '.claude', 'skills'), source: 'global' as const },
      { path: path.join(os.homedir(), '.config', 'opencode', 'skills'), source: 'global' as const },
      { path: '.opencode/skills', source: 'project' as const },
      { path: '.claude/skills', source: 'project' as const },
      { path: '.agents/skills', source: 'project' as const },
    ];

    for (const dir of skillDirs) {
      await this.scanSkillDirectory(dir.path, dir.source);
    }

    this._onDidChangeSkills.fire(this.skills);
  }

  private async scanSkillDirectory(dirPath: string, source: 'project' | 'global'): Promise<void> {
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        return;
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillPath = path.join(dirPath, entry.name);
        await this.loadSkill(skillPath, entry.name, source);
      }
    } catch (error) {
      // Directory doesn't exist or can't be accessed - skip
      return;
    }
  }

  private async loadSkill(skillPath: string, skillName: string, source: 'project' | 'global'): Promise<void> {
    try {
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      const content = await fs.readFile(skillMdPath, 'utf-8');

      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let name = skillName;
      let description = 'No description';

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);

        if (nameMatch) name = nameMatch[1].trim();
        if (descMatch) description = descMatch[1].trim();
      }

      const enabled = this.isSkillEnabled(name);

      this.skills.set(name, {
        name,
        description,
        path: skillPath,
        enabled,
        source,
      });
    } catch (error) {
      // SKILL.md doesn't exist or can't be read - skip
      return;
    }
  }

  private isSkillEnabled(skillName: string): boolean {
    // Check global permissions
    const globalPermissions = this.config.permission?.skill || {};
    const globalRule = this.findMatchingPermission(skillName, globalPermissions);

    // If there's a global allow rule, it's enabled
    if (globalRule === 'allow') {
      return true;
    }

    // If there's a global deny rule, it's disabled
    if (globalRule === 'deny') {
      return false;
    }

    // Check agent-specific permissions (for default "build" agent)
    const buildAgentPermissions = this.config.agent?.['build']?.permission?.skill || {};
    const agentRule = this.findMatchingPermission(skillName, buildAgentPermissions);

    return agentRule === 'allow';
  }

  private findMatchingPermission(skillName: string, permissions: Record<string, string>): string | null {
    // Check exact match first
    if (permissions[skillName]) {
      return permissions[skillName];
    }

    // Check wildcard patterns
    for (const [pattern, permission] of Object.entries(permissions)) {
      if (pattern === '*') {
        return permission;
      }

      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (skillName.startsWith(prefix)) {
          return permission;
        }
      }
    }

    return null;
  }

  getSkills(): SkillInfo[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getEnabledSkills(): SkillInfo[] {
    return this.getSkills().filter(s => s.enabled);
  }

  getDisabledSkills(): SkillInfo[] {
    return this.getSkills().filter(s => !s.enabled);
  }

  searchSkills(query: string): SkillInfo[] {
    const lowerQuery = query.toLowerCase();
    return this.getSkills().filter(skill =>
      skill.name.toLowerCase().includes(lowerQuery) ||
      skill.description.toLowerCase().includes(lowerQuery)
    );
  }

  async enableSkill(skillName: string): Promise<void> {
    if (!this.config.permission) {
      this.config.permission = {};
    }
    if (!this.config.permission.skill) {
      this.config.permission.skill = {};
    }

    this.config.permission.skill[skillName] = 'allow';

    // Update local cache
    const skill = this.skills.get(skillName);
    if (skill) {
      skill.enabled = true;
    }

    await this.saveConfig();
    this._onDidChangeSkills.fire(this.skills);
  }

  async disableSkill(skillName: string): Promise<void> {
    if (!this.config.permission) {
      this.config.permission = {};
    }
    if (!this.config.permission.skill) {
      this.config.permission.skill = {};
    }

    this.config.permission.skill[skillName] = 'deny';

    // Update local cache
    const skill = this.skills.get(skillName);
    if (skill) {
      skill.enabled = false;
    }

    await this.saveConfig();
    this._onDidChangeSkills.fire(this.skills);
  }

  async enableMultipleSkills(skillNames: string[]): Promise<void> {
    if (!this.config.permission) {
      this.config.permission = {};
    }
    if (!this.config.permission.skill) {
      this.config.permission.skill = {};
    }

    for (const name of skillNames) {
      this.config.permission.skill[name] = 'allow';

      const skill = this.skills.get(name);
      if (skill) {
        skill.enabled = true;
      }
    }

    await this.saveConfig();
    this._onDidChangeSkills.fire(this.skills);
  }

  async disableMultipleSkills(skillNames: string[]): Promise<void> {
    if (!this.config.permission) {
      this.config.permission = {};
    }
    if (!this.config.permission.skill) {
      this.config.permission.skill = {};
    }

    for (const name of skillNames) {
      this.config.permission.skill[name] = 'deny';

      const skill = this.skills.get(name);
      if (skill) {
        skill.enabled = false;
      }
    }

    await this.saveConfig();
    this._onDidChangeSkills.fire(this.skills);
  }

  async enableAllSkills(): Promise<void> {
    if (!this.config.permission) {
      this.config.permission = {};
    }

    this.config.permission.skill = { '*': 'allow' };

    // Update local cache
    for (const skill of this.skills.values()) {
      skill.enabled = true;
    }

    await this.saveConfig();
    this._onDidChangeSkills.fire(this.skills);
  }

  async disableAllSkills(): Promise<void> {
    if (!this.config.permission) {
      this.config.permission = {};
    }

    this.config.permission.skill = { '*': 'deny' };

    // Update local cache
    for (const skill of this.skills.values()) {
      skill.enabled = false;
    }

    await this.saveConfig();
    this._onDidChangeSkills.fire(this.skills);
  }

  async applyPreset(preset: 'minimal' | 'development' | 'security' | 'all'): Promise<void> {
    if (!this.config.permission) {
      this.config.permission = {};
    }

    switch (preset) {
      case 'minimal':
        this.config.permission.skill = { '*': 'deny' };
        break;
      case 'development':
        this.config.permission.skill = {
          '*': 'deny',
          'git-*': 'allow',
          'pr-*': 'allow',
          'test-*': 'allow',
          'code-*': 'allow',
          'refactor-*': 'allow',
        };
        break;
      case 'security':
        this.config.permission.skill = {
          '*': 'deny',
          'cybersecurity-*': 'allow',
          'security-*': 'allow',
          'analyzing-*': 'allow',
          'detecting-*': 'allow',
          'hunting-*': 'allow',
        };
        break;
      case 'all':
        this.config.permission.skill = { '*': 'allow' };
        break;
    }

    await this.saveConfig();
    await this.discoverSkills(); // Reload to update enabled states
  }

  async refreshSkills(): Promise<void> {
    await this.discoverSkills();
  }

  dispose(): void {
    this._onDidChangeSkills.dispose();
  }
}
