import { MinusCircle } from "lucide-react";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ThemeFileIcon } from "../components/ThemeFileIcon";
import { toWorkspaceRelativePath } from "@/utils";

declare global {
  interface Window {
    __WALKTHROUGH_DATA__?: { raw?: string; title?: string; sourceFile?: string };
  }
}

export default function WalkthroughShell() {
  const data = window.__WALKTHROUGH_DATA__;
  const title = data?.title?.trim() || "Walkthrough";
  const sourceFile = data?.sourceFile?.trim();
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden text-oc-text">
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-4xl px-6 py-7 pb-12">
          <header className="mb-7 border-b border-oc-border pb-5">
            <h1 className="text-xl font-semibold">{title}</h1>
            {sourceFile && <div className="mt-2 flex items-center gap-1.5 text-xs text-oc-text-soft"><ThemeFileIcon filePath={sourceFile} />{toWorkspaceRelativePath(sourceFile)}</div>}
          </header>
          <section className="oc-markdown"><MarkdownRenderer content={data?.raw || ""} /></section>
          {!data?.raw?.trim() && <div className="flex items-center gap-2 text-sm text-oc-text-soft"><MinusCircle className="h-4 w-4" />No walkthrough content is available.</div>}
        </div>
      </main>
    </div>
  );
}
