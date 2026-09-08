import { TableSchema, SpecData } from './types';

export class MarkdownGenerator {
  public static generate(data: SpecData, schema: TableSchema): string {
    const cols = schema.columns || [];
    const items = data.items || [];

    const headerRow = cols.map(c => c.label).join(' | ');
    const sepRow = cols.map(c => (c.align === 'center' ? ':---:' : c.align === 'right' ? '---:' : ':---')).join(' | ');

    let tpl = schema.markdown_template || '';
    tpl = tpl.replace(/\{\{title\}\}/g, schema.title);
    tpl = tpl.replace(/\{\{header_row\}\}/g, headerRow);
    tpl = tpl.replace(/\{\{separator_row\}\}/g, sepRow);
    (schema.subtables || []).forEach(subtable => {
      const title = subtable.title || '';
      tpl = tpl.replace(new RegExp(`\\{\\{${subtable.data_key}_title\\}\\}`, 'g'), () => title);
      tpl = tpl.replace(
        new RegExp(`\\{\\{subtable_title:${subtable.data_key}\\}\\}`, 'g'),
        () => title
      );
    });

    // ヘッダー共通項目の置換
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'items' && key !== 'schema') {
        tpl = tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), (value ?? '').toString());
      }
    }

    // メインテーブルとサブテーブルの行ブロックを置換
    const rowBlocks = /\{\{#([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
    tpl = tpl.replace(rowBlocks, (_match, dataKey: string, rowTemplate: string) => {
      const rows = dataKey === 'items'
        ? items
        : (Array.isArray(data[dataKey]) ? data[dataKey] : []);
      const columns = dataKey === 'items'
        ? cols
        : (schema.subtables?.find(subtable => subtable.data_key === dataKey)?.columns || []);
      return rows.map(item => {
        let row = rowTemplate.trim();
        columns.forEach(column => {
          let value = (item[column.key] ?? '').toString();
          value = value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
          row = row.replace(new RegExp(`\\{\\{${column.key}\\}\\}`, 'g'), value);
        });
        return row;
      }).join('\n');
    });

    return tpl;
  }
}