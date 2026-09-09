export function sanitizeForSave<T extends Record<string, any>>(data: T): T {
  const clone: Record<string, any> = JSON.parse(JSON.stringify(data));

  const sanitizeArray = (items: unknown[] = []): unknown[] =>
    items.filter(item => {
      if (!item || typeof item !== 'object') return false;
      return Object.values(item as Record<string, unknown>).some(value => {
        if (value === null || value === undefined) return false;
        return String(value).trim() !== '';
      });
    });

  if (Array.isArray(clone.items)) {
    clone.items = sanitizeArray(clone.items);
  }

  Object.keys(clone).forEach(key => {
    const value = clone[key];
    if (Array.isArray(value) && key !== 'items') {
      clone[key] = sanitizeArray(value);
    }
  });

  return clone as T;
}
