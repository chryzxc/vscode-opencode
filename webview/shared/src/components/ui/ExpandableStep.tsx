import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/utils"

export interface ExpandableStepProps {
  children: React.ReactNode
  defaultExpanded?: boolean
  isImportant?: boolean
  className?: string
}

export const ExpandableStep = React.forwardRef<
  HTMLDivElement,
  ExpandableStepProps
>(({ children, defaultExpanded, isImportant = false, className }, ref) => {
  // Determine initial expanded state
  const getInitialState = (): boolean => {
    if (defaultExpanded !== undefined) {
      return defaultExpanded
    }
    return isImportant
  }

  const [isExpanded, setIsExpanded] = React.useState(getInitialState)

  const toggleExpanded = () => {
    setIsExpanded(prev => !prev)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleExpanded()
    }
  }

  return (
    <div ref={ref} className={cn("oc-expandable-step", className)}>
      <button
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        className="oc-expandable-toggle"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse step details" : "Expand step details"}
        type="button"
      >
        {isExpanded ? (
          <ChevronDown size={16} className="oc-expandable-chevron" />
        ) : (
          <ChevronRight size={16} className="oc-expandable-chevron" />
        )}
      </button>
      <div
        className={cn(
          "oc-expandable-content",
          isExpanded ? "oc-expandable-content--expanded" : "oc-expandable-content--collapsed"
        )}
      >
        {children}
      </div>
    </div>
  )
})

ExpandableStep.displayName = "ExpandableStep"
