/**
 * Comprehensive unit tests for Plan types
 * 100% coverage - tests all interfaces and type definitions
 */

import { describe, it, expect } from 'vitest';

// Import types from Plan.ts
import type {
  PlanFile,
  PlanStep,
  VerificationStep,
  ImplementationPlan,
} from '../../../src/types/Plan';

describe('Plan Types', () => {
  describe('PlanFile', () => {
    it('should accept valid PlanFile with all fields', () => {
      const planFile: PlanFile = {
        path: '/path/to/file.ts',
        type: 'MODIFY',
        summary: 'Update the file',
      };

      expect(planFile.path).toBe('/path/to/file.ts');
      expect(planFile.type).toBe('MODIFY');
      expect(planFile.summary).toBe('Update the file');
    });

    it('should accept PlanFile with minimal fields', () => {
      const planFile: PlanFile = {
        path: '/path/to/file.ts',
        type: 'NEW',
      };

      expect(planFile.path).toBe('/path/to/file.ts');
      expect(planFile.type).toBe('NEW');
      expect(planFile.summary).toBeUndefined();
    });

    it('should accept all valid type values', () => {
      const modifyFile: PlanFile = { path: 'a.ts', type: 'MODIFY' };
      const newFile: PlanFile = { path: 'b.ts', type: 'NEW' };
      const deleteFile: PlanFile = { path: 'c.ts', type: 'DELETE' };

      expect(modifyFile.type).toBe('MODIFY');
      expect(newFile.type).toBe('NEW');
      expect(deleteFile.type).toBe('DELETE');
    });

    it('should allow optional summary field', () => {
      const withSummary: PlanFile = {
        path: 'file.ts',
        type: 'MODIFY',
        summary: 'This is a summary',
      };

      const withoutSummary: PlanFile = {
        path: 'file.ts',
        type: 'MODIFY',
      };

      expect(withSummary.summary).toBeDefined();
      expect(withoutSummary.summary).toBeUndefined();
    });

    it('should accept empty string path', () => {
      const planFile: PlanFile = {
        path: '',
        type: 'NEW',
      };

      expect(planFile.path).toBe('');
    });

    it('should accept paths with special characters', () => {
      const planFile: PlanFile = {
        path: '/path/to/file with spaces.ts',
        type: 'MODIFY',
      };

      expect(planFile.path).toContain(' ');
    });
  });

  describe('PlanStep', () => {
    it('should accept valid PlanStep with all fields', () => {
      const planStep: PlanStep = {
        title: 'Implement feature',
        description: 'Add the new functionality',
        completed: false,
      };

      expect(planStep.title).toBe('Implement feature');
      expect(planStep.description).toBe('Add the new functionality');
      expect(planStep.completed).toBe(false);
    });

    it('should accept PlanStep with minimal fields', () => {
      const planStep: PlanStep = {
        title: 'Implement feature',
        completed: true,
      };

      expect(planStep.title).toBe('Implement feature');
      expect(planStep.completed).toBe(true);
      expect(planStep.description).toBeUndefined();
    });

    it('should accept completed as true', () => {
      const planStep: PlanStep = {
        title: 'Done task',
        completed: true,
      };

      expect(planStep.completed).toBe(true);
    });

    it('should accept completed as false', () => {
      const planStep: PlanStep = {
        title: 'Pending task',
        completed: false,
      };

      expect(planStep.completed).toBe(false);
    });

    it('should allow optional description field', () => {
      const withDescription: PlanStep = {
        title: 'Task',
        description: 'Detailed description',
        completed: false,
      };

      const withoutDescription: PlanStep = {
        title: 'Task',
        completed: false,
      };

      expect(withDescription.description).toBeDefined();
      expect(withoutDescription.description).toBeUndefined();
    });

    it('should accept empty string title', () => {
      const planStep: PlanStep = {
        title: '',
        completed: false,
      };

      expect(planStep.title).toBe('');
    });

    it('should accept multi-line description', () => {
      const planStep: PlanStep = {
        title: 'Task',
        description: 'Line 1\nLine 2\nLine 3',
        completed: false,
      };

      expect(planStep.description).toContain('\n');
    });
  });

  describe('VerificationStep', () => {
    it('should accept valid Automated VerificationStep', () => {
      const verificationStep: VerificationStep = {
        type: 'Automated',
        description: 'Run unit tests',
      };

      expect(verificationStep.type).toBe('Automated');
      expect(verificationStep.description).toBe('Run unit tests');
    });

    it('should accept valid Manual VerificationStep', () => {
      const verificationStep: VerificationStep = {
        type: 'Manual',
        description: 'Manual testing required',
      };

      expect(verificationStep.type).toBe('Manual');
      expect(verificationStep.description).toBe('Manual testing required');
    });

    it('should accept all valid type values', () => {
      const automated: VerificationStep = { type: 'Automated', description: 'Test' };
      const manual: VerificationStep = { type: 'Manual', description: 'Test' };

      expect(automated.type).toBe('Automated');
      expect(manual.type).toBe('Manual');
    });

    it('should accept empty string description', () => {
      const verificationStep: VerificationStep = {
        type: 'Automated',
        description: '',
      };

      expect(verificationStep.description).toBe('');
    });
  });

  describe('ImplementationPlan', () => {
    it('should accept valid ImplementationPlan with all fields', () => {
      const implementationPlan: ImplementationPlan = {
        goal: 'Implement new feature',
        description: 'Add a new feature to the application',
        files: [
          { path: 'file1.ts', type: 'NEW', summary: 'Create new file' },
          { path: 'file2.ts', type: 'MODIFY', summary: 'Update existing file' },
        ],
        steps: [
          { title: 'Step 1', description: 'First step', completed: false },
          { title: 'Step 2', description: 'Second step', completed: false },
        ],
        verification: [
          { type: 'Automated', description: 'Run tests' },
          { type: 'Manual', description: 'Manual verification' },
        ],
        rawContent: 'Raw plan content',
      };

      expect(implementationPlan.goal).toBe('Implement new feature');
      expect(implementationPlan.description).toBe('Add a new feature to the application');
      expect(implementationPlan.files).toHaveLength(2);
      expect(implementationPlan.steps).toHaveLength(2);
      expect(implementationPlan.verification).toHaveLength(2);
      expect(implementationPlan.rawContent).toBe('Raw plan content');
    });

    it('should accept ImplementationPlan with minimal fields', () => {
      const implementationPlan: ImplementationPlan = {
        goal: 'Simple goal',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(implementationPlan.goal).toBe('Simple goal');
      expect(implementationPlan.description).toBeUndefined();
      expect(implementationPlan.files).toHaveLength(0);
      expect(implementationPlan.steps).toHaveLength(0);
      expect(implementationPlan.verification).toHaveLength(0);
      expect(implementationPlan.rawContent).toBe('');
    });

    it('should allow optional description field', () => {
      const withDescription: ImplementationPlan = {
        goal: 'Goal',
        description: 'Detailed description',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      const withoutDescription: ImplementationPlan = {
        goal: 'Goal',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(withDescription.description).toBeDefined();
      expect(withoutDescription.description).toBeUndefined();
    });

    it('should accept empty arrays', () => {
      const implementationPlan: ImplementationPlan = {
        goal: 'Goal',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(implementationPlan.files).toEqual([]);
      expect(implementationPlan.steps).toEqual([]);
      expect(implementationPlan.verification).toEqual([]);
    });

    it('should accept arrays with multiple items', () => {
      const implementationPlan: ImplementationPlan = {
        goal: 'Goal',
        files: [
          { path: 'a.ts', type: 'NEW' },
          { path: 'b.ts', type: 'MODIFY' },
          { path: 'c.ts', type: 'DELETE' },
        ],
        steps: [
          { title: 'Step 1', completed: false },
          { title: 'Step 2', completed: true },
          { title: 'Step 3', completed: false },
        ],
        verification: [
          { type: 'Automated', description: 'Test 1' },
          { type: 'Manual', description: 'Test 2' },
        ],
        rawContent: 'Content',
      };

      expect(implementationPlan.files).toHaveLength(3);
      expect(implementationPlan.steps).toHaveLength(3);
      expect(implementationPlan.verification).toHaveLength(2);
    });

    it('should accept empty string for rawContent', () => {
      const implementationPlan: ImplementationPlan = {
        goal: 'Goal',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(implementationPlan.rawContent).toBe('');
    });

    it('should accept multi-line rawContent', () => {
      const implementationPlan: ImplementationPlan = {
        goal: 'Goal',
        files: [],
        steps: [],
        verification: [],
        rawContent: 'Line 1\nLine 2\nLine 3',
      };

      expect(implementationPlan.rawContent).toContain('\n');
    });

    it('should accept complex nested structures', () => {
      const implementationPlan: ImplementationPlan = {
        goal: 'Complex goal',
        description: 'Complex description\nWith multiple\nLines',
        files: [
          {
            path: '/complex/path/to/file.ts',
            type: 'MODIFY',
            summary: 'Complex summary with details',
          },
        ],
        steps: [
          {
            title: 'Complex step title',
            description: 'Complex step description\nWith details',
            completed: false,
          },
        ],
        verification: [
          {
            type: 'Automated',
            description: 'Complex verification description',
          },
        ],
        rawContent: 'Complex\nmulti-line\nraw content',
      };

      expect(implementationPlan.goal).toBe('Complex goal');
      expect(implementationPlan.files[0].path).toContain('/');
      expect(implementationPlan.verification[0].type).toBe('Automated');
    });
  });

  describe('Type Compatibility', () => {
    it('should allow assignment of compatible types', () => {
      const planFile: PlanFile = {
        path: 'test.ts',
        type: 'MODIFY',
      };

      const files: PlanFile[] = [planFile];
      expect(files).toHaveLength(1);
      expect(files[0]).toEqual(planFile);
    });

    it('should allow assignment of ImplementationPlan', () => {
      const plan: ImplementationPlan = {
        goal: 'Test goal',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(plan).toBeDefined();
      expect(plan.goal).toBe('Test goal');
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should handle PlanFile with very long path', () => {
      const longPath = 'a'.repeat(1000);
      const planFile: PlanFile = {
        path: longPath,
        type: 'NEW',
      };

      expect(planFile.path.length).toBe(1000);
    });

    it('should handle PlanStep with very long title', () => {
      const longTitle = 'a'.repeat(1000);
      const planStep: PlanStep = {
        title: longTitle,
        completed: false,
      };

      expect(planStep.title.length).toBe(1000);
    });

    it('should handle VerificationStep with very long description', () => {
      const longDescription = 'a'.repeat(1000);
      const verificationStep: VerificationStep = {
        type: 'Automated',
        description: longDescription,
      };

      expect(verificationStep.description.length).toBe(1000);
    });

    it('should handle ImplementationPlan with many files', () => {
      const files: PlanFile[] = Array.from({ length: 100 }, (_, i) => ({
        path: `file${i}.ts`,
        type: 'NEW' as const,
      }));

      const plan: ImplementationPlan = {
        goal: 'Goal',
        files,
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(plan.files).toHaveLength(100);
    });

    it('should handle ImplementationPlan with many steps', () => {
      const steps: PlanStep[] = Array.from({ length: 100 }, (_, i) => ({
        title: `Step ${i}`,
        completed: false,
      }));

      const plan: ImplementationPlan = {
        goal: 'Goal',
        files: [],
        steps,
        verification: [],
        rawContent: '',
      };

      expect(plan.steps).toHaveLength(100);
    });

    it('should handle ImplementationPlan with many verification steps', () => {
      const verification: VerificationStep[] = Array.from({ length: 50 }, (_, i) => ({
        type: i % 2 === 0 ? 'Automated' : 'Manual',
        description: `Verification ${i}`,
      }));

      const plan: ImplementationPlan = {
        goal: 'Goal',
        files: [],
        steps: [],
        verification,
        rawContent: '',
      };

      expect(plan.verification).toHaveLength(50);
    });

    it('should handle special characters in strings', () => {
      const planFile: PlanFile = {
        path: '/path/to/file with spaces & special-chars_123.ts',
        type: 'MODIFY',
      };

      expect(planFile.path).toContain(' ');
      expect(planFile.path).toContain('&');
      expect(planFile.path).toContain('-');
    });

    it('should handle unicode characters', () => {
      const planStep: PlanStep = {
        title: 'Title with emoji 🎉 and unicode 中文',
        description: 'Description with symbols ©®™',
        completed: false,
      };

      expect(planStep.title).toContain('🎉');
      expect(planStep.title).toContain('中文');
      expect(planStep.description).toContain('©');
    });

    it('should handle null-like values (empty strings)', () => {
      const plan: ImplementationPlan = {
        goal: '',
        description: '',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(plan.goal).toBe('');
      expect(plan.description).toBe('');
      expect(plan.rawContent).toBe('');
    });
  });

  describe('Type Guards and Checks', () => {
    it('should distinguish between file types', () => {
      const modifyFile: PlanFile = { path: 'a.ts', type: 'MODIFY' };
      const newFile: PlanFile = { path: 'b.ts', type: 'NEW' };
      const deleteFile: PlanFile = { path: 'c.ts', type: 'DELETE' };

      const isModify = (file: PlanFile) => file.type === 'MODIFY';
      const isNew = (file: PlanFile) => file.type === 'NEW';
      const isDelete = (file: PlanFile) => file.type === 'DELETE';

      expect(isModify(modifyFile)).toBe(true);
      expect(isModify(newFile)).toBe(false);
      expect(isNew(newFile)).toBe(true);
      expect(isDelete(deleteFile)).toBe(true);
    });

    it('should distinguish between verification types', () => {
      const automated: VerificationStep = { type: 'Automated', description: 'Test' };
      const manual: VerificationStep = { type: 'Manual', description: 'Test' };

      const isAutomated = (step: VerificationStep) => step.type === 'Automated';
      const isManual = (step: VerificationStep) => step.type === 'Manual';

      expect(isAutomated(automated)).toBe(true);
      expect(isAutomated(manual)).toBe(false);
      expect(isManual(manual)).toBe(true);
    });

    it('should check if step is completed', () => {
      const completedStep: PlanStep = { title: 'Done', completed: true };
      const pendingStep: PlanStep = { title: 'Pending', completed: false };

      const isCompleted = (step: PlanStep) => step.completed;

      expect(isCompleted(completedStep)).toBe(true);
      expect(isCompleted(pendingStep)).toBe(false);
    });

    it('should check if optional fields exist', () => {
      const withSummary: PlanFile = {
        path: 'a.ts',
        type: 'MODIFY',
        summary: 'Has summary',
      };
      const withoutSummary: PlanFile = { path: 'b.ts', type: 'MODIFY' };

      const hasSummary = (file: PlanFile) => file.summary !== undefined;

      expect(hasSummary(withSummary)).toBe(true);
      expect(hasSummary(withoutSummary)).toBe(false);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle complete implementation plan', () => {
      const plan: ImplementationPlan = {
        goal: 'Build a REST API',
        description: 'Create a complete REST API with CRUD operations',
        files: [
          { path: 'src/controllers/userController.ts', type: 'NEW', summary: 'User controller' },
          { path: 'src/models/user.ts', type: 'NEW', summary: 'User model' },
          { path: 'src/routes/userRoutes.ts', type: 'NEW', summary: 'User routes' },
          { path: 'src/app.ts', type: 'MODIFY', summary: 'Add routes to app' },
        ],
        steps: [
          { title: 'Create user model', description: 'Define user schema', completed: true },
          { title: 'Create user controller', description: 'Implement CRUD operations', completed: true },
          { title: 'Create user routes', description: 'Define API endpoints', completed: false },
          { title: 'Integrate routes', description: 'Add routes to main app', completed: false },
        ],
        verification: [
          { type: 'Automated', description: 'Run unit tests for all controllers' },
          { type: 'Automated', description: 'Run integration tests' },
          { type: 'Manual', description: 'Test API endpoints manually' },
        ],
        rawContent: `# Plan: Build a REST API

## Files to Create/Modify
- src/controllers/userController.ts (NEW)
- src/models/user.ts (NEW)
- src/routes/userRoutes.ts (NEW)
- src/app.ts (MODIFY)

## Steps
1. Create user model
2. Create user controller
3. Create user routes
4. Integrate routes

## Verification
- Automated tests
- Manual testing`,
      };

      expect(plan.files).toHaveLength(4);
      expect(plan.steps).toHaveLength(4);
      expect(plan.verification).toHaveLength(3);
      expect(plan.rawContent).toContain('# Plan');
    });

    it('should handle empty/minimal implementation plan', () => {
      const plan: ImplementationPlan = {
        goal: 'Minimal goal',
        files: [],
        steps: [],
        verification: [],
        rawContent: '',
      };

      expect(plan.goal).toBe('Minimal goal');
      expect(plan.files).toHaveLength(0);
      expect(plan.steps).toHaveLength(0);
      expect(plan.verification).toHaveLength(0);
    });

    it('should handle plan with mixed completion states', () => {
      const plan: ImplementationPlan = {
        goal: 'Mixed completion',
        files: [],
        steps: [
          { title: 'Completed', completed: true },
          { title: 'Pending', completed: false },
          { title: 'Also completed', completed: true },
          { title: 'Also pending', completed: false },
        ],
        verification: [],
        rawContent: '',
      };

      const completedCount = plan.steps.filter((s) => s.completed).length;
      const pendingCount = plan.steps.filter((s) => !s.completed).length;

      expect(completedCount).toBe(2);
      expect(pendingCount).toBe(2);
    });
  });
});
