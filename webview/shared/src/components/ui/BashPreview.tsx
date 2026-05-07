import * as React from "react"
import { Copy } from "lucide-react"
import { cn } from "../../utils"

export interface BashPreviewProps {
  command: string
  className?: string
  maxLength?: number
}

export const BashPreview = React.forwardRef<
  HTMLDivElement,
  BashPreviewProps
>(({ command, className, maxLength = 60 }, ref) => {
  const [copied, setCopied] = React.useState(false)

  // Don't render if command is empty
  if (!command || typeof command !== 'string') {
    return null
  }

  // Truncate command if too long
  const truncatedCommand = command.length > maxLength
    ? `${command.slice(0, maxLength - 3)}...`
    : command

  // Clean up timeout on component unmount or when copied changes
  React.useEffect(() => {
    const timeoutId = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeoutId)
  }, [copied])

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch (error) {
      console.error('Failed to copy command:', error)
    }
  }

  return (
    <div
      ref={ref}
      className={cn(
        "oc-bash-preview",
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md",
        "bg-oc-panel-soft border border-oc-border",
        "font-medium text-[10px] text-oc-text-soft",
        "hover:bg-oc-accent-soft hover:border-oc-accent/30",
        "transition-colors duration-150 cursor-pointer group",
        className
      )}
      onClick={handleCopy}
      title={`${command}${copied ? ' (Copied!)' : ' - Click to copy'}`}
    >
      <span className="oc-bash-prompt text-oc-yellow opacity-80">$</span>
      <span className="oc-bash-command truncate max-w-[280px]">
        {truncatedCommand}
      </span>
      {copied ? (
        <span className="text-oc-green text-[9px] uppercase font-semibold">
          Copied!
        </span>
      ) : (
        <span className="opacity-0 group-hover:opacity-60 transition-opacity">
          <Copy size={10} />
        </span>
      )}
    </div>
  )
})

BashPreview.displayName = "BashPreview"
