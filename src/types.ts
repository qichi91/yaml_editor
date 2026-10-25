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
  default?: string;
}

export interface HeaderConfig {
  key: string;
  label: string;
  type?: 'string' | 'multiline';
  required?: boolean;
  pattern?: string;
  pattern_error?: string;
}

export interface TableSchema {
  schema_id: string;
  schema_version: string;
  title: string;
  headers?: HeaderConfig[];
  header_layout?: 'horizontal' | 'vertical';
  columns: ColumnConfig[];
  subtables?: SubtableConfig[];
  markdown_template: string;
  row_number_width?: number;
  scenario_heading?: ScenarioHeadingConfig;
}

export interface ScenarioHeadingConfig {
  label?: string;
  markdown_level?: number;
}

export interface SubtableConfig {
  data_key: string;
  title: string;
  columns: ColumnConfig[];
  kind?: 'default' | 'notes';
  note_ref_key?: string;
  row_number_width?: number;
  scenario_heading?: ScenarioHeadingConfig;
}

export interface SpecData {
  schema: string;
  [key: string]: any;
  items: Array<Record<string, any>>;
}