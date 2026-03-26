import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ConfigFilesProvider', () => {
  let testConfigDir;
  let provider;

  before(async () => {
    // Create a temporary test config directory
    testConfigDir = path.join(os.tmpdir(), `opencode-test-${Date.now()}`);
    await fs.mkdir(testConfigDir, { recursive: true });

    // Create test JSON files
    await fs.writeFile(
      path.join(testConfigDir, 'config1.json'),
      JSON.stringify({ key: 'value1' }, null, 2)
    );
    await fs.writeFile(
      path.join(testConfigDir, 'config2.jsonc'),
      JSON.stringify({ key: 'value2' }, null, 2) + ' // comment'
    );
    await fs.writeFile(
      path.join(testConfigDir, 'settings.json'),
      JSON.stringify({ setting: true }, null, 2)
    );

    // Create files that should be filtered out
    await fs.writeFile(
      path.join(testConfigDir, 'backup.json.bak'),
      JSON.stringify({ backup: true }, null, 2)
    );
    await fs.writeFile(
      path.join(testConfigDir, 'bun.lock'),
      '{}'
    );
    await fs.writeFile(
      path.join(testConfigDir, 'package.json'),
      JSON.stringify({ name: 'test' }, null, 2)
    );

    // Create a subdirectory (should be ignored)
    await fs.mkdir(path.join(testConfigDir, 'node_modules'), { recursive: true });
    await fs.writeFile(
      path.join(testConfigDir, 'node_modules', 'nested.json'),
      JSON.stringify({ nested: true }, null, 2)
    );
  });

  after(async () => {
    // Clean up test directory
    try {
      await fs.rm(testConfigDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should scan directory and return JSON/JSONC files', async () => {
    // Import the class - we need to use dynamic import since it's TypeScript
    // For now, we'll test the concept
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    provider = new ConfigFilesProvider(testConfigDir);
    const files = await provider.scanFiles();

    assert.ok(Array.isArray(files));
    assert.ok(files.length > 0);
    assert.ok(files[0].name);
    assert.ok(files[0].path);
    assert.ok(files[0].content);
  });

  it('should filter out node_modules and .bak files', async () => {
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    provider = new ConfigFilesProvider(testConfigDir);
    const files = await provider.scanFiles();

    assert.ok(!files.some(f => f.path.includes('node_modules')));
    assert.ok(!files.some(f => f.name.endsWith('.bak')));
    assert.ok(!files.some(f => f.name === 'bun.lock'));
    assert.ok(!files.some(f => f.name === 'package.json'));
  });

  it('should sort files alphabetically', async () => {
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    provider = new ConfigFilesProvider(testConfigDir);
    const files = await provider.scanFiles();

    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    assert.deepStrictEqual(files, sorted);
  });

  it('should include file metadata', async () => {
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    provider = new ConfigFilesProvider(testConfigDir);
    const files = await provider.scanFiles();

    assert.ok(files.length > 0);
    const file = files[0];
    assert.ok(typeof file.lastModified === 'number');
    assert.ok(typeof file.size === 'number');
    assert.ok(file.lastModified > 0);
    assert.ok(file.size > 0);
  });

  it('should save file with backup', async () => {
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    provider = new ConfigFilesProvider(testConfigDir);

    const testFile = path.join(testConfigDir, 'config1.json');
    const newContent = JSON.stringify({ key: 'updated' }, null, 2);

    const result = await provider.saveFile(testFile, newContent);

    assert.ok(result.success);
    assert.ok(!result.error);

    // Verify backup was created
    const backupFiles = (await fs.readdir(testConfigDir))
      .filter(f => f.startsWith('config1.json.bak.'));

    assert.ok(backupFiles.length > 0, 'Backup file should be created');

    // Verify file content was updated
    const updatedContent = await fs.readFile(testFile, 'utf-8');
    assert.strictEqual(updatedContent, newContent);
  });

  it('should validate JSON before saving', async () => {
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    provider = new ConfigFilesProvider(testConfigDir);

    const testFile = path.join(testConfigDir, 'config1.json');
    const invalidJson = '{ invalid json }';

    const result = await provider.saveFile(testFile, invalidJson);

    assert.ok(!result.success);
    assert.ok(result.error);
    assert.ok(result.error.includes('JSON'));
  });

  it('should return config directory', async () => {
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    const customProvider = new ConfigFilesProvider(testConfigDir);

    assert.strictEqual(customProvider.getConfigDirectory(), testConfigDir);
  });

  it('should use default config directory when none provided', async () => {
    const { ConfigFilesProvider } = await import('../src/providers/ConfigFilesProvider.ts');
    const defaultProvider = new ConfigFilesProvider();

    const expectedDir = path.join(os.homedir(), '.config', 'opencode');
    assert.strictEqual(defaultProvider.getConfigDirectory(), expectedDir);
  });
});
