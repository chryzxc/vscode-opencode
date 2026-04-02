import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getFilename } from './index';

describe('getFilename', () => {
  describe('Unix-style paths', () => {
    it('should extract filename from absolute Unix path', () => {
      assert.strictEqual(getFilename('/path/to/file.md'), 'file.md');
    });

    it('should extract filename from relative Unix path', () => {
      assert.strictEqual(getFilename('./relative/path.ts'), 'path.ts');
    });

    it('should extract filename from nested Unix path', () => {
      assert.strictEqual(getFilename('.sisyphus/plans/todo-feature.md'), 'todo-feature.md');
    });

    it('should extract filename from deeply nested Unix path', () => {
      assert.strictEqual(getFilename('/a/b/c/d/e/f/file.txt'), 'file.txt');
    });

    it('should handle Unix path with multiple slashes', () => {
      assert.strictEqual(getFilename('/path/to//file.md'), 'file.md');
    });
  });

  describe('Windows-style paths', () => {
    it('should extract filename from absolute Windows path', () => {
      assert.strictEqual(getFilename('C:\\Users\\Name\\file.txt'), 'file.txt');
    });

    it('should extract filename from relative Windows path', () => {
      assert.strictEqual(getFilename('.\\relative\\path.ts'), 'path.ts');
    });

    it('should extract filename from nested Windows path', () => {
      assert.strictEqual(getFilename('E:\\Projects\\jobhaven\\.sisyphus\\plans\\todo-feature.md'), 'todo-feature.md');
    });

    it('should extract filename from deeply nested Windows path', () => {
      assert.strictEqual(getFilename('C:\\a\\b\\c\\d\\e\\f\\file.txt'), 'file.txt');
    });

    it('should handle Windows path with UNC-style', () => {
      assert.strictEqual(getFilename('\\\\server\\share\\file.md'), 'file.md');
    });
  });

  describe('Edge cases', () => {
    it('should handle simple filename without path', () => {
      assert.strictEqual(getFilename('PLAN.md'), 'PLAN.md');
    });

    it('should handle filename with extension', () => {
      assert.strictEqual(getFilename('todo-feature.md'), 'todo-feature.md');
    });

    it('should handle filename without extension', () => {
      assert.strictEqual(getFilename('Makefile'), 'Makefile');
    });

    it('should handle filename with multiple dots', () => {
      assert.strictEqual(getFilename('file.name.with.dots.txt'), 'file.name.with.dots.txt');
    });

    it('should handle empty string', () => {
      assert.strictEqual(getFilename(''), '');
    });

    it('should handle single directory separator', () => {
      assert.strictEqual(getFilename('/'), '');
    });

    it('should handle path ending with separator', () => {
      assert.strictEqual(getFilename('/path/to/dir/'), '');
    });
  });

  describe('Mixed/edge path formats', () => {
    it('should handle path with mixed separators (Unix)', () => {
      assert.strictEqual(getFilename('/path/to\\file.txt'), 'file.txt');
    });

    it('should handle path with mixed separators (Windows)', () => {
      assert.strictEqual(getFilename('C:\\path/to/file.txt'), 'file.txt');
    });

    it('should handle relative path with parent directory references', () => {
      assert.strictEqual(getFilename('../path/to/file.ts'), 'file.ts');
    });

    it('should handle path with trailing spaces', () => {
      assert.strictEqual(getFilename('/path/to/file.md  '), 'file.md  ');
    });

    it('should preserve special characters in filename', () => {
      assert.strictEqual(getFilename('/path/to/file-name_v2.0.txt'), 'file-name_v2.0.txt');
    });
  });

  describe('Real-world examples', () => {
    it('should handle VSCode extension plan paths', () => {
      assert.strictEqual(
        getFilename('.sisyphus/plans/todo-feature.md'),
        'todo-feature.md'
      );
    });

    it('should handle Windows workspace plan paths', () => {
      assert.strictEqual(
        getFilename('E:\\Projects\\jobhaven\\.sisyphus\\plans\\auth-refactor.md'),
        'auth-refactor.md'
      );
    });

    it('should handle Unix workspace plan paths', () => {
      assert.strictEqual(
        getFilename('/workspace/project/plans/api-redesign.md'),
        'api-redesign.md'
      );
    });

    it('should handle TypeScript file paths', () => {
      assert.strictEqual(
        getFilename('/src/components/Button.tsx'),
        'Button.tsx'
      );
    });

    it('should handle configuration file paths', () => {
      assert.strictEqual(
        getFilename('/config/settings.json'),
        'settings.json'
      );
    });
  });
});
