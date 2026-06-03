import React, { useEffect, useMemo, useRef, forwardRef, memo } from 'react';
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

const EXT_COLORS: Record<string, string> = {
  ts: 'color-mix(in srgb, var(--oc-text) 90%, var(--oc-accent))',
  tsx: 'color-mix(in srgb, var(--oc-text) 90%, var(--oc-accent))',
  js: 'color-mix(in srgb, var(--oc-text) 90%, var(--oc-yellow))',
  jsx: 'color-mix(in srgb, var(--oc-text) 90%, var(--oc-yellow))',
  json: 'color-mix(in srgb, var(--oc-text) 90%, var(--oc-yellow))',
  md: 'color-mix(in srgb, var(--oc-text) 92%, var(--oc-accent))',
  py: 'color-mix(in srgb, var(--oc-text) 90%, var(--oc-accent))',
  css: 'color-mix(in srgb, var(--oc-text) 90%, var(--oc-accent))',
  html: 'color-mix(in srgb, var(--oc-text) 88%, var(--oc-orange))',
  env: 'color-mix(in srgb, var(--oc-text) 92%, var(--oc-yellow))',
  lock: 'var(--oc-text-muted)',
  lockb: 'var(--oc-text-muted)',
};


function getFileExtension(filePath: string): string {
  const fileName = (filePath.split(/[/\\]/).pop() || '').split(':')[0];
  const index = fileName.lastIndexOf('.');
  return index >= 0 && index < fileName.length - 1
    ? fileName.slice(index + 1).toLowerCase()
    : '';
}

function getFileIconKeys(filePath: string): string[] {
  const fileName = (filePath.split(/[/\\]/).pop() || '').split(':')[0].toLowerCase();
  if (!fileName) return [];

  const parts = fileName.split('.');
  const extensionKeys =
    parts.length > 1
      ? parts
          .slice(1)
          .map((_, index) => parts.slice(index + 1).join('.'))
          .reverse()
      : [];

  return Array.from(new Set([fileName, ...extensionKeys].filter(Boolean)));
}

function hasThemeIcon(element: HTMLElement): boolean {
  const before = window.getComputedStyle(element, '::before');
  const content = before.getPropertyValue('content');
  const backgroundImage = before.getPropertyValue('background-image');

  return (
    (!!content && content !== 'none' && content !== 'normal' && content !== '""') ||
    (!!backgroundImage && backgroundImage !== 'none')
  );
}

function makeFileSvg(): string {
  return (
    '<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3.5 1.75h6.25L13 5v9.25H3.5V1.75Z" fill="#6e7681" opacity="0.18"/>' +
    '<path d="M9.5 1.75V5.25H13M3.5 1.75h6.25L13 5v9.25H3.5V1.75Z" stroke="#6e7681" stroke-width="1.2" stroke-linejoin="round"/>' +
    '</svg>'
  );
}

