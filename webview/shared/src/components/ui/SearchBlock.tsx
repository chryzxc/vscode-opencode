import * as React from "react"
import { cn } from "../../utils"

export interface SearchBlockProps {
  /** The search pattern / query string */
  pattern: string
  /** Render the pattern as the top title instead of a code block */
  patternInHeader?: boolean
  /** Optional scope label (e.g. "grep", "search", "glob") shown in the header */
  scope?: string
  /** Optional include glob filter (e.g. "*.tsx") */
  include?: string
  /** Optional path scope */
  path?: string
  /** Optional search/tool execution output */
  output?: string
  /** Optional grep output mode (e.g. "content", "filenames") */
  outputMode?: string
  /** Optional grep head limit count */
  headLimit?: number
  className?: string
}

export const SearchBlock = React.forwardRef<
  HTMLDivElement,
  SearchBlockProps
>(({ pattern, patternInHeader, scope, include, path, output, outputMode, headLimit, className }, ref) => {
  // Return null if search pattern is empty
  if (!pattern || typeof pattern !== "string") {
    return null
  }

  return (
    <div ref={ref} className={cn("oc-search-block", className)}>
      {/* Header section showing metadata like scope label and files path context */}
      {(patternInHeader || scope || include || path || outputMode || headLimit !== undefined) && (
        <div className="oc-search-block-header">
          {patternInHeader ? (
            <span className="oc-search-block-scope whitespace-pre-wrap break-words">
              {pattern}
            </span>
          ) : (
            scope && <span className="oc-search-block-scope">{scope}</span>
          )}
          {include && (
            <span className="oc-search-block-filter">
              <span className="oc-search-block-filter-label">in</span>
              {include}
            </span>
          )}
          {path && (
            <span className="oc-search-block-filter">
              <span className="oc-search-block-filter-label">at</span>
              {path}
            </span>
          )}
          {/* Optional display for output_mode */}
          {outputMode && (
            <span className="oc-search-block-filter">
              <span className="oc-search-block-filter-label">mode:</span>
              {outputMode}
            </span>
          )}
          {/* Optional display for head_limit */}
          {headLimit !== undefined && (
            <span className="oc-search-block-filter">
              <span className="oc-search-block-filter-label">limit:</span>
              {headLimit}
            </span>
          )}
        </div>
      )}
      {/* Main pattern code display block */}
      {!patternInHeader && (
        <pre className="oc-search-block-code">
          <code>{pattern}</code>
        </pre>
      )}
      {/* Optional search/tool execution output displayed below the pattern */}
      {output && (
        <div className="oc-search-block-output">
          <pre><code>{output}</code></pre>
        </div>
      )}
    </div>
  )
})

SearchBlock.displayName = "SearchBlock"
