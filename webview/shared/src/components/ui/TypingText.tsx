import * as React from "react"
import { cn } from "@/utils"

export interface TypingTextProps {
  children: string
  isTyping?: boolean
  className?: string
}

export const TypingText = React.forwardRef<
  HTMLSpanElement,
  TypingTextProps
>(({ children, isTyping = true, className }, ref) => {
  // Calculate duration based on text length (30ms per char, min 800ms, max 1500ms)
  const duration = Math.min(1500, Math.max(800, children.length * 30))

  return (
    <span
      ref={ref}
      className={cn(
        "oc-typing-text",
        isTyping && "oc-typing-text--typing",
        className
      )}
      style={{ animationDuration: `${duration}ms` }}
    >
      {children}
    </span>
  )
})

TypingText.displayName = "TypingText"
