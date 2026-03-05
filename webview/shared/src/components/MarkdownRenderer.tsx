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
// Extension-to-color map — mirrors FILE_COLORS in utils/index.ts for icon coloring.
// NOTE: Keep in sync with utils/index.ts FILE_COLORS.
const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f1e05a',
  jsx: '#f1e05a',
  mjs: '#f1e05a',
  cjs: '#f1e05a',
  css: '#563d7c',
  scss: '#c6538c',
  less: '#1d365d',
  html: '#e34c26',
  json: '#cbcb41',
  yaml: '#cbcb41',
  yml: '#cbcb41',
  md: '#519aba',
  mdx: '#519aba',
  py: '#3572A5',
  go: '#00ADD8',
  rs: '#dea584',
  java: '#b07219',
  rb: '#701516',
  php: '#4F5D95',
  sh: '#89e051',
  bash: '#89e051',
  c: '#555555',
  cpp: '#f34b7d',
  svg: '#FFB13B',
  sql: '#e38c00',
  toml: '#9c4221',
  xml: '#e37933',
};

const DEFAULT_ICON_COLOR = '#6e7681';

/**
 * Returns a tiny colored file-page SVG string used as a fallback icon when the
 * VS Code file icon theme has no ::before rule for a given file extension.
 */
function makeFileSvg(color: string): string {
  const c = encodeURIComponent(color);
  // Simple file-page outline — matches the generic file icon used across the app
  return (
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" ` +
    `stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `fill="${c}" fill-opacity="0.15"/>` +
    `<polyline points="14 2 14 8 20 8" stroke="${c}" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/**
 * Injects a file-icon + clickable link for text that looks like a file path.
 * Matches: src/foo.ts, ./bar.tsx, path/to/file.py, bare filenames like foo.ts
 *
 * Uses an inline SVG icon (matching FileIcon's fallback in MessageComponents.tsx)
 * so every extension gets a consistent colored icon regardless of VS Code theme CSS.
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
        const iconColor = EXT_COLORS[ext] ?? DEFAULT_ICON_COLOR;

        // Sanitize key for CSS class — same logic as FileIcon in MessageComponents.tsx
        const cleanKey = (s: string) =>
          s.replace(/\./g, '_').replace(/\//g, '-').replace(/\+/g, 'p')
            .replace(/#/g, 'h').replace(/[^a-z0-9_-]/g, '_');

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
          `color:${iconColor};` +
          'text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode?.postMessage({ type: 'openFile', file: filePath });
        });

        // Icon span — intentionally EMPTY, same as FileIcon in MessageComponents.tsx.
        // The VS Code icon theme injects the icon via a CSS ::before pseudo-element.
        // NOTE: Do NOT put any content inside this span — that would cause the theme
        // icon (::before) and the inner content to both render, producing duplicates.
        const iconEl = document.createElement('span');
        iconEl.className = [
          'file-icon',
          `file-icon-type-${cleanKey(fileName)}`,
          `file-icon-type-${cleanKey(ext)}`,
        ].join(' ');
        iconEl.setAttribute('aria-hidden', 'true');
        // Store the fallback color for the post-paint check
        iconEl.dataset.fallbackColor = iconColor;
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

  // After the browser has painted, check each injected icon span.
  // If the VS Code theme has no ::before background-image for this extension,
  // inject the SVG fallback so the space never appears empty.
  requestAnimationFrame(() => {
    const icons = container.querySelectorAll<HTMLElement>('.file-icon[data-fallback-color]');
    icons.forEach((el) => {
      const beforeStyle = window.getComputedStyle(el, '::before');
      const bg = beforeStyle.backgroundImage;
      // 'none' or empty string means the theme has no icon for this type
      if (!bg || bg === 'none') {
        const color = el.dataset.fallbackColor ?? DEFAULT_ICON_COLOR;
        el.innerHTML = makeFileSvg(color);
      }
      delete el.dataset.fallbackColor;
    });
  });
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

  const html = isPreParsed
    ? content
    : isInline
      ? marked.parseInline(content || '')
      : marked.parse(content || '');

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

