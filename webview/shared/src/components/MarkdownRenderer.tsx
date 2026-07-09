import React, { useEffect, useMemo, useRef, forwardRef, memo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css'; // Default base, we'll custom style it further
import vscode from '../chat/lib/vscode';
import {
  cleanFileIconKey,
  getFileIconFallbackKind,
  getFileIconKeys,
  getFileIconThemeClasses,
  hasThemeIcon,
  isDirectoryPath,
  makeFileIconSvgMarkup,
} from './fileIcons';

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

function makeCopySvg(): string {
  return (
    '<svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5 2.75h6.5a.75.75 0 0 1 .75.75V11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="3.75" y="4.25" width="8.5" height="9" rx="1.25" stroke="currentColor" stroke-width="1.2"/>' +
    '</svg>'
  );
}

async function copyMarkdownCode(text: string): Promise<void> {
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    vscode.postMessage({ type: 'copyToClipboard', text });
  }
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
 * Check if a potential file path is actually a valid file reference.
 * This prevents false positives like "etc." or single words with periods.
 */
function isValidFilePath(filePath: string): boolean {
  // Directories are always valid if they end with /
  if (filePath.endsWith('/')) return true;

  // Must contain a dot for extension
  const lastDotIndex = filePath.lastIndexOf('.');
  if (lastDotIndex === -1) return false;

  const extension = filePath.slice(lastDotIndex + 1).toLowerCase();
  const fileName = filePath.slice(lastDotIndex > 0 ? 0 : filePath.lastIndexOf('/')).replace(/^.*\//, '');

  // List of common English words that should not be treated as filenames
  const commonWords = new Set([
    'etc', 'vs', 'js', 'ts', 'py', 'go', 'rs', 'c', 'cpp', 'java', 'rb', 'php',
    'sh', 'bash', 'zsh', 'fish', 'json', 'yaml', 'yml', 'toml', 'md', 'css', 'scss',
    'less', 'html', 'xml', 'svg', 'sql', 'env', 'fig', 'jpg', 'png', 'gif', 'pdf',
    'doc', 'txt', 'log', 'tmp', 'bak', 'old', 'new', 'org', 'com', 'net', 'io',
    'app', 'lib', 'bin', 'etc', 'usr', 'var', 'opt', 'sys', 'dev', 'proc',
    'and', 'or', 'the', 'for', 'with', 'from', 'into', 'over', 'under', 'about'
  ]);

  // If it's a single common word with extension, it's likely not a file reference
  if (commonWords.has(fileName.toLowerCase().replace(/\.[^.]*$/, ''))) {
    // Allow if it has path context (contains / or starts with ./)
    if (!filePath.includes('/') && !filePath.startsWith('.')) {
      return false;
    }
  }

  // If no path context and short filename, be more strict
  if (!filePath.includes('/') && fileName.length < 5) {
    // Must be a known extension
    const knownExtensions = new Set([
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'c', 'cpp', 'h', 'hpp',
      'java', 'rb', 'php', 'sh', 'bash', 'zsh', 'fish', 'json', 'yaml', 'yml', 'toml',
      'md', 'mdx', 'css', 'scss', 'less', 'html', 'xml', 'svg', 'sql', 'prisma',
      'lock', 'env', 'gitignore', 'dockerfile', 'makefile'
    ]);
    if (!knownExtensions.has(extension)) {
      return false;
    }
  }

  return true;
}

/**
 * Injects a file-icon + clickable link for text that looks like a file path.
 *
 * IMPORTANT: This regex is VERY RESTRICTIVE to prevent false positives.
 * It was updated to fix issues where normal text like "attachment handling in chat
 * Search for component files with names containing 'chat', 'message', etc."
 * was being incorrectly matched as a file path and rendered with a file icon.
 *
 * The regex now:
 * 1. ONLY matches known file extensions (ts, js, json, etc.)
 * 2. REQUIRES proper filename structure (must start/end with alphanumeric)
 * 3. REJECTS text with spaces, line breaks, quotes, or special characters
 * 4. REQUIRES file extensions to be 2-8 characters long
 *
 * VALID matches:
 * - src/foo.ts ✅
 * - ./bar.tsx ✅
 * - path/to/file.py ✅
 * - config.json ✅
 *
 * INVALID matches (correctly rejected):
 * - "input", "bubble" etc. ❌ (contains quotes, spaces)
 * - attachment handling in chat ❌ (spaces, line breaks)
 * - etc. ❌ (not a known extension, too short)
 * - Multi-line sentences ❌ (contains line breaks)
 *
 * Matches: src/foo.ts, ./bar.tsx, path/to/file.py, bare filenames like foo.ts
 * Uses the VS Code file icon theme CSS classes (same as FileIcon in MessageComponents.tsx).
 * Clicking a path posts { type: 'openFile', file: <path> } to VS Code.
 */
function injectFileIcons(container: HTMLElement): void {
  // Group 1 = optional boundary char (space, quote, etc.)
  // Group 2 = the file path (with strict validation)
  //
  // Pattern breakdown:
  // 1. (^|[\s(["'`]) - Boundary: start of string or space/bracket/quote
  // 2. (?:\.{1,2}\/)? - Optional ./ or ../ prefix
  // 3. [a-zA-Z0-9_] - Must start with alphanumeric or underscore
  // 4. [a-zA-Z0-9_.-]* - Middle part: alphanumeric, dots, hyphens (NOT spaces)
  // 5. [a-zA-Z0-9] - Must end with alphanumeric (NOT dot, hyphen, etc.)
  // 6. \. - Literal dot before extension
  // 7. (?:ts|tsx|js|...) - ONLY known extensions (whitelist approach)
  // 8. (?=$|[\s)"'`]) - End boundary: end of string or space/quote
  const FILE_PATH_RE =
    /(^|[\s(["'`])((?:\.{1,2}\/)?[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9](?:\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9])+\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9]\.[a-zA-Z0-9]{2,8}|(?:\.{1,2}\/)?[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9]\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp|java|rb|php|sh|bash|zsh|fish|json|yaml|yml|toml|md|mdx|css|scss|less|html|xml|svg|sql|prisma|lock|env|gitignore|dockerfile|makefile)(?=$|[\s)"'`]))/gi;

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
        // match[1] = boundary char (space, quote, etc.), match[2] = file path
        const boundaryChar = match[1];
        const filePath = match[2];

        // Skip if this doesn't look like a valid file path
        if (!isValidFilePath(filePath)) {
          continue;
        }

        hadMatch = true;
        const pathStart = match.index + boundaryChar.length;

        // Preserve text (and the boundary char) before the file path
        if (pathStart > lastIndex) {
          fragments.push(document.createTextNode(text.slice(lastIndex, pathStart)));
        }

        // Detect if this is a directory (ends with /)
        const isDirectory = isDirectoryPath(filePath);

        const ext = getFileExtension(filePath);
        const iconKeys = getFileIconKeys(filePath);

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

        iconEl.className = ['file-icon', ...getFileIconThemeClasses({ filePath, isDirectory })].join(' ');

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
        icon.innerHTML = makeFileIconSvgMarkup(
          getFileIconFallbackKind({ isDirectory: icon.dataset.isDirectory === 'true' }),
        );
        delete icon.dataset.fileIconPendingFallback;
      }
    });
  });
}

function injectCodeBlockCopyButtons(container: HTMLElement): void {
  const codeBlocks = Array.from(container.querySelectorAll<HTMLPreElement>('pre'));

  for (const pre of codeBlocks) {
    if (pre.querySelector('.markdown-copy-button')) {
      continue;
    }

    const code = pre.querySelector('code');
    const codeText = code?.textContent?.trimEnd() ?? pre.textContent?.trimEnd() ?? '';
    if (!codeText) {
      continue;
    }

    pre.classList.add('markdown-code-block');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-copy-button';
    button.setAttribute('aria-label', 'Copy code block');
    button.title = 'Copy code';
    button.innerHTML = `${makeCopySvg()}<span class="markdown-copy-button-label">Copy</span>`;

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      await copyMarkdownCode(codeText);

      const label = button.querySelector('.markdown-copy-button-label');
      if (!label) {
        return;
      }

      const originalText = label.textContent || 'Copy';
      button.dataset.copied = 'true';
      label.textContent = 'Copied';

      window.setTimeout(() => {
        button.dataset.copied = 'false';
        label.textContent = originalText;
      }, 1200);
    });

    pre.insertBefore(button, pre.firstChild);
  }
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
  // Also brutally truncate massive strings to prevent the UI thread from freezing/crashing
  // during `marked.parse` when a tool command outputs megabytes of text.
  const processedContent = useMemo(() => {
    let raw = content || '';
    if (raw.length > 150000) {
      raw = raw.slice(0, 150000) + `\n\n...[content abruptly truncated from ${raw.length} to 150000 characters for performance]`;
    }
    return isPreParsed ? raw : preprocessMarkdown(raw);
  }, [content, isPreParsed]);

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
    let timeoutId: number | null = null;

    if (innerRef.current) {
      // Debounce expensive synchronous operations during streaming to prevent
      // blocking the main thread and crashing the webview (OOM/grey screen).
      timeoutId = window.setTimeout(() => {
        if (!innerRef.current) return;

        // Syntax-highlight code blocks
        const codeBlocks = innerRef.current.querySelectorAll('pre code');
        codeBlocks.forEach((block) => {
          hljs.highlightElement(block as HTMLElement);
        });

        // Add copy controls to fenced code blocks.
        injectCodeBlockCopyButtons(innerRef.current);

        // Inject file icons next to file-path-like text
        injectFileIcons(innerRef.current);
      }, 100);
    }

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
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
