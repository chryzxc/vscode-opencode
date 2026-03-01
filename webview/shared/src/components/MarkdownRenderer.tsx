import React, { useEffect, useRef, forwardRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css'; // Default base, we'll custom style it further

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isPreParsed?: boolean;
}

/**
 * A reusable, stylish Markdown renderer with syntax highlighting.
 */
export const MarkdownRenderer = forwardRef<HTMLDivElement, MarkdownRendererProps>(({ 
  content, 
  className = "", 
  isPreParsed = false 
}, ref) => {
  const innerRef = useRef<HTMLDivElement>(null);

  const setRefs = (element: HTMLDivElement | null) => {
    innerRef.current = element;
    if (typeof ref === 'function') {
      ref(element);
    } else if (ref && 'current' in ref) {
      (ref as any).current = element;
    }
  };

  useEffect(() => {
    if (innerRef.current) {
      // Find all code blocks and apply highlight.js
      const codeBlocks = innerRef.current.querySelectorAll('pre code');
      codeBlocks.forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });
    }
  }, [content, isPreParsed]);

  const html = isPreParsed ? content : marked.parse(content || "");

  return (
    <div
      ref={setRefs}
      className={`markdown-body ${className}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering requires HTML injection
      dangerouslySetInnerHTML={{ __html: html as string }}
    />
  );
});
MarkdownRenderer.displayName = "MarkdownRenderer";
