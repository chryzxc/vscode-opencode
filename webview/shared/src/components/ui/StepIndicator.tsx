import * as React from "react"
import { Check, X, Loader2 } from "lucide-react"
import { cn } from "@/utils"

export interface StepIndicatorProps {
  status: 'pending' | 'done' | 'error' | 'running'
  className?: string
}

export const StepIndicator = React.forwardRef<
  HTMLDivElement,
  StepIndicatorProps
>(({ status, className }, ref) => {
  const renderIndicator = () => {
    switch (status) {
      case 'pending':
        return (
          <div className="oc-step-indicator-pending animate-pulse" />
        )
      case 'done':
        return <Check size={14} className="oc-step-indicator-done" />
      case 'error':
        return <X size={14} className="oc-step-indicator-error" />
      case 'running':
        return <Loader2 size={14} className="oc-step-indicator-running animate-spin" />
      default:
        return null
    }
  }

  return (
    <div
      ref={ref}
      className={cn(
        "oc-step-indicator",
        `oc-step-indicator--${status}`,
        className
      )}
      aria-label={`Step status: ${status}`}
      role="status"
    >
      {renderIndicator()}
    </div>
  )
})

StepIndicator.displayName = "StepIndicator"