function makeFolderSvg(): string {
  return (
    '<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M1.5 3.5h4.25l1.5 1.5h7.25v8.5H1.5V3.5Z" fill="#6e7681" opacity="0.18"/>' +
    '<path d="M1.5 3.5h4.25l1.5 1.5h7.25v8.5H1.5V3.5Z" stroke="#6e7681" stroke-width="1.2" stroke-linejoin="round"/>' +
    '</svg>'
  );
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
  // Group 1 = optional boundary char, Group 2 = the file path (including directories ending with /)
  const FILE_PATH_RE =
    /(^|[\s(["'`])((?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[\w]+|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp|java|rb|php|sh|bash|zsh|fish|json|yaml|yml|toml|md|mdx|css|scss|less|html|xml|svg|sql|prisma|lock|env|gitignore|dockerfile|makefile)|(?:\.{1,2}\/)?(?:[\w.-]+\/)+)(?=$|[\s)"'`])/gi;

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

        // Detect if this is a directory (ends with /)
        const isDirectory = filePath.endsWith('/');

        const ext = getFileExtension(filePath);
        const iconKeys = getFileIconKeys(filePath);

        const cleanKey = (s: string) =>
          s.replace(/\./g, '-').replace(/\//g, '-').replace(/\+/g, 'p')
            .replace(/#/g, 'h').replace(/,/g, '');

        // Clickable button. Keep it wrap-friendly for narrow layouts.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-file-path';
        btn.title = `Open ${filePath}`;
        btn.style.cssText =
          'display:inline-flex;align-items:center;vertical-align:middle;max-width:100%;' +
          'background:none;border:none;padding:0;cursor:pointer;font:inherit;white-space:normal;' +
          'word-break:break-word;overflow-wrap:anywhere;color:var(--oc-text-soft);' +
          'text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode?.postMessage({ type: 'openFile', file: filePath });
        });

        // Icon span — intentionally EMPTY, same as FileIcon in MessageComponents.tsx.
        // The VS Code icon theme injects the icon via a CSS ::before pseudo-element.
        const iconEl = document.createElement('span');

        if (isDirectory) {
          // For directories, use folder icon classes
          iconEl.className = 'file-icon file-icon-type-folder';
        } else {
          // For files, use file extension based classes
          iconEl.className = [
            'file-icon',
            ...iconKeys.map((key) => `file-icon-type-${cleanKey(key)}`),
          ].join(' ');
        }

        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.dataset.fileIconPendingFallback = 'true';
        iconEl.dataset.isDirectory = isDirectory ? 'true' : 'false';
        // Inline style mirrors FileIcon's exact layout so theme CSS aligns correctly
        iconEl.style.cssText =
          'width:16px;height:16px;display:inline-flex;align-items:center;' +
          'justify-content:center;flex-shrink:0;margin-right:4px;vertical-align:text-bottom;';

        const textEl = document.createElement('span');
        textEl.textContent = filePath;
        textEl.style.cssText =
          `min-width:0;vertical-align:middle;word-break:break-word;overflow-wrap:anywhere;` +
          `color:${isDirectory ? 'var(--oc-text-soft)' : (EXT_COLORS[ext] || 'var(--oc-text-soft)')};`;

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

  requestAnimationFrame(() => {
    const icons = Array.from(
      container.querySelectorAll<HTMLElement>('[data-file-icon-pending-fallback="true"]'),
    );

    for (const icon of icons) {
      if (hasThemeIcon(icon)) {
        delete icon.dataset.fileIconPendingFallback;
        continue;
      }
      // For directories, keep the folder class; for files, add file class
      if (icon.dataset.isDirectory !== 'true') {
        icon.classList.add('file-icon-type-file');
      }
    }

    requestAnimationFrame(() => {
      for (const icon of icons) {
        if (hasThemeIcon(icon)) {
          delete icon.dataset.fileIconPendingFallback;
          continue;
        }

        // Use folder icon for directories, file icon for files
        if (icon.dataset.isDirectory === 'true') {
          icon.innerHTML = makeFolderSvg();
        } else {
          icon.innerHTML = makeFileSvg();
        }
        delete icon.dataset.fileIconPendingFallback;
      }
    });
  });
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
const MarkdownRendererInner = forwardRef<HTMLDivElement, MarkdownRendererProps>(({
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

  // Pre-process markdown to fix numbered lists with blank lines
  const processedContent = useMemo(
    () => (isPreParsed ? content : preprocessMarkdown(content || '')),
    [content, isPreParsed],
  );

  const html = useMemo(
    () => (
      isPreParsed
        ? content
        : isInline
          ? marked.parseInline(processedContent)
          : marked.parse(processedContent)
    ),
    [content, isInline, isPreParsed, processedContent],
  );

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
  }, [html]);

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

export const MarkdownRenderer = memo(MarkdownRendererInner);
MarkdownRenderer.displayName = 'MarkdownRenderer';
