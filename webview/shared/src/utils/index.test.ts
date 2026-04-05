import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, getFilename } from './index.ts';

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

describe('formatDuration', () => {
  describe('Milliseconds (< 1s)', () => {
    it('should format milliseconds', () => {
      assert.strictEqual(formatDuration(500), '500ms');
    });

    it('should format single digit milliseconds', () => {
      assert.strictEqual(formatDuration(5), '5ms');
    });

    it('should format sub-millisecond values', () => {
      assert.strictEqual(formatDuration(0.5), '1ms'); // Math.round(0.5) = 1
    });

    it('should format milliseconds just under 1 second', () => {
      assert.strictEqual(formatDuration(999), '999ms');
    });

    it('should round milliseconds to nearest integer', () => {
      assert.strictEqual(formatDuration(1234.6), '1.2s');
    });
  });

  describe('Seconds (1s - 59s)', () => {
    it('should format seconds with decimal', () => {
      assert.strictEqual(formatDuration(1500), '1.5s');
    });

    it('should format whole seconds without decimal', () => {
      assert.strictEqual(formatDuration(3000), '3s');
    });

    it('should format seconds with one decimal place', () => {
      assert.strictEqual(formatDuration(5678), '5.7s');
    });

    it('should format just under 1 minute', () => {
      assert.strictEqual(formatDuration(59_999), '60s');
    });

    it('should handle typical task durations', () => {
      assert.strictEqual(formatDuration(212_800), '3m 32s'); // From the bug report!
    });
  });

  describe('Minutes and seconds (1m - 59m)', () => {
    it('should format 1 minute', () => {
      assert.strictEqual(formatDuration(60_000), '1m');
    });

    it('should format minutes and seconds', () => {
      assert.strictEqual(formatDuration(90_000), '1m 30s');
    });

    it('should format multiple minutes', () => {
      assert.strictEqual(formatDuration(150_000), '2m 30s');
    });

    it('should format just minutes when seconds are zero', () => {
      assert.strictEqual(formatDuration(300_000), '5m');
    });

    it('should format large minute values', () => {
      assert.strictEqual(formatDuration(2_500_000), '41m 40s');
    });

    it('should format just under 1 hour', () => {
      assert.strictEqual(formatDuration(3_599_999), '59m 59s');
    });
  });

  describe('Hours and minutes (≥ 1h)', () => {
    it('should format 1 hour', () => {
      assert.strictEqual(formatDuration(3_600_000), '1h');
    });

    it('should format hours and minutes', () => {
      assert.strictEqual(formatDuration(3_900_000), '1h 5m');
    });

    it('should format multiple hours', () => {
      assert.strictEqual(formatDuration(5_400_000), '1h 30m');
    });

    it('should show seconds only when less than 5 minutes', () => {
      assert.strictEqual(formatDuration(3_605_000), '1h 5s'); // < 5m, shows seconds
    });

    it('should not show seconds when 5 minutes or more', () => {
      assert.strictEqual(formatDuration(3_900_000), '1h 5m'); // >= 5m, no seconds
    });

    it('should format long durations', () => {
      assert.strictEqual(formatDuration(9_000_000), '2h 30m');
    });

    it('should format very long durations', () => {
      assert.strictEqual(formatDuration(36_000_000), '10h');
    });
  });

  describe('Edge cases and invalid values', () => {
    it('should handle zero', () => {
      assert.strictEqual(formatDuration(0), '0ms');
    });

    it('should handle negative numbers', () => {
      assert.strictEqual(formatDuration(-1000), 'n/a');
    });

    it('should handle Infinity', () => {
      assert.strictEqual(formatDuration(Infinity), 'n/a');
    });

    it('should handle -Infinity', () => {
      assert.strictEqual(formatDuration(-Infinity), 'n/a');
    });

    it('should handle NaN', () => {
      assert.strictEqual(formatDuration(NaN), 'n/a');
    });

    it('should handle undefined', () => {
      assert.strictEqual(formatDuration(undefined as any), 'n/a');
    });

    it('should handle null', () => {
      assert.strictEqual(formatDuration(null as any), 'n/a');
    });

    it('should handle non-numeric string', () => {
      assert.strictEqual(formatDuration('invalid' as any), 'n/a');
    });
  });

  describe('Real-world scenarios', () => {
    it('should format quick subagent tasks', () => {
      assert.strictEqual(formatDuration(500), '500ms'); // Very fast
      assert.strictEqual(formatDuration(2_500), '2.5s'); // Quick operation
    });

    it('should format typical coding tasks', () => {
      assert.strictEqual(formatDuration(15_000), '15s'); // File read
      assert.strictEqual(formatDuration(45_000), '45s'); // Quick analysis
      assert.strictEqual(formatDuration(180_000), '3m'); // Code generation
    });

    it('should format longer operations', () => {
      assert.strictEqual(formatDuration(300_000), '5m'); // Medium task
      assert.strictEqual(formatDuration(600_000), '10m'); // Long task
      assert.strictEqual(formatDuration(1_800_000), '30m'); // Extended task
    });

    it('should format very long sessions', () => {
      assert.strictEqual(formatDuration(3_600_000), '1h'); // 1 hour session
      assert.strictEqual(formatDuration(7_200_000), '2h'); // 2 hour session
      assert.strictEqual(formatDuration(14_400_000), '4h'); // Half-day session
    });

    it('should format the exact bug report example', () => {
      // The user's complaint: 212.8s is not understandable
      assert.strictEqual(formatDuration(212_800), '3m 32s');
    });

    it('should format session statistics', () => {
      assert.strictEqual(formatDuration(65_300), '1m 5s'); // ~1 minute
      assert.strictEqual(formatDuration(5_432_000), '1h 30m'); // ~1.5 hours
    });
  });

  describe('Boundary cases', () => {
    it('should handle exactly 1 second', () => {
      assert.strictEqual(formatDuration(1000), '1s');
    });

    it('should handle exactly 1 minute', () => {
      assert.strictEqual(formatDuration(60_000), '1m');
    });

    it('should handle exactly 1 hour', () => {
      assert.strictEqual(formatDuration(3_600_000), '1h');
    });

    it('should handle exactly 5 minutes (seconds cutoff)', () => {
      assert.strictEqual(formatDuration(300_000), '5m'); // Exactly 5m, no seconds
    });

    it('should handle just under 5 minutes (shows seconds)', () => {
      assert.strictEqual(formatDuration(299_999), '4m 59s'); // Just under 5m
    });
  });
});
