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

    const notesSubtable = (schema.subtables || []).find(subtable => subtable.kind === 'notes' || subtable.data_key === 'notes');
    const notesRows = notesSubtable ? (Array.isArray(data[notesSubtable.data_key]) ? data[notesSubtable.data_key] : []) : [];
    const notesList = notesRows.map((row: Record<string, any>, index: number) => {
      const ref = String(row[notesSubtable?.note_ref_key || 'ref'] ?? index + 1);
      const text = String(row.text ?? row.note ?? row.description ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
      return `[^${ref}]: ${text}`;
    }).join('\n');
    tpl = tpl.replace(/\{\{notes_list\}\}/g, notesList);

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
      return rows.map((item, rowIndex) => {
        let row = rowTemplate.trim();
        row = row.replace(/\{\{row_number\}\}/g, String(rowIndex + 1));
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