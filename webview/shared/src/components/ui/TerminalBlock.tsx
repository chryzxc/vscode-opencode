import * as React from "react"
import { Copy } from "lucide-react"
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
  const [copied, setCopied] = React.useState(false)

  // Don't render if command is empty
  if (!command || typeof command !== 'string') {
    return null
  }

  // Clean up timeout on component unmount or when copied changes
  React.useEffect(() => {
    const timeoutId = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeoutId)
  }, [copied])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch (error) {
      console.error('Failed to copy command:', error)
    }
  }

  return (
    <div ref={ref} className={cn("oc-bash-command-block", className)}>
      <div className="oc-bash-command-header">
        <span className="oc-bash-prompt">$</span>
        <button
          onClick={handleCopy}
          className="oc-bash-copy-btn"
          aria-label="Copy command"
          title={copied ? "Copied!" : "Copy command"}
        >
          <Copy size={14} />
        </button>
      </div>
      <pre className="oc-bash-command-code">
        <code>{command}</code>
      </pre>
      {output && (
        <div className="oc-bash-output">
          <pre><code>{output}</code></pre>
        </div>
      )}
    </div>
  )
})

TerminalBlock.displayName = "TerminalBlock"
