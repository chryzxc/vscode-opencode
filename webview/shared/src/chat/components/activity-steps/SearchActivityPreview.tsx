import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SearchBlock } from "@/components/ui/SearchBlock";

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
        <div className={expanded ? "p-1.5" : "relative max-h-[128px] overflow-hidden p-1.5"}>
          <SearchBlock className="oc-search-block--timeline-compact" pattern={props.pattern} patternInHeader={props.patternInHeader} path={props.path} include={props.include} output={props.output} outputMode={props.outputMode} headLimit={props.headLimit} />
          {!expanded ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-oc-bg-soft via-oc-bg-soft/88 to-transparent" /> : null}
        </div>
        <div className="oc-timeline-caret pointer-events-none absolute bottom-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full"><ChevronDown className={expanded ? "h-3 w-3 rotate-180 oc-text-secondary" : "h-3 w-3 oc-text-secondary"} /></div>
      </button>
    </div>
  );
}
