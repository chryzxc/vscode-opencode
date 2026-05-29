import * as React from "react"
import { cn } from "../../utils"

export interface TerminalBlockProps {
  command: string
  output?: string
  className?: string
}

export const TerminalBlock = React.forwardRef<
  HTMLDivElement,
  TerminalBlockProps
>(({ command, output, className }, ref) => {
  // Don't render if command is empty
  if (!command || typeof command !== 'string') {
    return null
  }

  return (
    <div ref={ref} className={cn("oc-bash-command-block", className)}>
      <div className="oc-bash-command-code">
        <span className="oc-bash-inline-prompt" aria-hidden="true">$</span>
        <code title={command}>{command}</code>
      </div>
      {output && (
        <div className="oc-bash-output">
          <pre><code>{output}</code></pre>
        </div>
      )}
    </div>
  )
})

TerminalBlock.displayName = "TerminalBlock"
