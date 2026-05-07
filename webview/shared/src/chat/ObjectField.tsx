import { ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { JsonFormEditor } from './JsonFormEditor';
import type { Model } from './lib/types';

interface ObjectFieldProps {
  value: Record<string, unknown>;
  path: string[];
  onChange: (path: string[], newValue: unknown) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  depth: number;
  availableModels?: Model[];
}

export function ObjectField({
  value,
  path,
  onChange,
  isExpanded,
  onToggleExpanded,
  depth,
  availableModels
}: ObjectFieldProps) {
  const [newKey, setNewKey] = useState('');

  const handleAddField = () => {
    if (!newKey.trim() || newKey in value) return;
    onChange([...path, newKey], '');
    setNewKey('');
  };

  const handleRemoveField = (key: string) => {
    const { [key]: removed, ...rest } = value;
    onChange(path, rest);
  };

  const entries = Object.entries(value);
  const indentClass = depth > 0 ? 'ml-3 border-l border-oc-border pl-3' : '';

  return (
    <div className={`${indentClass}`}>
      {/* Header */}
      <div
        onClick={onToggleExpanded}
        className="flex items-center gap-2 cursor-pointer py-1 hover:bg-oc-accent-soft/5 rounded px-2 -mx-2"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-oc-text-muted" />
        ) : (
          <ChevronRight className="h-3 w-3 text-oc-text-muted" />
        )}
        <span className="text-xs font-medium text-oc-text">
          {path[path.length - 1] || 'root'}
        </span>
        <Badge variant="outline" className="h-4 px-1 text-[9px] border-oc-border uppercase">
          object
        </Badge>
        <span className="text-xs text-oc-text-muted ml-auto">
          {entries.length} {entries.length === 1 ? 'field' : 'fields'}
        </span>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="mt-1 space-y-1">
          {entries.length === 0 ? (
            <div className="text-xs text-oc-text-muted py-2 px-2 border border-dashed border-oc-border rounded">
              No fields - click + to add
            </div>
          ) : (
            entries.map(([key, val]) => (
              <div key={key} className="flex items-start gap-2 group">
                <div className="flex-1">
                  <JsonFormEditor
                    value={val}
                    path={[...path, key]}
                    onChange={onChange}
                    parentType="object"
                    availableModels={availableModels}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-oc-text-muted hover:text-oc-red opacity-0 group-hover:opacity-100"
                  onClick={() => handleRemoveField(key)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}

          {/* Add new field */}
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddField()}
              placeholder="new field name..."
              className="flex-1 h-7 text-xs font-medium border border-oc-border rounded px-2"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleAddField}
              className="h-7 w-7 text-oc-accent hover:text-oc-accent"
              disabled={!newKey.trim() || newKey in value}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
