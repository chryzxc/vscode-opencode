import React, { useEffect, useRef, forwardRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css'; // Default base, we'll custom style it further
import vscode from '../chat/lib/vscode';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isPreParsed?: boolean;
  isInline?: boolean;
}


function getFileExtension(filePath: string): string {
  const match = filePath.match(/\.([a-zA-Z0-9]+)(?::|$)/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Injects a file-icon + clickable link for text that looks like a file path.
 * Matches: src/foo.ts, ./bar.tsx, path/to/file.py, bare filenames like foo.ts
 *
 * Uses the same CSS class pattern as MessageComponents.tsx FileIcon so the
 * centralized icon-theme CSS renders consistently across the entire app.
 *
 * Clicking a path posts { type: 'openFile', file: <path> } to VS Code,
 * which opens the file in a new editor tab — the same message already used
 * by the tool-event file links in AssistantMessage.
 */
/**
 * Injects a file-icon + clickable link for text that looks like a file path.
 * Matches: src/foo.ts, ./bar.tsx, path/to/file.py, bare filenames like foo.ts
 *
 * Uses the VS Code file icon theme CSS classes (same as FileIcon in MessageComponents.tsx).
 * Clicking a path posts { type: 'openFile', file: <path> } to VS Code.
 */
function injectFileIcons(container: HTMLElement): void {
  // Group 1 = optional boundary char, Group 2 = the file path.
  const FILE_PATH_RE =
    /(^|[\s(["'`])((?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[\w]+|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp|java|rb|php|sh|bash|zsh|fish|json|yaml|yml|toml|md|mdx|css|scss|less|html|xml|svg|sql|prisma|lock|env|gitignore|dockerfile|makefile))(?=$|[\s)"'`])/gi;

  const walk = (node: Node) => {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).tagName === 'PRE'
    ) {
      return; // skip code blocks
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      const parent = node.parentNode as HTMLElement | null;
      if (!parent) return;

      // Don't re-process or inject inside anchors / already-processed nodes
      if (parent.closest('.md-file-path') || parent.tagName === 'A') return;

      FILE_PATH_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      let lastIndex = 0;
      const fragments: Node[] = [];
      let hadMatch = false;

      while ((match = FILE_PATH_RE.exec(text)) !== null) {
        hadMatch = true;
        // match[1] = boundary char (space, quote, etc.), match[2] = file path
        const boundaryChar = match[1];
        const filePath = match[2];
        const pathStart = match.index + boundaryChar.length;

        // Preserve text (and the boundary char) before the file path
        if (pathStart > lastIndex) {
          fragments.push(document.createTextNode(text.slice(lastIndex, pathStart)));
        }

        const ext = getFileExtension(filePath);
        const fileName = (filePath.split(/[/\\]/).pop() || '').toLowerCase();

        const cleanKey = (s: string) =>
          s.replace(/\./g, '-').replace(/\//g, '-').replace(/\+/g, 'p')
            .replace(/#/g, 'h').replace(/,/g, '');

        // Clickable button.
        // NOTE: display:inline-block + vertical-align:middle correctly places the
        // button on the text midline without shifting surrounding text upward.
        // display:inline-flex was the root cause of the previous alignment bug.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-file-path';
        btn.title = `Open ${filePath}`;
        btn.style.cssText =
          'display:inline-block;vertical-align:middle;background:none;border:none;' +
          'padding:0;cursor:pointer;font:inherit;white-space:nowrap;' +
          'text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode?.postMessage({ type: 'openFile', file: filePath });
        });

        // Icon span — intentionally EMPTY, same as FileIcon in MessageComponents.tsx.
        // The VS Code icon theme injects the icon via a CSS ::before pseudo-element.
        const iconEl = document.createElement('span');
        iconEl.className = [
          'file-icon',
          `file-icon-type-${cleanKey(fileName)}`,
          `file-icon-type-${cleanKey(ext)}`,
          'file-icon-type-file',
        ].join(' ');
        iconEl.setAttribute('aria-hidden', 'true');
        // Inline style mirrors FileIcon's exact layout so theme CSS aligns correctly
        iconEl.style.cssText =
          'width:16px;height:16px;display:inline-flex;align-items:center;' +
          'justify-content:center;flex-shrink:0;margin-right:4px;vertical-align:text-bottom;';

        const textEl = document.createElement('span');
        textEl.textContent = filePath;
        textEl.style.cssText = 'vertical-align:middle;';

        btn.appendChild(iconEl);
        btn.appendChild(textEl);
        fragments.push(btn);

        lastIndex = pathStart + filePath.length;
      }

      if (hadMatch) {
        if (lastIndex < text.length) {
          fragments.push(document.createTextNode(text.slice(lastIndex)));
        }
        const frag = document.createDocumentFragment();
        for (const f of fragments) frag.appendChild(f);
        parent.replaceChild(frag, node);
      }
      return;
    }

    // Recurse into children (snapshot first because we mutate the DOM)
    const children = Array.from(node.childNodes);
    for (const child of children) walk(child);
  };

  walk(container);
}



/**
 * Pre-processes markdown to fix numbered lists that have blank lines between items.
 * This ensures that AI responses with formatted numbered lists render correctly.
 *
 * Example:
 *   Input:  "1. First item\n\n2. Second item\n\n3. Third item"
 *   Output: "1. First item\n2. Second item\n3. Third item"
 *
 * The regex matches:
 * - Optional whitespace at the start of a line
 * - A number followed by a period and space (the list marker)
 * - Content after the marker
 * - Optional whitespace at the end
 * - One or more blank lines (followed by another list marker)
 */
function preprocessMarkdown(content: string): string {
  // Remove blank lines between numbered list items
  // This regex finds lines that start with "N. " pattern followed by blank lines
  // and removes those blank lines to merge consecutive list items
  return content.replace(
    /(^|\n)(\d+\.\s+.*?)(?:\n\s*\n)+(?=\d+\.\s+)/gm,
    '$1$2\n'
  );
}

/**
 * A reusable, stylish Markdown renderer with syntax highlighting.
 */
export const MarkdownRenderer = forwardRef<HTMLDivElement, MarkdownRendererProps>(({
  content,
  className = '',
  isPreParsed = false,
  isInline = false,
}, ref) => {
  const innerRef = useRef<HTMLDivElement>(null);

  const setRefs = (element: HTMLDivElement | null) => {
    innerRef.current = element;
    if (typeof ref === 'function') {
      ref(element);
    } else if (ref && 'current' in ref) {
      // @ts-ignore
      ref.current = element;
    }
  };

  useEffect(() => {
    if (innerRef.current) {
      // Syntax-highlight code blocks
      const codeBlocks = innerRef.current.querySelectorAll('pre code');
      codeBlocks.forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });

      // Inject file icons next to file-path-like text
      injectFileIcons(innerRef.current);
    }
  }, [content, isPreParsed]);

  // Pre-process markdown to fix numbered lists with blank lines
  const processedContent = isPreParsed ? content : preprocessMarkdown(content || '');

  const html = isPreParsed
    ? content
    : isInline
      ? marked.parseInline(processedContent)
      : marked.parse(processedContent);

  const Tag = isInline ? 'span' : 'div';

  return (
    <Tag
      ref={setRefs as any}
      className={`markdown-body ${className}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering requires HTML injection
      dangerouslySetInnerHTML={{ __html: html as string }}
    />
  );
});
MarkdownRenderer.displayName = 'MarkdownRenderer';

