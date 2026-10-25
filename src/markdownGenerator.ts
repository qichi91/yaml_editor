import { TableSchema, SpecData } from './types';

// 「3」「3-1」のような階層番号をitemの_indent（0=親, 1=子, ...）から算出する（editor.jsと同じロジック）
function computeHierarchicalNumbers(items: Array<Record<string, any>>): string[] {
  const counters: number[] = [];
  return items.map(item => {
    const raw = Math.max(0, Number(item && item._indent) || 0);
    const level = Math.min(raw, counters.length);
    while (counters.length <= level) counters.push(0);
    counters[level] += 1;
    counters.length = level + 1;
    return counters.join('-');
  });
}

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

    const basicInfo = Array.isArray(data.basic_info) ? data.basic_info as Array<Record<string, any>> : [];
    const basicInfoValues = new Map<string, string>();
    basicInfo.forEach(row => {
      const label = String(row.label ?? '');
      if (label && !basicInfoValues.has(label)) {
        basicInfoValues.set(label, String(row.value ?? ''));
      }
    });
    tpl = tpl.replace(/\{\{basic_info:([^{}]+)\}\}/g, (_match, label: string) => {
      const value = basicInfoValues.get(label) ?? '';
      return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    });

    // ヘッダー共通項目の置換
    const headerKeys = new Set((schema.headers || []).map(header => header.key));
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'items' && key !== 'schema') {
        let text = (value ?? '').toString();
        if (headerKeys.has(key)) {
          text = text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
        }
        tpl = tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), text);
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
      const scenarioHeading = dataKey === 'items'
        ? schema.scenario_heading
        : schema.subtables?.find(subtable => subtable.data_key === dataKey)?.scenario_heading;
      const rowNumbers = computeHierarchicalNumbers(rows);
      return rows.map((item, rowIndex) => {
        let row = rowTemplate.trim();
        row = row.replace(/\{\{row_number\}\}/g, rowNumbers[rowIndex]);
        columns.forEach(column => {
          let value = (item[column.key] ?? '').toString();
          value = value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
          row = row.replace(new RegExp(`\\{\\{${column.key}\\}\\}`, 'g'), value);
        });
        if (scenarioHeading) {
          const baseHeadingLevel = Math.min(6, Math.max(1, scenarioHeading.markdown_level || 3));
          const hierarchyLevel = rowNumbers[rowIndex].split('-').length - 1;
          const headingLevel = Math.min(6, baseHeadingLevel + hierarchyLevel);
          const headingLabel = scenarioHeading.label || 'シナリオ';
          row = `${'#'.repeat(headingLevel)} ${headingLabel}${rowNumbers[rowIndex]}\n\n${row}`;
        }
        return row;
      }).join('\n');
    });

    return tpl;
  }
}