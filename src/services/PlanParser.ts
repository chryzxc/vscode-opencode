/**
 * Plan Parser - Implementation Plan Parsing Service
 *
 * Parses markdown implementation plans into structured data objects.
 * This service handles the extraction of goals, file operations, steps,
 * and verification plans from AI-generated implementation plans.
 *
 * **Supported Formats:**
 *
 * File Operations (all equivalent):
 * - `#### [MODIFY] src/file.ts`
 * - `### MODIFY: src/file.ts`
 * - `[MODIFY] src/file.ts`
 * - `[MODIFY] src/file.ts (file:///absolute/path)`
 *
 * Verification Steps:
 * - `## Verification Plan`
 * - `- Automated test`
 * - `- Manual review`
 *
 * Checklist Items:
 * - `- [ ] Step 1`
 * - `- [x] Step 2` (completed)
 *
 * **Parsing Strategy:**
 * 1. Extract goal from first header
 * 2. Extract description (text between goal and first section)
 * 3. Extract file operations via regex with flexible syntax
 * 4. Extract verification steps
 * 5. Extract checklist items
 * 6. Return structured plan with rawContent preserved
 *
 * **Error Handling:**
 * - Malformed file ops → Logged, skipped
 * - Missing sections → Empty arrays (no error)
 * - Invalid markdown → Returns partial plan
 *
 * **Design Philosophy:**
 * The parser is lenient and forgiving. It tries to extract whatever
 * information is available rather than failing on format errors.
 * This allows it to work with various AI-generated plan formats.
 *
 * @module PlanParser
 * @see ImplementationPlan for the output structure
 * @see ChatViewProvider for usage (detects and parses plans)
 */

import { ImplementationPlan } from '../types/Plan';

/**
 * Utility class for parsing markdown implementation plans.
 *
 * This class provides static methods for extracting structured data
 * from markdown-formatted implementation plans.
 *
 * **Usage:**
 * ```typescript
 * const markdown = `
 *   ## Add Feature X
 *   ### Files
 *   [MODIFY] src/app.ts
 *   ### Steps
 *   - [ ] Implement feature
 * `;
 * const plan = PlanParser.parse(markdown);
 * console.log(plan.files); // [{type: 'MODIFY', path: 'src/app.ts'}]
 * ```
 *
 * All methods are static; no instantiation needed.
 */
