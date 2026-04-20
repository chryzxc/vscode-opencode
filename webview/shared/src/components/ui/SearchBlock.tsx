import * as React from "react"
import { cn } from "../../utils"

export interface SearchBlockProps {
  /** The search pattern / query string */
  pattern: string
  /** Optional scope label (e.g. "grep", "search", "glob") shown in the header */
  scope?: string
  /** Optional include glob filter (e.g. "*.tsx") */
  include?: string
  /** Optional path scope */
  path?: string
  className?: string
}

export const SearchBlock = React.forwardRef<
  HTMLDivElement,
  SearchBlockProps
>(({ pattern, scope, include, path, className }, ref) => {
  if (!pattern || typeof pattern !== "string") {
    return null
  }

  return (
    <div ref={ref} className={cn("oc-search-block", className)}>
      {(scope || include || path) && (
        <div className="oc-search-block-header">
          {scope && (
            <span className="oc-search-block-scope">{scope}</span>
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
        </div>
      )}
      <pre className="oc-search-block-code">
        <code>{pattern}</code>
      </pre>
    </div>
  )
})

SearchBlock.displayName = "SearchBlock"
