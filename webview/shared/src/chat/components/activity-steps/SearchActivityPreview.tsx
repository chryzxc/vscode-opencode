import { useState } from "react";
import { SearchBlock } from "@/components/ui/SearchBlock";
import {
  FadedCollapseOverlay,
  useFadedContentOverflow,
} from "@/components/ui/FadedCollapseOverlay";

export type SearchActivityPreviewProps = {
  title: string;
  pattern?: string;
  path?: string;
  include?: string;
  output?: string;
  outputMode?: string;
  headLimit?: number;
  patternInHeader?: boolean;
  isGlobSearch?: boolean;
};

/** The exact compact search card used by chat activity rows and subagent modals. */
export function SearchActivityPreview(props: SearchActivityPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const { ref: previewRef, hasOverflow } = useFadedContentOverflow<HTMLDivElement>(!expanded);
  const hasContent = Boolean(props.pattern || props.path || props.include || props.output || props.outputMode || props.headLimit !== undefined);
  if (!hasContent) return null;

  return (
    <div className={props.isGlobSearch ? "flex flex-col gap-1.5 max-h-64 overflow-y-auto" : "flex flex-col gap-1.5"}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="oc-timeline-surface oc-timeline-soft-frame group relative w-full overflow-hidden rounded-lg text-left transition-colors hover:bg-oc-panel-soft/50"
        aria-label={`Toggle ${props.title} details`}
      >
        <div ref={previewRef} className={expanded ? "p-1.5" : "relative max-h-[128px] overflow-hidden p-1.5"}>
          <SearchBlock className="oc-search-block--timeline-compact" pattern={props.pattern} patternInHeader={props.patternInHeader} path={props.path} include={props.include} output={props.output} outputMode={props.outputMode} headLimit={props.headLimit} />
          {!expanded && hasOverflow ? <FadedCollapseOverlay /> : null}
        </div>
      </button>
    </div>
  );
}
