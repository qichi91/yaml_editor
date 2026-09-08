export interface ColumnConfig {
  key: string;
  label: string;
  width?: number;
  type?: 'string' | 'multiline' | 'select';
  options?: string[];
  options_strict?: boolean;
  required?: boolean;
  pattern?: string;
  pattern_error?: string;
  align?: 'left' | 'center' | 'right';
}

export interface HeaderConfig {
  key: string;
  label: string;
  required?: boolean;
}

export interface TableSchema {
  schema_id: string;
  schema_version: string;
  title: string;
  headers?: HeaderConfig[];
  columns: ColumnConfig[];
  subtables?: SubtableConfig[];
  markdown_template: string;
}

export interface SubtableConfig {
  data_key: string;
  title: string;
  columns: ColumnConfig[];
}

export interface SpecData {
  schema: string;
  [key: string]: any;
  items: Array<Record<string, any>>;
}