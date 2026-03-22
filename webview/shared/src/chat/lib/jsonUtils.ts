/**
 * Immutable update function for nested data structures
 * @param obj - The root object/array/primitive to update
 * @param path - Array of keys/indices to traverse (e.g., ['api', 'timeout'])
 * @param value - New value to set at the path
 * @returns New object with updated value (original is not mutated)
 */
export function updateAt(obj: unknown, path: string[], value: unknown): unknown {
  // Base case: empty path means we're at the target
  if (path.length === 0) {
    return value;
  }

  const [key, ...rest] = path;

  // Handle array updates
  if (Array.isArray(obj)) {
    const index = Number(key);
    if (index < 0 || index >= obj.length || !Number.isInteger(index)) {
      return obj; // Invalid index, return unchanged
    }
    const copy = [...obj];
    copy[index] = rest.length === 0 ? value : updateAt(copy[index], rest, value);
    return copy;
  }

  // Handle object updates
  if (typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>;
    const newValue = rest.length === 0 ? value : updateAt(record[key], rest, value);
    return { ...record, [key]: newValue };
  }

  // Trying to update a primitive - return value (edge case)
  return value;
}

/**
 * Get the type of a JSON value
 */
export function getValueType(value: unknown): 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  if (type === 'object') return 'object';
  return 'object'; // fallback
}

/**
 * Detect cyclic references in an object
 * @returns true if cycles detected
 */
export function detectCycles(obj: unknown): boolean {
  const seen = new WeakSet();
  const traverse = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    if (seen.has(value as object)) return true;
    seen.add(value as object);
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (traverse(v)) return true;
    }
    return false;
  };
  return traverse(obj);
}
