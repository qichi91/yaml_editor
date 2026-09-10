import { ColumnConfig } from './types';

// 値が「空」とみなせるか判定（列の初期値と同じ場合も未入力扱いにする）
function isBlankValue(value: unknown, defaultValue?: string): boolean {
  if (value === null || value === undefined) return true;
  const str = String(value).trim();
  if (str === '') return true;
  return defaultValue !== undefined && str === defaultValue.trim();
}

export function sanitizeForSave<T extends Record<string, any>>(
  data: T,
  columnsByKey: Record<string, ColumnConfig[]> = {}
): T {
  const clone: Record<string, any> = JSON.parse(JSON.stringify(data));

  const sanitizeArray = (items: unknown[] = [], columns?: ColumnConfig[]): unknown[] => {
    const defaultsByKey = new Map((columns || []).map(col => [col.key, col.default]));
    return items.filter(item => {
      if (!item || typeof item !== 'object') return false;
      return Object.entries(item as Record<string, unknown>).some(([key, value]) =>
        !isBlankValue(value, defaultsByKey.get(key))
      );
    });
  };

  if (Array.isArray(clone.items)) {
    clone.items = sanitizeArray(clone.items, columnsByKey.items);
  }

  Object.keys(clone).forEach(key => {
    const value = clone[key];
    if (Array.isArray(value) && key !== 'items') {
      clone[key] = sanitizeArray(value, columnsByKey[key]);
    }
  });

  return clone as T;
}
