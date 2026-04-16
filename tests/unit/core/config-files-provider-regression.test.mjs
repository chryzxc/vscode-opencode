/**
 * ConfigFilesProvider Regression Tests
 *
 * These tests prevent regressions in configuration file management.
 * Config file management is critical for extension customization.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const configFilesSource = readSource(
  [joinFromRoot('src', 'providers', 'ConfigFilesProvider.ts')],
  'ConfigFilesProvider.ts',
);

test.describe('ConfigFilesProvider - Initialization', () => {

  test('accepts optional config directory', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /constructor\(configDir\?:\s*string\)/s,
      'must accept optional config directory parameter'
    );
  });

  test('uses default config directory when not provided', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /this\.configDir\s*=\s*configDir\s*\?\?\s*path\.join\(os\.homedir\(\),\s*'\.config',\s*'opencode'\)/s,
      'must use ~/.config/opencode as default directory'
    );
  });

});

test.describe('ConfigFilesProvider - File Scanning', () => {

  test('has scanFiles method', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /async scanFiles\(\).*Promise<ConfigFile\[\]>/s,
      'must provide scanFiles method returning config file array'
    );
  });

  test('reads directory entries', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*fs\.readdir\(this\.configDir/s,
      'must read directory entries'
    );
  });

  test('handles missing directory gracefully', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles.*catch.*Directory doesn't exist.*return\s*\[\]/s,
      'must return empty array if directory doesn\'t exist'
    );
  });

  test('skips directories', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*entry\.isDirectory\(\).*continue/s,
      'must skip directory entries'
    );
  });

  test('filters JSON and JSONC files', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*\.endsWith\('\.json'\).*\.endsWith\('\.jsonc'\)/s,
      'must filter for .json and .jsonc files'
    );
  });

  test('skips backup files', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*\.endsWith\('\.bak'\).*continue/s,
      'must skip .bak backup files'
    );
  });

  test('skips specific unwanted files', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /SKIPPED_FILES.*bun\.lock.*package\.json|includes\(entry\.name\)/s,
      'must skip specific unwanted files'
    );
  });

  test('reads file content', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*fs\.readFile\(filePath.*'utf-8'/s,
      'must read file content as UTF-8'
    );
  });

  test('gets file stats', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*fs\.stat\(filePath\)/s,
      'must get file stats'
    );
  });

});

test.describe('ConfigFilesProvider - File Metadata', () => {

  test('includes file name in metadata', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*name:\s*entry\.name/s,
      'must include file name in metadata'
    );
  });

  test('includes file path in metadata', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*path:\s*filePath/s,
      'must include file path in metadata'
    );
  });

  test('includes file content in metadata', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*content.*content/s,
      'must include file content in metadata'
    );
  });

  test('includes last modified time', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*lastModified:\s*stats\.mtimeMs/s,
      'must include last modified timestamp'
    );
  });

  test('includes file size', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*size:\s*stats\.size/s,
      'must include file size'
    );
  });

});

test.describe('ConfigFilesProvider - File Sorting', () => {

  test('sorts files alphabetically', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /scanFiles[\s\S]*return files\.sort\(\(a,\s*b\)\s*=>\s*a\.name\.localeCompare\(b\.name\)\)/s,
      'must sort files alphabetically by name'
    );
  });

});

test.describe('ConfigFilesProvider - File Saving', () => {

  test('has saveFile method', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /async saveFile\(filePath.*content\).*Promise<\{.*success.*boolean/s,
      'must provide saveFile method'
    );
  });

  test('validates file path is within config directory', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile[\s\S]*resolvedFilePath\.startsWith\(resolvedConfigDir\)/s,
      'must validate file path is within config directory'
    );
  });

  test('returns error if path is outside config directory', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile[\s\S]*success:\s*false.*error.*within the config directory/s,
      'must return error if path is outside config directory'
    );
  });

  test('creates timestamped backup before saving', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile[\s\S]*backupPath.*\.bak\..*toISOString\(\).*replace.*fs\.copyFile/s,
      'must create timestamped backup before saving'
    );
  });

  test('validates JSON before saving', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile[\s\S]*JSON\.parse\(content\)/s,
      'must validate JSON before writing'
    );
  });

  test('returns error if JSON is invalid', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile[\s\S]*catch.*jsonError.*success:\s*false.*Invalid JSON/s,
      'must return error if JSON is invalid'
    );
  });

  test('writes file content to disk', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile[\s\S]*fs\.writeFile\(filePath.*content.*'utf-8'/s,
      'must write file content to disk'
    );
  });

  test('returns success on successful save', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile[\s\S]*return\s*\{\s*success:\s*true\s*\}/s,
      'must return success on successful save'
    );
  });

  test('handles save errors', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /saveFile.*catch.*error.*success:\s*false/s,
      'must handle save errors and return failure'
    );
  });

});

test.describe('ConfigFilesProvider - Config Directory Access', () => {

  test('has getConfigDirectory method', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /getConfigDirectory\(\).*string/s,
      'must provide getConfigDirectory method'
    );
  });

  test('returns config directory path', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /getConfigDirectory[\s\S]*return\s*this\.configDir/s,
      'must return config directory path'
    );
  });

});

test.describe('ConfigFilesProvider - ConfigFile Interface', () => {

  test('defines ConfigFile interface', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /interface ConfigFile[\s\S]*name.*path.*content.*lastModified.*size/s,
      'must define ConfigFile interface'
    );
  });

  test('ConfigFile includes name property', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /interface ConfigFile[\s\S]*name:\s*string/s,
      'must include name property in ConfigFile'
    );
  });

  test('ConfigFile includes path property', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /interface ConfigFile[\s\S]*path:\s*string/s,
      'must include path property in ConfigFile'
    );
  });

  test('ConfigFile includes content property', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /interface ConfigFile[\s\S]*content:\s*string/s,
      'must include content property in ConfigFile'
    );
  });

  test('ConfigFile includes lastModified property', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /interface ConfigFile[\s\S]*lastModified:\s*number/s,
      'must include lastModified property in ConfigFile'
    );
  });

  test('ConfigFile includes size property', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /interface ConfigFile[\s\S]*size:\s*number/s,
      'must include size property in ConfigFile'
    );
  });

});

test.describe('ConfigFilesProvider - Constants', () => {

  test('defines SKIPPED_FILES constant', () => {
    const source = configFilesSource;

    assert.match(
      source,
      /SKIPPED_FILES\s*=\s*\[.*bun\.lock.*package\.json/s,
      'must define SKIPPED_FILES constant'
    );
  });

});
