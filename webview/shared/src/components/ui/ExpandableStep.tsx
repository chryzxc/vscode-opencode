import * as React from "react"
import { cn } from "@/utils"

export interface ExpandableStepProps {
  children: React.ReactNode
  className?: string
}

export const ExpandableStep = React.forwardRef<
  HTMLDivElement,
  ExpandableStepProps
>(({ children, className }, ref) => {
  return (
    <div ref={ref} className={cn("oc-expandable-step", className)}>
      {children}
    </div>
  )
})

ExpandableStep.displayName = "ExpandableStep"
