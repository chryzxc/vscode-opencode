import { FileText, ExternalLink, AlertTriangle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ConfigFile } from './lib/types';
import { JsonFormEditor } from './JsonFormEditor';

interface ConfigEditorProps {
  file: ConfigFile & { isDirty: boolean };
  activeTab: 'gui' | 'json' | 'advanced';
  onTabChange: (tab: 'gui' | 'json' | 'advanced') => void;
  onContentChange: (content: string) => void;
}

export function ConfigEditor({ file, activeTab, onTabChange, onContentChange }: ConfigEditorProps) {
  const parseResult = tryParseConfigContent(file.content);
  const rootConfig = parseResult.ok && isPlainRecord(parseResult.value) ? parseResult.value : null;

  const primitiveEntries = rootConfig
    ? Object.entries(rootConfig)
        .filter(([, value]) => isConfigPrimitive(value))
        .map(([key, value]) => [key, value] as [string, typeof value])
        .sort(([left], [right]) => left.localeCompare(right))
    : [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-oc-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-oc-accent" />
          <span className="text-sm font-medium">{file.name}</span>
          {file.isDirty && (
            <Badge variant="outline" className="h-5 px-1.5 text-xs border-oc-yellow/40 text-oc-yellow">
              Unsaved
            </Badge>
          )}
        </div>
        <a
          href="https://opencode.ai/docs/config/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-oc-accent hover:underline flex items-center gap-1"
        >
          Docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as 'gui' | 'json' | 'advanced')} className="flex-1 flex flex-col">
        <div className="border-b border-oc-border px-4">
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="gui" className="text-xs">Simple</TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs">Advanced</TabsTrigger>
            <TabsTrigger value="json" className="text-xs font-medium">JSON / JSONC</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="gui" className="flex-1 overflow-auto p-4">
          <GuiEditor
            content={file.content}
            onChange={onContentChange}
            rootConfig={rootConfig}
            primitiveEntries={primitiveEntries}
          />
        </TabsContent>

        <TabsContent value="advanced" className="flex-1 overflow-auto p-4">
          <AdvancedFormEditor
            content={file.content}
            onChange={onContentChange}
          />
        </TabsContent>

        <TabsContent value="json" className="flex-1 overflow-auto p-4">
          <JsonEditor
            content={file.content}
            onChange={onContentChange}
            parseResult={parseResult}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// GUI Editor component for primitive top-level keys
