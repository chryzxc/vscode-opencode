/**
 * SkillManagementService Regression Tests
 *
 * These tests prevent regressions in skill discovery and management functionality.
 * Skills are critical for extending AI capabilities.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const skillManagementSource = readSource(
  [joinFromRoot('src', 'services', 'SkillManagementService.ts')],
  'SkillManagementService.ts',
);

test.describe('SkillManagementService - Initialization', () => {

  test('has initialize method', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /initialize.*Promise<void>|async initialize\(\)/s,
      'must provide initialize method'
    );
  });

  test('loads configuration on initialization', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /initialize[\s\S]*await this\.loadConfig\(\)/s,
      'must load configuration during initialization'
    );
  });

  test('discovers skills on initialization', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /initialize[\s\S]*await this\.discoverSkills\(\)/s,
      'must discover skills during initialization'
    );
  });

  test('accepts extension context in constructor', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /constructor.*context.*vscode\.ExtensionContext/s,
      'must accept extension context in constructor'
    );
  });

});

test.describe('SkillManagementService - Configuration Management', () => {

  test('has config path for opencode.json', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /configPath.*opencode\.json|\.config\/opencode\/opencode\.json/s,
      'must define path to opencode.json config file'
    );
  });

  test('loads config from filesystem', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadConfig.*fs\.readFile\(this\.configPath/s,
      'must load configuration from filesystem'
    );
  });

  test('parses config as JSON', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadConfig[\s\S]*JSON\.parse\(content\)/s,
      'must parse configuration as JSON'
    );
  });

  test('handles config load errors gracefully', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadConfig.*catch.*error.*logger\.error/s,
      'must handle config load errors gracefully'
    );
  });

  test('sets empty config on load error', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadConfig.*catch.*this\.config\s*=\s*\{\}/s,
      'must set empty config on load error'
    );
  });

  test('saves config to filesystem', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /saveConfig.*fs\.writeFile\(this\.configPath/s,
      'must save configuration to filesystem'
    );
  });

  test('reloads config after saving', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /saveConfig[\s\S]*await this\.loadConfig\(\).*Reload to verify/s,
      'must reload configuration after saving'
    );
  });

});

test.describe('SkillManagementService - Skill Discovery', () => {

  test('has discoverSkills method', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /discoverSkills.*Promise<void>|async discoverSkills\(\)/s,
      'must provide discoverSkills method'
    );
  });

  test('clears existing skills before discovery', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /discoverSkills[\s\S]*this\.skills\.clear\(\)/s,
      'must clear existing skills before discovery'
    );
  });

  test('scans global skill directories', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /\.agents\/skills|\.claude\/skills|\.config\/opencode\/skills/s,
      'must scan global skill directories'
    );
  });

  test('scans project skill directories', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /\.opencode\/skills|\.claude\/skills|\.agents\/skills/s,
      'must scan project skill directories'
    );
  });

  test('fires skills changed event after discovery', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /discoverSkills[\s\S]*_onDidChangeSkills\.fire\(this\.skills\)/s,
      'must fire skills changed event after discovery'
    );
  });

});

test.describe('SkillManagementService - Skill Directory Scanning', () => {

  test('has scanSkillDirectory method', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /scanSkillDirectory.*async.*dirPath.*source/s,
      'must provide scanSkillDirectory method'
    );
  });

  test('checks if path is directory', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /scanSkillDirectory[\s\S]*fs\.stat.*isDirectory\(\)/s,
      'must check if path is a directory'
    );
  });

  test('reads directory entries', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /scanSkillDirectory[\s\S]*fs\.readdir\(dirPath/s,
      'must read directory entries'
    );
  });

  test('processes only directory entries', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /scanSkillDirectory[\s\S]*entry\.isDirectory\(\)/s,
      'must process only directory entries'
    );
  });

  test('handles missing directories gracefully', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /scanSkillDirectory.*catch.*Directory doesn't exist|return/s,
      'must handle missing directories gracefully'
    );
  });

});

test.describe('SkillManagementService - Skill Loading', () => {

  test('has loadSkill method', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill.*async.*skillPath.*skillName.*source/s,
      'must provide loadSkill method'
    );
  });

  test('reads SKILL.md file', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill[\s\S]*SKILL\.md.*fs\.readFile\(skillMdPath/s,
      'must read SKILL.md file'
    );
  });

  test('parses frontmatter from SKILL.md', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill[\s\S]*frontmatterMatch.*---\n\[\s\S\]*?\n---/s,
      'must parse frontmatter from SKILL.md'
    );
  });

  test('extracts name from frontmatter', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill[\s\S]*nameMatch.*name:\s*(.+)/s,
      'must extract name from frontmatter'
    );
  });

  test('extracts description from frontmatter', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill[\s\S]*descMatch.*description:\s*(.+)/s,
      'must extract description from frontmatter'
    );
  });

  test('falls back to directory name for skill name', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill[\s\S]*let name = skillName/s,
      'must use directory name as fallback for skill name'
    );
  });

  test('checks if skill is enabled', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill[\s\S]*enabled.*this\.isSkillEnabled\(name\)/s,
      'must check if skill is enabled'
    );
  });

  test('stores skill info in skills map', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill[\s\S]*this\.skills\.set\(name/s,
      'must store skill info in skills map'
    );
  });

});

test.describe('SkillManagementService - Permission Management', () => {

  test('has isSkillEnabled method', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /isSkillEnabled.*skillName.*boolean/s,
      'must provide isSkillEnabled method'
    );
  });

  test('checks global permissions', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /isSkillEnabled[\s\S]*globalPermissions.*config\.permission\?\.skill/s,
      'must check global permissions'
    );
  });

  test('finds matching permission rule', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /isSkillEnabled[\s\S]*findMatchingPermission/s,
      'must find matching permission rule'
    );
  });

  test('returns true if global allow rule exists', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /isSkillEnabled[\s\S]*globalRule === 'allow'.*return true/s,
      'must return true if global allow rule exists'
    );
  });

});

test.describe('SkillManagementService - Event Emission', () => {

  test('has onDidChangeSkills event', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /onDidChangeSkills.*_onDidChangeSkills\.event/s,
      'must provide onDidChangeSkills event'
    );
  });

  test('creates event emitter for skills changes', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /_onDidChangeSkills.*new vscode\.EventEmitter/s,
      'must create event emitter for skills changes'
    );
  });

  test('fires event when skills change', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /_onDidChangeSkills\.fire/s,
      'must fire event when skills change'
    );
  });

});

test.describe('SkillManagementService - Skill Info Interface', () => {

  test('defines SkillInfo interface', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /interface SkillInfo[\s\S]*name.*description.*path.*enabled.*source/s,
      'must define SkillInfo interface'
    );
  });

  test('SkillInfo includes name property', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /interface SkillInfo[\s\S]*name:\s*string/s,
      'must include name property in SkillInfo'
    );
  });

  test('SkillInfo includes description property', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /interface SkillInfo[\s\S]*description:\s*string/s,
      'must include description property in SkillInfo'
    );
  });

  test('SkillInfo includes path property', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /interface SkillInfo[\s\S]*path:\s*string/s,
      'must include path property in SkillInfo'
    );
  });

  test('SkillInfo includes enabled property', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /interface SkillInfo[\s\S]*enabled:\s*boolean/s,
      'must include enabled property in SkillInfo'
    );
  });

  test('SkillInfo includes source property', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /interface SkillInfo[\s\S]*source:\s*'project'\s*\|\s*'global'\s*\|\s*'server'/s,
      'must include source property in SkillInfo'
    );
  });

});

test.describe('SkillManagementService - Storage', () => {

  test('stores skills in Map', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /skills:\s*Map<string,\s*SkillInfo>\s*=\s*new Map\(\)/s,
      'must store skills in a Map'
    );
  });

  test('stores config in object', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /config:\s*SkillPermissionConfig\s*=\s*\{\}/s,
      'must store config in object'
    );
  });

});

test.describe('SkillManagementService - Logging', () => {

  test('logs config load failures', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /logger\.error.*Failed to load opencode\.json/s,
      'must log config load failures'
    );
  });

  test('logs config save failures', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /logger\.error.*Failed to save opencode\.json/s,
      'must log config save failures'
    );
  });

  test('includes config path in error logs', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /logger\.error[\s\S]*configPath/s,
      'must include config path in error logs'
    );
  });

});

test.describe('SkillManagementService - Error Handling', () => {

  test('handles missing SKILL.md files', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /loadSkill.*catch.*SKILL\.md doesn't exist|return/s,
      'must handle missing SKILL.md files gracefully'
    );
  });

  test('throws error on config save failure', () => {
    const source = skillManagementSource;

    assert.match(
      source,
      /saveConfig.*catch.*error.*throw error/s,
      'must throw error on config save failure'
    );
  });

});
