# JSON Form Editor Components

## Overview

Recursive JSON-to-form editor that supports nested objects, arrays, and primitives.

## Components

### JsonFormEditor

Main recursive component that dispatches to appropriate field renderer based on value type.

```tsx
<JsonFormEditor
  value={configData}
  onChange={(path, newValue) => {
    const updated = updateAt(configData, path, newValue);
    setConfigData(updated);
  }}
/>
```

**Props:**
- `value`: unknown - The JSON value to edit
- `path`: string[] - Field path from root
- `onChange`: (path: string[], newValue: unknown) => void - Callback for value changes
- `parentType?`: 'object' | 'array' - Parent container type
- `index?`: number - Array index if parent is array

### PrimitiveField

Renders inputs for string, number, boolean, and null values with type conversion.

**Features:**
- String/Number: Text input with type selector dropdown
- Boolean: Toggle switch with "Convert" button
- Null: Badge display with "Reset" button
- Type conversion: Seamlessly convert between types

### ObjectField

Renders nested objects as collapsible accordion sections with add/remove field support.

**Features:**
- Expandable/collapsible sections with chevron icons
- Field count display
- Add new fields with Enter key support
- Remove fields on hover
- Empty state message

### ArrayField

Renders arrays with numbered items, add/remove/move controls.

**Features:**
- Numbered items (e.g., [0], [1])
- Add items with + button
- Remove items on hover
- Move up/down arrows for reordering
- Empty state message

## Utilities

### updateAt(obj, path, value)

Immutable update function for nested structures.

```typescript
import { updateAt } from './chat/lib/jsonUtils';

const config = { api: { timeout: 30 } };
const updated = updateAt(config, ['api', 'timeout'], 60);
// { api: { timeout: 60 } }
```

### getValueType(value)

Get JSON type of a value.

```typescript
import { getValueType } from './chat/lib/jsonUtils';

getValueType('hello') // 'string'
getValueType(42) // 'number'
getValueType([1, 2]) // 'array'
getValueType(null) // 'null'
```

### detectCycles(obj)

Detect circular references in objects.

```typescript
import { detectCycles } from './chat/lib/jsonUtils';

const obj = {};
obj.self = obj;
detectCycles(obj) // true
```

## Usage Example

```typescript
import { JsonFormEditor, updateAt } from './chat/JsonFormEditor';
import { useState } from 'react';

function ConfigEditor() {
  const [config, setConfig] = useState({ api: { timeout: 30 } });

  const handleChange = (path: string[], newValue: unknown) => {
    setConfig(updateAt(config, path, newValue) as typeof config);
  };

  return (
    <JsonFormEditor
      value={config}
      onChange={handleChange}
    />
  );
}
```

## Integration

The JsonFormEditor is integrated into ConfigEditor with three tabs:

1. **Simple**: Original GUI for top-level primitives only
2. **Advanced**: Full-featured JSON editor with nested structure support
3. **JSON / JSONC**: Raw JSON editor

## Design Patterns

- **Recursive Components**: Each value type has its own component
- **Immutable Updates**: All changes flow upward via path-based updates
- **Type Safety**: Full TypeScript support with proper type guards
- **Defensive Programming**: Validation for large configs, invalid numbers, cycles
