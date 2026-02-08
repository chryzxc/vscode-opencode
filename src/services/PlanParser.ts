import { ImplementationPlan } from '../types/Plan';

export class PlanParser {
  /**
   * Parses a markdown string into an ImplementationPlan object
   */
  public static parse(markdown: string): ImplementationPlan {
    const plan: ImplementationPlan = {
      goal: '',
      files: [],
      steps: [],
      verification: [],
      rawContent: markdown,
    };

    // Extract Goal - Better handling for different header styles
    const goalMatch = markdown.match(/^#+\s+(.*)/m);
    if (goalMatch) {
      plan.goal = goalMatch[1].trim();

      // Extract Description: text after Goal but before first specific technical section
      const goalEndIndex = markdown.indexOf(goalMatch[0]) + goalMatch[0].length;
      // Look for any section starting with ## or ###
      const sectionMatch = markdown
        .slice(goalEndIndex)
        .match(
          /^#{2,4}\s+(Proposed Changes|Verification Plan|Tasks|Checklist|Proposed|Files|Steps|Tests|Verification)/im,
        );

      if (sectionMatch && sectionMatch.index !== undefined) {
        const description = markdown
          .slice(goalEndIndex, goalEndIndex + sectionMatch.index)
          .trim();
        if (description) {
          plan.description = description;
        }
      } else {
        // Fallback: if no clear sections, take everything else as description
        const remaining = markdown.slice(goalEndIndex).trim();
        if (remaining) {
          plan.description = remaining;
        }
      }
    }

    // Extract Files - More lenient regex
    // Matches #### [MODIFY] file.path, ### MODIFY: file.path, [MODIFY] file.path, etc.
    const fileRegex = /(?:#{1,4}\s+)?\[(MODIFY|NEW|DELETE)\]\s+([^\s()]+)(?:\((file:\/\/\/.*?)\))?/gi;
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
      const items = content.split('\n');
      items.forEach(item => {
        const desc = item.replace(/^[-*+]\s*/, "").trim();
        if (desc) {
          const type = /auto|script|test/i.test(desc) ? "Automated" : "Manual";
          plan.verification.push({ type, description: desc });
        }
      });
    }

    // Extract Steps (Checklist)
    const stepRegex = /^[-*+]\s*\[([ x/])\]\s*(.*)/gm;
    while ((match = stepRegex.exec(markdown)) !== null) {
      plan.steps.push({
        title: match[2].trim(),
        completed: match[1] === 'x',
      });
    }

    return plan;
  }
}
