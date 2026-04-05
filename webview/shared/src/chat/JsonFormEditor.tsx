import { useState, useEffect } from 'react';
import { getValueType } from './lib/jsonUtils';
import { PrimitiveField } from './PrimitiveField';
import { ObjectField } from './ObjectField';
import { ArrayField } from './ArrayField';
import type { Model } from './lib/types';
import logger from './lib/logger';

interface JsonFormEditorProps {
  value: unknown;
  path: string[];
  onChange: (path: string[], newValue: unknown) => void;
  parentType?: 'object' | 'array';
  index?: number;
  availableModels?: Model[];
}

export function JsonFormEditor({
  value,
  path,
  onChange,
  parentType,
  index,
  availableModels
}: JsonFormEditorProps) {
  const [isExpanded, setIsExpanded] = useState(path.length === 0);

  // Warn for large configs
  useEffect(() => {
    const jsonString = JSON.stringify(value);
    if (jsonString.length > 100_000) { // 100KB
      logger.warn('Large config detected, performance may be impacted', { size: jsonString.length });
    }
  }, [value]);

  const type = getValueType(value);

  // Render primitive values
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'null') {
    // Get the field key (last element of path) for model dropdown detection
    const fieldKey = path.length > 0 ? path[path.length - 1] : undefined;
    return (
      <PrimitiveField
        value={value as string | number | boolean | null}
        path={path}
        onChange={onChange}
        type={type}
        fieldKey={fieldKey}
        availableModels={availableModels}
      />
    );
  }

  // Render objects
  if (type === 'object') {
    return (
      <ObjectField
        value={value as Record<string, unknown>}
        path={path}
        onChange={onChange}
        isExpanded={isExpanded}
        onToggleExpanded={() => setIsExpanded(!isExpanded)}
        depth={path.length}
        availableModels={availableModels}
      />
    );
  }

  // Render arrays
  if (type === 'array') {
    return (
      <ArrayField
        value={value as unknown[]}
        path={path}
        onChange={onChange}
        depth={path.length}
        availableModels={availableModels}
      />
    );
  }

  return null;
}
