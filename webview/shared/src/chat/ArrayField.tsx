import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { JsonFormEditor } from './JsonFormEditor';
import type { Model } from './lib/types';

interface ArrayFieldProps {
  value: unknown[];
  path: string[];
  onChange: (path: string[], newValue: unknown) => void;
  depth: number;
  availableModels?: Model[];
}

export function ArrayField({ value, path, onChange, depth, availableModels }: ArrayFieldProps) {
  const handleAddItem = () => {
    onChange([...path, String(value.length)], '');
  };

  const handleRemoveItem = (index: number) => {
    const newArray = value.filter((_, i) => i !== index);
    onChange(path, newArray);
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= value.length) return;

    const newArray = [...value];
    [newArray[index], newArray[newIndex]] = [newArray[newIndex], newArray[index]];
    onChange(path, newArray);
  };

  const indentClass = depth > 0 ? 'ml-3 border-l border-oc-border pl-3' : '';
  const keyName = path[path.length - 1] || 'root';

  return (
    <div className={`${indentClass}`}>
      {/* Header */}
      <div className="flex items-center gap-2 py-1 px-2 -mx-2">
        <span className="text-xs font-mono text-oc-text">
          {keyName}
        </span>
        <Badge variant="outline" className="h-4 px-1 text-[9px] border-oc-border uppercase">
          array
        </Badge>
        <span className="text-xs text-oc-text-muted ml-auto">
          {value.length} {value.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Items */}
      <div className="mt-1 space-y-1">
        {value.length === 0 ? (
          <div className="text-xs text-oc-text-muted py-2 px-2 border border-dashed border-oc-border rounded">
            No items - click + to add
          </div>
        ) : (
          value.map((item, index) => (
            <div key={index} className="flex items-start gap-2 group">
              <span className="text-xs font-mono text-oc-text-muted pt-2 w-8">
                [{index}]
              </span>
              <div className="flex-1">
                <JsonFormEditor
                  value={item}
                  path={[...path, String(index)]}
                  onChange={onChange}
                  parentType="array"
                  index={index}
                  availableModels={availableModels}
                />
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleMoveItem(index, 'up')}
                  disabled={index === 0}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleMoveItem(index, 'down')}
                  disabled={index === value.length - 1}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-oc-text-muted hover:text-oc-red"
                  onClick={() => handleRemoveItem(index)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}

        {/* Add item button */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAddItem}
          className="w-full text-xs text-oc-accent hover:text-oc-accent h-7"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add item
        </Button>
      </div>
    </div>
  );
}
