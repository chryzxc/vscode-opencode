import { marked } from 'marked';

// Thin wrapper using existing `marked` dependency.
// Kept intentionally minimal to satisfy project constraint
// and allow later replacement with a pure-TS renderer if desired.
export function renderMarkdown(markdown: string): string {
  return marked(markdown) as string;
}
