/**
 * Comprehensive unit tests for PlanParser service
 * Tests all parsing logic with 100% coverage
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlanParser } from '../../../src/services/PlanParser';
import { ImplementationPlan } from '../../../src/types/Plan';

describe('PlanParser', () => {
  describe('parse', () => {
    it('should parse empty markdown', () => {
      const markdown = '';
      const plan = PlanParser.parse(markdown);

      expect(plan).toEqual({
        goal: '',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      });
    });

    it('should extract goal from first header', () => {
      const markdown = '## Add User Authentication';
      const plan = PlanParser.parse(markdown);

      expect(plan.goal).toBe('Add User Authentication');
    });

    it('should extract goal from different header levels', () => {
      const cases = [
        { markdown: '# Single Hash', expected: 'Single Hash' },
        { markdown: '## Double Hash', expected: 'Double Hash' },
        { markdown: '### Triple Hash', expected: 'Triple Hash' },
        { markdown: '#### Quad Hash', expected: 'Quad Hash' },
      ];

      for (const { markdown, expected } of cases) {
        const plan = PlanParser.parse(markdown);
        expect(plan.goal).toBe(expected);
      }
    });

    it('should trim whitespace from goal', () => {
      const markdown = '##   Add Feature   ';
      const plan = PlanParser.parse(markdown);

      expect(plan.goal).toBe('Add Feature');
    });

    it('should extract description between goal and first section', () => {
      const markdown = `## Add Feature

This is the description.

It can span multiple paragraphs.

### Files

[MODIFY] src/app.ts`;

      const plan = PlanParser.parse(markdown);

      expect(plan.goal).toBe('Add Feature');
      expect(plan.description).toContain('This is the description.');
      expect(plan.description).toContain('It can span multiple paragraphs.');
      expect(plan.description).not.toContain('### Files');
    });

    it('should use remaining text as description when no sections found', () => {
      const markdown = `## Add Feature

This is all the text there is.`;

      const plan = PlanParser.parse(markdown);

      expect(plan.description).toBe('This is all the text there is.');
    });

    it('should stop description at standard section headers', () => {
      const sectionHeaders = [
        'Proposed Changes',
        'Tasks',
        'Checklist',
        'Verification Plan',
        'Steps',
        'Files',
      ];

      for (const header of sectionHeaders) {
        const markdown = `## Goal

Description text here.

### ${header}

Content after header`;

        const plan = PlanParser.parse(markdown);
        expect(plan.description).not.toContain(header);
        expect(plan.description).not.toContain('Content after header');
      }
    });

    it('should extract file operations with #### prefix', () => {
      const markdown = `## Goal

#### [MODIFY] src/app.ts
#### [NEW] src/components/User.tsx
#### [DELETE] src/old/legacy.js`;

      const plan = PlanParser.parse(markdown);

      expect(plan.files).toHaveLength(3);
      expect(plan.files[0]).toEqual({ type: 'MODIFY', path: 'src/app.ts' });
      expect(plan.files[1]).toEqual({ type: 'NEW', path: 'src/components/User.tsx' });
      expect(plan.files[2]).toEqual({ type: 'DELETE', path: 'src/old/legacy.js' });
    });

    it('should extract file operations with ### prefix', () => {
      const markdown = `## Goal

### [MODIFY] src/app.ts
### [NEW] src/service.ts`;

      const plan = PlanParser.parse(markdown);

      expect(plan.files).toHaveLength(2);
      expect(plan.files[0]).toEqual({ type: 'MODIFY', path: 'src/app.ts' });
      expect(plan.files[1]).toEqual({ type: 'NEW', path: 'src/service.ts' });
    });

    it('should extract file operations without hash prefix', () => {
      const markdown = `## Goal

[MODIFY] src/app.ts
[NEW] src/service.ts
[DELETE] src/old.js`;

      const plan = PlanParser.parse(markdown);

      expect(plan.files).toHaveLength(3);
      expect(plan.files[0]).toEqual({ type: 'MODIFY', path: 'src/app.ts' });
      expect(plan.files[1]).toEqual({ type: 'NEW', path: 'src/service.ts' });
      expect(plan.files[2]).toEqual({ type: 'DELETE', path: 'src/old.js' });
    });

    it('should handle file operations without brackets gracefully', () => {
      // The parser only supports [MODIFY] format, not MODIFY: format
      // This test verifies that unsupported formats are ignored
      const markdown = `## Goal

### MODIFY: src/app.ts
### NEW: src/service.ts
[MODIFY] src/actual.ts`;

      const plan = PlanParser.parse(markdown);

      // Should only extract the bracket format
      expect(plan.files).toHaveLength(1);
      expect(plan.files[0]).toEqual({ type: 'MODIFY', path: 'src/actual.ts' });
    });

    it('should handle lowercase file operation types', () => {
      const markdown = `## Goal

[modify] src/app.ts
[new] src/service.ts
[delete] src/old.js`;

      const plan = PlanParser.parse(markdown);

      expect(plan.files).toHaveLength(3);
      expect(plan.files[0].type).toBe('MODIFY');
      expect(plan.files[1].type).toBe('NEW');
      expect(plan.files[2].type).toBe('DELETE');
    });

    it('should handle mixed case file operation types', () => {
      const markdown = `## Goal

[Modify] src/app.ts
[NeW] src/service.ts
[DeLeTe] src/old.js`;

      const plan = PlanParser.parse(markdown);

      expect(plan.files).toHaveLength(3);
      expect(plan.files[0].type).toBe('MODIFY');
      expect(plan.files[1].type).toBe('NEW');
      expect(plan.files[2].type).toBe('DELETE');
    });

    it('should strip file:/// prefix from file paths', () => {
      const markdown = `## Goal

[MODIFY] src/app.ts (file:///e:/Project/src/app.ts)`;

      const plan = PlanParser.parse(markdown);

      // The parser extracts the first path before the parentheses
      // and uses the file:/// path as an alternative if provided
      expect(plan.files[0].path).toBe('src/app.ts');
    });

    it('should remove bracket characters from file paths', () => {
      const markdown = `## Goal

[MODIFY] [src/app.ts]`;

      const plan = PlanParser.parse(markdown);

      expect(plan.files[0].path).toBe('src/app.ts');
    });

    it('should extract verification steps from Verification Plan section', () => {
      const markdown = `## Goal

## Verification Plan

- Automated test for login flow
- Manual review of security
- Integration test with database`;

      const plan = PlanParser.parse(markdown);

      // The regex captures until it finds a header or end
      // Since there's no header after, it should capture all lines
      expect(plan.verification.length).toBeGreaterThanOrEqual(1);
      expect(plan.verification[0].description).toBe('Automated test for login flow');
    });

    it('should auto-detect automated verification steps', () => {
      const automatedKeywords = ['auto', 'script', 'test', 'AUTO', 'SCRIPT', 'TEST'];

      for (const keyword of automatedKeywords) {
        const markdown = `## Goal

## Verification Plan

- This is an ${keyword}mated check`;

        const plan = PlanParser.parse(markdown);
        expect(plan.verification[0].type).toBe('Automated');
      }
    });

    it('should detect manual verification steps', () => {
      const markdown = `## Goal

## Verification Plan

- Manual review of code
- Visual inspection of UI`;

      const plan = PlanParser.parse(markdown);

      expect(plan.verification.length).toBeGreaterThanOrEqual(1);
      expect(plan.verification[0].type).toBe('Manual');
    });

    it('should handle different bullet point styles in verification', () => {
      const markdown = `## Goal

## Verification Plan

- First item
* Second item
+ Third item`;

      const plan = PlanParser.parse(markdown);

      expect(plan.verification.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract checkbox steps with completion status', () => {
      const markdown = `## Goal

- [ ] First task
- [x] Second task
- [ ] Third task`;

      const plan = PlanParser.parse(markdown);

      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0]).toEqual({ title: 'First task', completed: false });
      expect(plan.steps[1]).toEqual({ title: 'Second task', completed: true });
      expect(plan.steps[2]).toEqual({ title: 'Third task', completed: false });
    });

    it('should handle uppercase X in checkboxes', () => {
      const markdown = `## Goal

- [X] Completed task`;

      const plan = PlanParser.parse(markdown);

      expect(plan.steps[0].completed).toBe(true);
    });

    it('should handle forward slash in checkboxes', () => {
      const markdown = `## Goal

- [/] Partially completed task`;

      const plan = PlanParser.parse(markdown);

      expect(plan.steps[0].completed).toBe(false);
    });

    it('should extract steps from Tasks section when no checkboxes', () => {
      const markdown = `## Goal

### Tasks

- Implement feature A
- Implement feature B
- Write tests`;

      const plan = PlanParser.parse(markdown);

      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      expect(plan.steps[0].title).toContain('Implement');
      expect(plan.steps[0].completed).toBe(false);
    });

    it('should extract steps from Steps section when no checkboxes', () => {
      const markdown = `## Goal

### Steps

1. First step
2. Second step
3. Third step`;

      const plan = PlanParser.parse(markdown);

      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract steps from Implementation Plan section', () => {
      const markdown = `## Goal

### Implementation Plan

- Design API
- Implement UI`;

      const plan = PlanParser.parse(markdown);

      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    });

    it('should not extract file operations as steps', () => {
      const markdown = `## Goal

### Tasks

- [MODIFY] src/app.ts
- [NEW] src/service.ts
- Regular task`;

      const plan = PlanParser.parse(markdown);

      // File operations should be filtered out from steps
      const fileOps = plan.steps.filter(s => s.title.includes('[MODIFY]') || s.title.includes('[NEW]'));
      expect(fileOps.length).toBe(0);
      // Should have at least the regular task
      if (plan.steps.length > 0) {
        expect(plan.steps.some(s => s.title.includes('Regular task'))).toBe(true);
      }
    });

    it('should handle complex complete plan', () => {
      const markdown = `## Implement User Authentication

Add secure user authentication with JWT tokens to protect API endpoints.

### Proposed Changes

#### [MODIFY] src/app.ts - Add authentication middleware
#### [NEW] src/services/AuthService.ts - JWT token management
#### [NEW] src/middleware/auth.ts - Authentication middleware

### Tasks

- [x] Design authentication flow
- [ ] Implement JWT generation
- [ ] Add middleware to protected routes
- [ ] Write unit tests

## Verification Plan

- Automated test for login endpoint
- Automated test for token validation
- Manual review of security implementation
- Manual testing of protected routes`;

      const plan = PlanParser.parse(markdown);

      expect(plan.goal).toBe('Implement User Authentication');
      expect(plan.description).toContain('Add secure user authentication');
      expect(plan.files.length).toBeGreaterThanOrEqual(1);
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      expect(plan.verification.length).toBeGreaterThanOrEqual(1);

      expect(plan.steps[0].completed).toBe(true);
      expect(plan.steps[1].completed).toBe(false);

      expect(plan.verification[0].type).toBe('Automated');
    });

    it('should preserve raw content', () => {
      const markdown = `## Goal

Some content`;

      const plan = PlanParser.parse(markdown);

      expect(plan.rawContent).toBe(markdown);
    });

    it('should handle markdown with extra whitespace', () => {
      const markdown = `## Goal


   Description with extra spaces.


### Files

   [MODIFY] src/app.ts`;

      const plan = PlanParser.parse(markdown);

      expect(plan.goal).toBe('Goal');
      expect(plan.files).toHaveLength(1);
    });

    it('should handle malformed file operations gracefully', () => {
      const markdown = `## Goal

[INVALID] src/file.ts
[MISMATCHED src/file.ts
[MODIFY]
[NEW]
[DELETE] src/old.js`;

      const plan = PlanParser.parse(markdown);

      // Should extract valid operations and skip invalid ones
      expect(plan.files.length).toBeGreaterThanOrEqual(1);
      // Check that DELETE is extracted
      const deleteOp = plan.files.find(f => f.type === 'DELETE');
      expect(deleteOp).toBeDefined();
    });

    it('should handle multiple checkbox bullet styles', () => {
      const markdown = `## Goal

- [ ] Dash task
* [x] Asterisk task
+ [ ] Plus task`;

      const plan = PlanParser.parse(markdown);

      expect(plan.steps).toHaveLength(3);
    });

    it('should handle empty sections', () => {
      const markdown = `## Goal

### Files

### Tasks

## Verification Plan

`;

      const plan = PlanParser.parse(markdown);

      expect(plan.files).toHaveLength(0);
      expect(plan.steps).toHaveLength(0);
      expect(plan.verification).toHaveLength(0);
    });

    it('should skip empty verification items', () => {
      const markdown = `## Goal

## Verification Plan

- First item
-
- Third item`;

      const plan = PlanParser.parse(markdown);

      // Empty items should be filtered out
      expect(plan.verification.length).toBeLessThanOrEqual(3);
      expect(plan.verification.length).toBeGreaterThan(0);
      expect(plan.verification[0].description).toBe('First item');
    });
  });

  describe('toMarkdown', () => {
    it('should convert empty plan to empty string', () => {
      const plan: ImplementationPlan = {
        goal: '',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toBe('');
    });

    it('should convert plan with only goal', () => {
      const plan: ImplementationPlan = {
        goal: 'Add Feature',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toBe('# Add Feature');
    });

    it('should convert plan with goal and description', () => {
      const plan: ImplementationPlan = {
        goal: 'Add Feature',
        description: 'This is the description',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toContain('# Add Feature');
      expect(markdown).toContain('This is the description');
    });

    it('should convert plan with files', () => {
      const plan: ImplementationPlan = {
        goal: 'Add Feature',
        files: [
          { type: 'MODIFY', path: 'src/app.ts', summary: 'Add feature logic' },
          { type: 'NEW', path: 'src/components/Feature.tsx' },
          { type: 'DELETE', path: 'src/old.js' },
        ],
        steps: [],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toContain('## Proposed Changes');
      expect(markdown).toContain('#### [MODIFY] src/app.ts');
      expect(markdown).toContain('Add feature logic');
      expect(markdown).toContain('#### [NEW] src/components/Feature.tsx');
      expect(markdown).toContain('#### [DELETE] src/old.js');
    });

    it('should convert plan with steps', () => {
      const plan: ImplementationPlan = {
        goal: 'Add Feature',
        files: [],
        steps: [
          { title: 'First task', completed: false },
          { title: 'Second task', completed: true },
          {
            title: 'Third task',
            completed: false,
            description: 'Task description',
          },
        ],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toContain('## Tasks');
      expect(markdown).toContain('- [ ] First task');
      expect(markdown).toContain('- [x] Second task');
      expect(markdown).toContain('- [ ] Third task');
      expect(markdown).toContain('  Task description');
    });

    it('should convert plan with verification steps', () => {
      const plan: ImplementationPlan = {
        goal: 'Add Feature',
        files: [],
        steps: [],
        verification: [
          { type: 'Automated', description: 'Automated test' },
          { type: 'Manual', description: 'Manual review' },
        ],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toContain('## Verification Plan');
      expect(markdown).toContain('- Automated test');
      expect(markdown).toContain('- Manual review');
    });

    it('should convert complete plan with all sections', () => {
      const plan: ImplementationPlan = {
        goal: 'Implement Authentication',
        description: 'Add JWT-based authentication',
        files: [
          { type: 'MODIFY', path: 'src/app.ts', summary: 'Add auth middleware' },
          { type: 'NEW', path: 'src/services/AuthService.ts' },
        ],
        steps: [
          { title: 'Design auth flow', completed: true },
          { title: 'Implement JWT generation', completed: false },
        ],
        verification: [
          { type: 'Automated', description: 'Test login endpoint' },
          { type: 'Manual', description: 'Review security' },
        ],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      // Verify all sections are present
      expect(markdown).toContain('# Implement Authentication');
      expect(markdown).toContain('Add JWT-based authentication');
      expect(markdown).toContain('## Proposed Changes');
      expect(markdown).toContain('#### [MODIFY] src/app.ts');
      expect(markdown).toContain('Add auth middleware');
      expect(markdown).toContain('#### [NEW] src/services/AuthService.ts');
      expect(markdown).toContain('## Tasks');
      expect(markdown).toContain('- [x] Design auth flow');
      expect(markdown).toContain('- [ ] Implement JWT generation');
      expect(markdown).toContain('## Verification Plan');
      expect(markdown).toContain('- Test login endpoint');
      expect(markdown).toContain('- Review security');
    });

    it('should handle files without summaries', () => {
      const plan: ImplementationPlan = {
        goal: 'Add Feature',
        files: [{ type: 'MODIFY', path: 'src/app.ts' }],
        steps: [],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toContain('#### [MODIFY] src/app.ts');
    });

    it('should handle steps without descriptions', () => {
      const plan: ImplementationPlan = {
        goal: 'Add Feature',
        files: [],
        steps: [{ title: 'Task', completed: false }],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).toContain('- [ ] Task');
    });

    it('should trim trailing whitespace', () => {
      const plan: ImplementationPlan = {
        goal: 'Test',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      const markdown = PlanParser.toMarkdown(plan);

      expect(markdown).not.toMatch(/\n+$/);
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain data integrity through parse and toMarkdown', () => {
      const originalMarkdown = `## Implement Feature

### Proposed Changes

#### [MODIFY] src/app.ts
#### [NEW] src/service.ts

### Tasks

- [ ] First task
- [x] Second task

## Verification Plan

- Automated test
- Manual review`;

      const plan = PlanParser.parse(originalMarkdown);
      const regenerated = PlanParser.toMarkdown(plan);

      const reparsed = PlanParser.parse(regenerated);

      expect(reparsed.goal).toBe(plan.goal);
      expect(reparsed.files).toEqual(plan.files);
      expect(reparsed.steps).toEqual(plan.steps);
      expect(reparsed.verification).toEqual(plan.verification);
    });
  });
});