export class PlanParser {
  /**
   * Parses markdown plan text into a structured ImplementationPlan.
   *
   * **Supported Markdown Format:**
   *
   * Goal (first header):
   * ```markdown
   * ## Add User Authentication
   * ### Add User Authentication
   * # Add User Authentication
   * ```
   *
   * File Operations (flexible formats):
   * ```markdown
   * #### [MODIFY] src/app.ts
   * ### MODIFY: src/components/User.tsx
   * [NEW] src/services/AuthService.ts
   * [DELETE] src/old/legacy.js (file:///absolute/path)
   * ```
   *
   * Steps/Checklist:
   * ```markdown
   * - [ ] Create user model
   * - [x] Set up database
   * - [ ] Implement login UI
   * ```
   *
   * Verification:
   * ```markdown
   * ## Verification Plan
   * - Automated test for login flow
   * - Manual review of security
   * ```
   *
   * **Parsing Algorithm:**
   * 1. Extract goal from first # header
   * 2. Extract description (text between goal and first section)
   * 3. Extract file ops via regex: `\[MODIFY|NEW|DELETE\] path`
   * 4. Extract verification steps under "Verification Plan" header
   * 5. Extract checkbox items: `- [x]` or `- [ ]`
   * 6. Return structured plan
   *
   * **Extraction Details:**
   *
   * *Goal Extraction:*
   * - Finds first `#` header in markdown
   * - Uses header text as goal
   *
   * *Description Extraction:*
   * - Text between goal header and first section header
   * - Falls back to all remaining text if no sections found
   *
   * *File Operation Extraction:*
   * - Regex: `(?:#{1,4}\s+)?\[(MODIFY|NEW|DELETE)\]\s+([^\s()]+)`
   * - Strips `file:///` prefixes if present
   * - Removes trailing brackets
   *
   * *Verification Step Extraction:*
   * - Finds "Verification Plan" section
   * - Parses list items (-, *, +)
   * - Auto-detects type: "Automated" if contains "auto/test/script"
   * - Otherwise: "Manual"
   *
   * *Step Extraction:*
   * - Regex: `- [x] title` or `- [ ] title`
   * - Sets `completed: true` if checkbox is `[x]`
   * - Sets `completed: false` if checkbox is `[ ]` or `[/]`
   *
   * **Error Tolerance:**
   * - Missing sections → Return empty arrays
   * - Invalid file paths → Skip and continue
   * - Malformed checkboxes → Skip
   * - Always returns a valid ImplementationPlan object
   *
   * @param markdown - Raw markdown text to parse
   * @returns Parsed ImplementationPlan with all extracted sections
   *
   * @example
   * ```typescript
   * const plan = PlanParser.parse(`
   *   ## Add Feature X
   *
   *   This implementation adds feature X to improve user experience.
   *
   *   ### Files
   *   [MODIFY] src/app.ts - Add feature logic
   *   [NEW] src/components/FeatureX.tsx
   *
   *   ### Tasks
   *   - [x] Design API
   *   - [ ] Implement UI
   *   - [ ] Add tests
   *
   *   ### Verification Plan
   *   - Automated test for core functionality
   *   - Manual review of UI/UX
   * `);
   *
   * console.log(plan.goal); // "Add Feature X"
   * console.log(plan.files.length); // 2
   * console.log(plan.steps.length); // 3
   * console.log(plan.verification.length); // 2
   * ```
   *
   * @see ImplementationPlan for output structure
   */
  public static parse(markdown: string): ImplementationPlan {
    const plan: ImplementationPlan = {
      goal: "",
      files: [],
      steps: [],
      verification: [],
      rawContent: markdown,
    };

    // Extract Goal - Better handling for different header styles
    const goalMatch = markdown.match(/^#+\s+(.*)/m);
    if (goalMatch) {
      plan.goal = goalMatch[1].trim();

      // Extract Description: text after Goal but before a standard technical section
      const goalEndIndex = markdown.indexOf(goalMatch[0]) + goalMatch[0].length;

      // Look for standard technical sections indicating the end of the intro
      const nextHeaderMatch = markdown
        .slice(goalEndIndex)
        .match(
          /^#{2,4}\s+(Proposed Changes|Tasks|Checklist|Verification Plan|Steps|Files)/im,
        );

      if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
        const description = markdown
          .slice(goalEndIndex, goalEndIndex + nextHeaderMatch.index)
          .trim();
        if (description) {
          plan.description = description;
        }
      } else {
        // Fallback: if no standard sections, take everything else as description
        // (This keeps the full text intact if the LLM didn't use expected sections but still sent a plan)
        const remaining = markdown.slice(goalEndIndex).trim();
        if (remaining) {
          plan.description = remaining;
        }
      }
    }

    // Extract Files - More lenient regex
    // Matches #### [MODIFY] file.path, ### MODIFY: file.path, [MODIFY] file.path, etc.
    const fileRegex =
      /(?:#{1,4}\s+)?\[(MODIFY|NEW|DELETE)\]\s+([^\s()]+)(?:\((file:\/\/\/.*?)\))?/gi;
    let match;
    while ((match = fileRegex.exec(markdown)) !== null) {
      const type = match[1].toUpperCase() as "MODIFY" | "NEW" | "DELETE";
      let filePath = match[2].trim();
      if (match[3]) {
        filePath = match[3].replace("file:///", "");
      }

      // Clean up brackets if they were captured
      filePath = filePath.replace(/[[\]]/g, "");

      plan.files.push({ type, path: filePath });
    }

    // Extract Verification Steps - Flexible headers
    const verificationRegex = /^#+\s+Verification Plan\s*([\s\S]*?)(?=#+|$)/im;
    const vMatch = markdown.match(verificationRegex);
    if (vMatch) {
      const content = vMatch[1];
      const items = content.split("\n");
      items.forEach((item) => {
        const desc = item.replace(/^[-*+]\s*/, "").trim();
        if (desc) {
          const type = /auto|script|test/i.test(desc) ? "Automated" : "Manual";
          plan.verification.push({ type, description: desc });
        }
      });
    }

    // Extract Steps (Checklist)
    // First try strict checkbox format: - [ ] Task
    const checkboxRegex = /^[-*+]\s*\[([ xX/])\]\s*(.*)/gm;
    let foundCheckboxes = false;
    while ((match = checkboxRegex.exec(markdown)) !== null) {
      foundCheckboxes = true;
      plan.steps.push({
        title: match[2].trim(),
        completed: match[1].toLowerCase() === "x",
      });
    }

    // If no checkboxes found, fallback to capturing standard bullet points or numbered lists
    // This assumes the core "description" is already extracted and we are crawling technical sections
    if (!foundCheckboxes) {
      // Find a likely "Tasks" section first to avoid grabbing random text
      const tasksSectionRegex =
        /^#+\s+(Tasks|Steps|Implementation Plan|Proposed Changes)\s*([\s\S]*?)(?=#+|$)/im;
      const tasksMatch = markdown.match(tasksSectionRegex);

      const textToSearch = tasksMatch ? tasksMatch[2] : markdown;
      const listRegex = /^(?:[-*+]|\d+\.)\s+(?!\[([ xX/])\])(.*)/gm;

      while ((match = listRegex.exec(textToSearch)) !== null) {
        // Ignore lines that look like file operations (handled separately)
        if (!/\[(MODIFY|NEW|DELETE)\]/i.test(match[1])) {
          plan.steps.push({
            title: match[1].trim(),
            completed: false,
          });
        }
      }
    }

    return plan;
  }

  /**
   * Converts a structured ImplementationPlan back into a clean markdown string.
   * This is useful for "cleaning" a plan that may have been parsed from a message
   * containing extra noise (like conversation history or thinking traces).
   *
   * @param plan - The structured plan to convert
   * @returns Clean markdown string
   */
  public static toMarkdown(plan: ImplementationPlan): string {
    const lines: string[] = [];

    if (plan.goal) {
      lines.push(`# ${plan.goal}`);
      lines.push("");
    }

    if (plan.description) {
      lines.push(plan.description);
      lines.push("");
    }

    if (plan.files && plan.files.length > 0) {
      lines.push("## Proposed Changes");
      lines.push("");
      plan.files.forEach((file) => {
        lines.push(`#### [${file.type}] ${file.path}`);
        if (file.summary) {
          lines.push(file.summary);
          lines.push("");
        }
      });
      lines.push("");
    }

    if (plan.steps && plan.steps.length > 0) {
      lines.push("## Tasks");
      lines.push("");
      plan.steps.forEach((step) => {
        const marker = step.completed ? "x" : " ";
        lines.push(`- [${marker}] ${step.title}`);
        if (step.description) {
          lines.push(`  ${step.description}`);
        }
      });
      lines.push("");
    }

    if (plan.verification && plan.verification.length > 0) {
      lines.push("## Verification Plan");
      lines.push("");
      plan.verification.forEach((v) => {
        lines.push(`- ${v.description}`);
      });
      lines.push("");
    }

    return lines.join("\n").trim();
  }
}
