import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for skill parsing from OpenCode server's skill tool
 * These tests ensure the parser correctly handles the format returned by the server
 */

/**
 * Helper function to parse skill description - matches the implementation in ChatViewProvider
 */
function parseSkillDescription(description: string): Array<{ name: string; description: string }> {
  // Normalize line endings to handle \r\n (Windows) and \r (old Mac)
  const normalizedDescription = description.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedDescription.split('\n');
  const commands: Array<{ name: string; description: string }> = [];
  let inAvailableSection = false;
  let currentSkill: { name: string; description: string } | null = null;

  for (const line of lines) {
    if (line.includes('## Available Skills') || line.includes('Available Skills')) {
      inAvailableSection = true;
      continue;
    }

    if (inAvailableSection) {
      const match = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.+)$/);
      if (match) {
        if (currentSkill) {
          commands.push(currentSkill);
        }
        currentSkill = {
          name: match[1].trim(),
          description: match[2].trim()
        };
      } else if (line.startsWith('##') || line.startsWith('---')) {
        // End of skills section
        if (currentSkill) {
          commands.push(currentSkill);
          currentSkill = null; // Clear to prevent double-push
        }
        break;
      } else if (line.trim().startsWith('- ') && currentSkill) {
        // Continuation of description - remove the '- ' prefix
        currentSkill.description += '\n' + line.trim().substring(2);
      } else if (line.trim().length > 0 && currentSkill) {
        // Continuation of description (lines without '- ' prefix)
        currentSkill.description += '\n' + line.trim();
      }
    }
  }

  // Don't forget to push the last skill if we didn't hit a break condition
  if (currentSkill) {
    commands.push(currentSkill);
  }

  return commands;
}

// ============================================================================
// Basic Parsing Tests
// ============================================================================

test('should parse single-line skill descriptions', () => {
  const description = `
## Available Skills
- **test-skill**: This is a simple description
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'test-skill');
  assert.equal(skills[0].description, 'This is a simple description');
});

test('should parse multi-line skill descriptions', () => {
  const description = `
## Available Skills
- **complex-skill**: This is a long description that spans
multiple lines and contains lots of details about how
the skill should be used and what it does.
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'complex-skill');
  assert.ok(skills[0].description.includes('multiple lines'));
});

test('should parse multiple skills', () => {
  const description = `
## Available Skills
- **skill-one**: First skill description
- **skill-two**: Second skill description
- **skill-three**: Third skill description
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 3);
  assert.equal(skills[0].name, 'skill-one');
  assert.equal(skills[1].name, 'skill-two');
  assert.equal(skills[2].name, 'skill-three');
});

test('should handle blank lines between skills', () => {
  const description = `
## Available Skills
- **alpha**: First skill

- **beta**: Second skill

- **gamma**: Third skill
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 3);
  assert.equal(skills[0].name, 'alpha');
  assert.equal(skills[1].name, 'beta');
  assert.equal(skills[2].name, 'gamma');
});

test('should stop at --- separator', () => {
  const description = `
## Available Skills
- **skill-one**: Description one
---
## Other Section
Some content here
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'skill-one');
});

test('should stop at next heading', () => {
  const description = `
## Available Skills
- **skill-one**: Description one
## Another Section
More content
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'skill-one');
});

test('should handle hyphens in skill names', () => {
  const description = `
## Available Skills
- **my-custom-skill**: Description with hyphens
- **another-skill**: Another description
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 2);
  assert.equal(skills[0].name, 'my-custom-skill');
  assert.equal(skills[1].name, 'another-skill');
});

test('should handle colons in descriptions', () => {
  const description = `
## Available Skills
- **skill-with-colon**: Description: with multiple : colons
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 1);
  assert.ok(skills[0].description.includes('with multiple : colons'));
});

test('should return empty array if no skills section found', () => {
  const description = `
## Some Other Section
Some content here
- **not-a-skill**: This should be ignored
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 0);
});

test('should handle real OpenCode skill list format', () => {
  const description = `
Load a specialized skill that provides domain-specific instructions and workflows.

When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.

The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.

Tool output includes a \`<skill_content name="...">\` block with the loaded content.

The following skills provide specialized sets of instructions for particular tasks
Invoke this tool to load a skill when a task matches one of the available skills listed below:

## Available Skills
- **security-review**: Use this skill when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and patterns.
- **pr-review**: Comprehensive PR review for code quality, patterns, and best practices. Use when reviewing pull requests to check: (1) Adherence to team conventions and coding standards, (2) Code patterns and architectural consistency, (3) Maintainability and readability, (4) Documentation and comments, (5) Naming conventions and structure.
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 2);
  assert.equal(skills[0].name, 'security-review');
  assert.ok(skills[0].description.includes('comprehensive security checklist'));
  assert.equal(skills[1].name, 'pr-review');
  assert.ok(skills[1].description.includes('Comprehensive PR review'));
});

// ============================================================================
// Edge Cases and Robustness Tests
// ============================================================================

test('should handle Windows line endings (\\r\\n)', () => {
  const description = '## Available Skills\r\n- **test**: Description\r\n';
  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'test');
});

test('should handle tabs instead of spaces', () => {
  const description = '## Available Skills\n- **test):\tDescription here';
  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'test');
});

test('should handle description with special characters', () => {
  const description = `
## Available Skills
- **json-skill**: Handles { "quotes" } and [brackets]
- **regex-skill**: Works with $regex patterns
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 2);
  assert.equal(skills[0].name, 'json-skill');
  assert.ok(skills[0].description.includes('{'));
  assert.equal(skills[1].name, 'regex-skill');
  assert.ok(skills[1].description.includes('$regex'));
});

test('should handle unicode characters in skill names', () => {
  const description = `
## Available Skills
- **日本語-skill**: Description with unicode
- **skill-ñoño**: Another unicode skill
`;

  const skills = parseSkillDescription(description);
  assert.equal(skills.length, 2);
  assert.equal(skills[0].name, '日本語-skill');
  assert.equal(skills[1].name, 'skill-ñoño');
});
