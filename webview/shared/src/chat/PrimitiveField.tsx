import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Model } from './lib/types';

interface PrimitiveFieldProps {
  value: string | number | boolean | null;
  path: string[];
  onChange: (path: string[], newValue: unknown) => void;
  type: 'string' | 'number' | 'boolean' | 'null';
  fieldKey?: string;
  availableModels?: Model[];
}

export function PrimitiveField({ value, path, onChange, type, fieldKey, availableModels }: PrimitiveFieldProps) {
  const handleChange = (newValue: unknown) => {
    onChange(path, newValue);
  };

  const handleTypeChange = (newType: string) => {
    let convertedValue: unknown;
    switch (newType) {
      case 'string':
        convertedValue = String(value ?? '');
        break;
      case 'number':
        const num = Number(value);
        convertedValue = Number.isNaN(num) ? 0 : num;
        break;
      case 'boolean':
        if (typeof value === 'string') {
          convertedValue = value.toLowerCase() === 'true';
        } else {
          convertedValue = Boolean(value);
        }
        break;
      case 'null':
        convertedValue = null;
        break;
      default:
        return;
    }
    onChange(path, convertedValue);
  };

  if (type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(checked) => handleChange(checked)}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => handleTypeChange('string')}
          className="text-xs h-6 px-2"
        >
          Convert
        </Button>
      </div>
    );
  }

  if (type === 'null') {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-oc-text-muted">
          null
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => handleChange('')}
          className="text-xs text-oc-accent h-6 px-2"
        >
          Reset
        </Button>
      </div>
    );
  }

  // Check if this is a model field (key contains "model" case-insensitive)
  const isModelField = fieldKey && /model/i.test(fieldKey);
  const stringValue = String(value ?? '');

  // For model fields, render a dropdown with available models
  if (isModelField && type === 'string' && availableModels && availableModels.length > 0) {
    // Format models as "providerID/modelID"
    const modelOptions = availableModels.map(
      (model) => `${model.providerID}/${model.modelID}`
    );

    return (
      <div className="flex items-center gap-2 flex-1">
        <select
          value={stringValue}
          onChange={(e) => handleChange(e.target.value)}
          className="flex-1 h-8 text-xs font-medium border border-oc-border rounded px-2 bg-oc-bg"
        >
          <option value="">Select a model...</option>
          {modelOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="h-8 text-xs border border-oc-border rounded px-2 bg-background"
        >
          <option value="string">str</option>
          <option value="number">num</option>
          <option value="boolean">bool</option>
          <option value="null">null</option>
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-1">
      <Input
        type={type === 'number' ? 'number' : 'text'}
        value={stringValue}
        onChange={(e) => {
          if (type === 'number') {
            const inputValue = e.target.value;
            // Allow empty input (user is typing)
            if (inputValue.trim() === '') {
              handleChange('');
              return;
            }
            const num = Number(inputValue);
            // Only update if it's a valid number
            if (!Number.isNaN(num)) {
              handleChange(num);
            }
            // If NaN, don't update (keep previous valid value)
          } else {
            handleChange(e.target.value);
          }
        }}
        className="flex-1 h-8 text-xs font-medium"
        step={type === 'number' ? 1 : undefined}
      />
      <select
        value={type}
        onChange={(e) => handleTypeChange(e.target.value)}
        className="h-8 text-xs border border-oc-border rounded px-2 bg-background"
      >
        <option value="string">str</option>
        <option value="number">num</option>
        <option value="boolean">bool</option>
        <option value="null">null</option>
      </select>
    </div>
  );
}