function GuiEditor({
  content,
  onChange,
  rootConfig,
  primitiveEntries,
}: {
  content: string;
  onChange: (content: string) => void;
  rootConfig: Record<string, unknown> | null;
  primitiveEntries: Array<[string, unknown]>;
}) {
  const updatePrimitiveValue = (key: string, rawValue: string | boolean) => {
    if (!rootConfig) return;

    const current = rootConfig[key];
    if (!isConfigPrimitive(current)) return;

    let nextValue: typeof current;
    if (typeof current === 'boolean') {
      nextValue = typeof rawValue === 'boolean' ? rawValue : rawValue.toLowerCase() === 'true';
    } else if (typeof current === 'number') {
      const parsedNumber = Number(rawValue);
      if (!Number.isFinite(parsedNumber)) return;
      nextValue = parsedNumber;
    } else if (current === null) {
      const text = String(rawValue);
      nextValue = text.trim().length === 0 ? null : text;
    } else {
      nextValue = String(rawValue);
    }

    const draft: Record<string, unknown> = { ...rootConfig };
    draft[key] = nextValue;
    onChange(formatConfigContent(draft));
  };

  const removeKey = (key: string) => {
    if (!rootConfig) return;
    const draft: Record<string, unknown> = { ...rootConfig };
    delete draft[key];
    onChange(formatConfigContent(draft));
  };

  return (
    <div className="space-y-4">
      <div className="text-xs oc-text-secondary p-3 rounded border border-oc-border bg-oc-bg-soft">
        GUI mode edits top-level primitive keys only. Use Advanced tab for nested objects/arrays, or JSON tab for complex edits.
      </div>

      {!rootConfig ? (
        <div className="h-full rounded-md border border-oc-red/30 bg-oc-red/10 p-3 text-xs text-oc-red space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              GUI mode works only when the config is a valid top-level object.
              Fix JSON in the JSON tab first.
            </span>
          </div>
        </div>
      ) : (
        <>
          {primitiveEntries.length === 0 ? (
            <div className="rounded-md border border-dashed border-oc-border p-3 text-xs oc-text-secondary">
              No primitive top-level keys found. Use JSON tab for editing.
            </div>
          ) : (
            <div className="space-y-2">
              {primitiveEntries.map(([key, value]) => (
                <div key={key} className="rounded-md border border-oc-border bg-oc-bg-soft p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-oc-text">{key}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[9px] border-oc-border uppercase">
                      {value === null ? 'null' : typeof value}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {typeof value === 'boolean' ? (
                      <div className="flex flex-1 items-center gap-2">
                        <span className="text-xs oc-text-secondary">
                          {value ? 'true' : 'false'}
                        </span>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={value === null ? '' : String(value)}
                        onChange={(e) => updatePrimitiveValue(key, e.target.value)}
                        className="flex-1 h-8 text-xs font-medium rounded border border-oc-border bg-oc-bg px-2"
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 oc-text-secondary hover:text-oc-red"
                      onClick={() => removeKey(key)}
                      title={`Remove ${key}`}
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Advanced GUI Editor component with full JSON structure support
function AdvancedFormEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (content: string) => void;
}) {
  const parseResult = tryParseConfigContent(content);

  if (!parseResult.ok) {
    return (
      <div className="h-full rounded-md border border-oc-red/30 bg-oc-red/10 p-3 text-xs text-oc-red space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Advanced GUI mode requires valid JSON. Fix JSON in the JSON tab first.
          </span>
        </div>
      </div>
    );
  }

  const rootConfig = parseResult.value;
  if (!isPlainRecord(rootConfig)) {
    return (
      <div className="h-full rounded-md border border-oc-yellow/30 bg-oc-yellow/10 p-3 text-xs text-oc-yellow space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Advanced GUI mode works with JSON objects. Use JSON tab for other types.
          </span>
        </div>
      </div>
    );
  }

  const handleChange = (path: string[], newValue: unknown) => {
    const updated = updateAt(rootConfig, path, newValue);
    onChange(formatConfigContent(updated));
  };

  return (
    <div className="space-y-2">
      <div className="text-xs oc-text-secondary p-3 rounded border border-oc-border bg-oc-bg-soft">
        Advanced GUI mode: Edit nested objects, arrays, and primitives. Full JSON structure support.
      </div>
      <JsonFormEditor
        value={rootConfig}
        path={[]}
        onChange={handleChange}
      />
    </div>
  );
}

// Helper function for immutable updates
function updateAt(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = [...obj];
    copy[Number(key)] = rest.length === 0 ? value : updateAt(copy[Number(key)], rest, value);
    return copy;
  } else if (typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>;
    return { ...record, [key]: rest.length === 0 ? value : updateAt(record[key], rest, value) };
  }
  return value;
}

// JSON Editor component
function JsonEditor({
  content,
  onChange,
  parseResult,
}: {
  content: string;
  onChange: (content: string) => void;
  parseResult: ReturnType<typeof tryParseConfigContent>;
}) {
  return (
    <div className="h-full flex flex-col space-y-3">
      <Textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 w-full resize-none font-medium text-xs leading-relaxed p-4 bg-oc-bg-soft border-oc-border focus-visible:ring-1 focus-visible:ring-oc-accent"
        spellCheck={false}
        placeholder='{ "default_model": "provider/model" }'
      />
      {!parseResult.ok && (
        <div className="rounded-md border border-oc-yellow/30 bg-oc-yellow/10 text-oc-yellow text-xs p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{parseResult.error}</span>
        </div>
      )}
    </div>
  );
}

// Helper functions (imported from PanelComponents utilities)
function tryParseConfigContent(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConfigPrimitive(value: unknown): value is string | number | boolean | null {
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' || value === null;
}

function formatConfigContent(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

