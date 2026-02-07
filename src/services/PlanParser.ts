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

    // Extract Goal
    // Extract Goal - Support finding the first H1 header anywhere
    const goalMatch = markdown.match(/^# (.*)/m);
    if (goalMatch) {
      plan.goal = goalMatch[1].trim();
    }

    // Extract Files
    // Look for #### [MODIFY/NEW/DELETE] [filename](file:///path)
    // Relaxed regex to handle potential variations
    const fileRegex = /#{3,4} \[(MODIFY|NEW|DELETE)\] (.*?)\((file:\/\/\/.*?)\)/g;
    let match;
    while ((match = fileRegex.exec(markdown)) !== null) {
      const path = match[3].replace('file:///', '');
      // On Windows, the path might still have forward slashes, but we want to be consistent
      // Let's keep it as provided but normalized
      plan.files.push({
        type: match[1] as 'MODIFY' | 'NEW' | 'DELETE',
        path: path,
      });
    }

    // Extract Verification Steps
    const autoTestsMatch = markdown.match(/### Automated Tests\s*([\s\S]*?)(?=###|$)/);
    if (autoTestsMatch) {
      const items = autoTestsMatch[1].trim().split('\n');
      items.forEach(item => {
        const desc = item.replace(/^-\s*/, '').trim();
        if (desc) plan.verification.push({ type: 'Automated', description: desc });
      });
    }

    const manualTestsMatch = markdown.match(/### Manual Verification\s*([\s\S]*?)(?=###|$)/);
    if (manualTestsMatch) {
      const items = manualTestsMatch[1].trim().split('\n');
      items.forEach(item => {
        const desc = item.replace(/^-\s*/, '').trim();
        if (desc) plan.verification.push({ type: 'Manual', description: desc });
      });
    }

    // Extract Steps (if any bullet points are found in a "Steps" or "Tasks" section)
    // For now, we'll try to find any list items that look like task.md steps
    const stepRegex = /-\s*\[([ x/])\]\s*(.*)/g;
    while ((match = stepRegex.exec(markdown)) !== null) {
      plan.steps.push({
        title: match[2].trim(),
        completed: match[1] === 'x',
      });
    }

    return plan;
  }
}
