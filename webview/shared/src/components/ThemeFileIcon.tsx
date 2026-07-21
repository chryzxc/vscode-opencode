import { File, Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getFileIconFallbackKind,
  getFileIconThemeClasses,
  hasThemeIcon,
} from "./fileIcons";

/** A compact VS Code theme-aware icon for file references outside chat. */
export function ThemeFileIcon({ filePath, className = "" }: { filePath?: string; className?: string }) {
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const isDirectory = getFileIconFallbackKind({ filePath }) === "folder";
  const themeClasses = useMemo(
    () => getFileIconThemeClasses({ filePath, isDirectory }),
    [filePath, isDirectory],
  );

  useEffect(() => {
    setShowFallback(false);
    const frame = requestAnimationFrame(() => {
      if (iconRef.current && !hasThemeIcon(iconRef.current)) setShowFallback(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [filePath, themeClasses]);

  return (
    <span
      ref={iconRef}
      aria-hidden="true"
      className={["file-icon", ...themeClasses, className].filter(Boolean).join(" ")}
      style={{ display: "inline-flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
    >
      {showFallback && (isDirectory ? <Folder className="h-3.5 w-3.5" /> : <File className="h-3.5 w-3.5" />)}
    </span>
  );
}
