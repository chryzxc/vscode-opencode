import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/utils";

type FadedCollapseOverlayProps = {
  /** Action label shared by all shortened-content surfaces. */
  label?: string;
  /** Makes the centered affordance interactive when the preview owns expansion. */
  onClick?: () => void;
  /** Lets a preview fade into its own surface background. */
  backgroundClassName?: string;
};

/** Reports whether a max-height preview is actually hiding content. */
export function useFadedContentOverflow<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) {
      setHasOverflow(false);
      return;
    }

    const update = () => {
      const next = element.scrollHeight > element.clientHeight + 1;
      setHasOverflow((current) => (current === next ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, hasOverflow };
}

/**
 * Standard bottom fade and centered affordance for shortened chat content.
 * Parent previews control the expanded state; this component only provides
 * the consistent visual treatment and optional expand action.
 */
export function FadedCollapseOverlay({
  label = "Show full",
  onClick,
  backgroundClassName = "from-oc-bg-soft via-oc-bg-soft/90 to-transparent",
}: FadedCollapseOverlayProps) {
  const contents = (
    <>
      <ChevronDown className="h-3 w-3" />
      <span>{label}</span>
    </>
  );

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t pb-2",
        backgroundClassName,
      )}
    >
      {onClick ? (
        <button
          type="button"
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-oc-border-soft bg-oc-bg-soft px-2 py-0.5 text-[10px] text-oc-text-soft shadow-sm transition-colors hover:text-oc-text"
          onClick={onClick}
          aria-label={label}
        >
          {contents}
        </button>
      ) : (
        <div className="inline-flex items-center gap-1 rounded-full border border-oc-border-soft bg-oc-bg-soft px-2 py-0.5 text-[10px] text-oc-text-soft shadow-sm">
          {contents}
        </div>
      )}
    </div>
  );
}
