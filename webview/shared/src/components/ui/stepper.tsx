import * as React from "react"
import { cn } from "@/utils"

// Stepper: outer container for all steps
const Stepper = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col", className)} {...props} />
))
Stepper.displayName = "Stepper"

// StepperItem: one row — left column (dot + line) + right content
// The vertical line is a flex-grow div below the dot, so it's never clipped
const StepperItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    isLast?: boolean
    indicator: React.ReactNode
  }
>(({ className, isLast, indicator, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-start", className)} {...props}>
    {/* Left column: dot + line below */}
    <div className="flex flex-col items-center shrink-0 mr-2.5 self-stretch">
      {/* Dot wrapper — keeps indicator centred in a fixed-size box */}
      <div className="flex h-5 w-5 shrink-0 items-center justify-center mt-[3px]">
        {indicator}
      </div>
      {/* Vertical connecting line — grows to fill remaining height */}
      {!isLast && (
        <div className="w-px flex-1 bg-neutral-500/30 mt-1 min-h-[6px]" />
      )}
    </div>

    {/* Right: main content */}
    <div className={cn("flex-1 min-w-0 pb-1.5")}>
      {children}
    </div>
  </div>
))
StepperItem.displayName = "StepperItem"

export { Stepper, StepperItem }
