const vscode = acquireVsCodeApi();

let schema = null;
let currentData = { schema: '', items: [] };
let availableSchemas = [];

let isMouseDown = false;
let selectionStart = null;
let selectionEnd = null;
let activeCell = { row: 0, col: 0 };
let isEditing = false;

function validateCell(colIndex, value) {
  if (!schema || !schema.columns[colIndex]) return { valid: true };
  const conf = schema.columns[colIndex];
  const val = (value || '').toString().trim();

  if (conf.required && val === '') {
    return { valid: false, message: `${conf.label} は必須項目です` };
  }
  if (val === '') return { valid: true };

  if (conf.type === 'select' && conf.options_strict && conf.options) {
    if (!conf.options.includes(val)) {
      return { valid: false, message: `無効な値です: "${val}"\n選択肢: ${conf.options.join(', ')}` };
    }
  }

  if (conf.pattern) {
    const reg = new RegExp(conf.pattern);
    if (!reg.test(val)) {
      return { valid: false, message: conf.pattern_error || `形式が不正です (${conf.pattern})` };
    }
  }
  return { valid: true };
}

function setupStructure() {
  if (!schema) return;

  const headContainer = document.getElementById('header-container');
  headContainer.innerHTML = '';

  // スキーマ選択プルダウン
  const schemaLabel = document.createElement('label');
  schemaLabel.textContent = '使用スキーマ:';
  const schemaSelect = document.createElement('select');
  availableSchemas.forEach(sId => {
    const opt = document.createElement('option');
    opt.value = sId;
    opt.textContent = sId;
    if (sId === currentData.schema) opt.selected = true;
    schemaSelect.appendChild(opt);
  });
  schemaSelect.addEventListener('change', () => {
    currentData.schema = schemaSelect.value;
    notifyChange();
  });
  schemaLabel.appendChild(schemaSelect);
  headContainer.appendChild(schemaLabel);

  // 定義ファイル固有のヘッダー項目
  (schema.headers || []).forEach(h => {
    const label = document.createElement('label');
    label.textContent = h.label + ':';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentData[h.key] || '';
    input.addEventListener('input', () => {
      currentData[h.key] = input.value;
      notifyChange();
    });
    label.appendChild(input);
    headContainer.appendChild(label);
  });

  // テーブルヘッダー
  const thead = document.getElementById('table-head');
  thead.innerHTML = '';
  const tr = document.createElement('tr');
  const thNum = document.createElement('th');
  thNum.style.width = '32px';
  thNum.textContent = '#';
  tr.appendChild(thNum);

  schema.columns.forEach(col => {
    const th = document.createElement('th');
    if (col.width) th.style.width = col.width + 'px';
    th.textContent = col.label;
    tr.appendChild(th);
  });
  thead.appendChild(tr);

  renderRows();
  renderSubtables();
}

function renderRows() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  const displayItems = [...(currentData.items || []), createEmptyRow()];

  displayItems.forEach((item, rowIndex) => {
    const isLastRow = (rowIndex === displayItems.length - 1);
    const tr = document.createElement('tr');
    if (isLastRow) tr.className = 'placeholder-row';

    const tdNum = document.createElement('td');
    tdNum.className = 'row-num';
    tdNum.textContent = isLastRow ? '*' : (rowIndex + 1);
    tr.appendChild(tdNum);

    schema.columns.forEach((colConf, colIndex) => {
      const td = document.createElement('td');
      td.dataset.row = rowIndex;
      td.dataset.col = colIndex;

      const val = item[colConf.key] ?? '';
      
      if (!isLastRow) {
        const vRes = validateCell(colIndex, val);
        if (!vRes.valid) {
          td.classList.add('cell-error');
          td.title = vRes.message;
        }
      }

      const view = document.createElement('div');
      view.className = 'cell-view';
      view.textContent = val;
      td.appendChild(view);

      td.addEventListener('mousedown', (e) => onCellMouseDown(e, rowIndex, colIndex));
      td.addEventListener('mouseenter', () => onCellMouseEnter(rowIndex, colIndex));
      td.addEventListener('dblclick', () => startEditing(rowIndex, colIndex));

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  updateSelectionUI();
}

function createEmptyRow() {
  const row = {};
  if (schema) schema.columns.forEach(c => row[c.key] = '');
  return row;
}

function createEmptySubtableRow(subtable) {
  const row = {};
  subtable.columns.forEach(column => row[column.key] = '');
  return row;
}

function renderSubtables() {
  const container = document.getElementById('subtable-container');
  container.innerHTML = '';
  (schema.subtables || []).forEach((subtable, subtableIndex) => {
    const section = document.createElement('section');
    section.className = 'subtable-section';

    const title = document.createElement('h3');
    title.className = 'subtable-title';
    title.textContent = subtable.title;
    section.appendChild(title);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const rowNumberHeader = document.createElement('th');
    rowNumberHeader.className = 'row-num';
    rowNumberHeader.textContent = '#';
    headRow.appendChild(rowNumberHeader);
    subtable.columns.forEach(column => {
      const th = document.createElement('th');
      if (column.width) th.style.width = column.width + 'px';
      th.textContent = column.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const items = Array.isArray(currentData[subtable.data_key]) ? currentData[subtable.data_key] : [];
    [...items, createEmptySubtableRow(subtable)].forEach((item, rowIndex, rows) => {
      const isLastRow = rowIndex === rows.length - 1;
      const row = document.createElement('tr');
      if (isLastRow) row.className = 'placeholder-row';

      const rowNumber = document.createElement('td');
      rowNumber.className = 'row-num';
      rowNumber.textContent = isLastRow ? '*' : String(rowIndex + 1);
      row.appendChild(rowNumber);

      subtable.columns.forEach((column, colIndex) => {
        const cell = document.createElement('td');
        const value = item[column.key] ?? '';
        if (!isLastRow) {
          const validation = validateColumn(column, value);
          if (!validation.valid) {
            cell.classList.add('cell-error');
            cell.title = validation.message;
          }
        }

        const view = document.createElement('div');
        view.className = 'cell-view';
        view.textContent = value;
        cell.appendChild(view);
        cell.addEventListener('dblclick', () => startSubtableEditing(subtableIndex, rowIndex, colIndex, cell));
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    container.appendChild(section);
  });
}

function validateColumn(column, value) {
  const val = (value || '').toString().trim();
  if (column.required && val === '') return { valid: false, message: `${column.label} は必須項目です` };
  if (val === '') return { valid: true };
  if (column.type === 'select' && column.options_strict && column.options && !column.options.includes(val)) {
    return { valid: false, message: `無効な値です: "${val}"` };
  }
  if (column.pattern && !(new RegExp(column.pattern)).test(val)) {
    return { valid: false, message: column.pattern_error || `形式が不正です (${column.pattern})` };
  }
  return { valid: true };
}

function startSubtableEditing(subtableIndex, rowIndex, colIndex, cell) {
  const subtable = schema.subtables[subtableIndex];
  const column = subtable.columns[colIndex];
  const items = Array.isArray(currentData[subtable.data_key]) ? currentData[subtable.data_key] : [];
  const currentValue = items[rowIndex]?.[column.key] ?? '';
  const editor = column.type === 'select' ? document.createElement('select') : document.createElement('textarea');
  editor.className = 'cell-editor subtable-editor';
  editor.value = currentValue;

  if (column.type === 'select') {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '-- 選択 --';
    editor.appendChild(emptyOption);
    (column.options || []).forEach(option => {
      const optionElement = document.createElement('option');
      optionElement.value = option;
      optionElement.textContent = option || '-- 空白 --';
      optionElement.selected = option === currentValue;
      editor.appendChild(optionElement);
    });
  }

  const finish = save => {
    if (!editor.isConnected) return;
    if (save) {
      const targetItems = Array.isArray(currentData[subtable.data_key]) ? currentData[subtable.data_key] : [];
      while (rowIndex >= targetItems.length) targetItems.push(createEmptySubtableRow(subtable));
      targetItems[rowIndex][column.key] = editor.value;
      currentData[subtable.data_key] = targetItems;
      notifyChange();
    }
    editor.remove();
    renderSubtables();
  };

  editor.addEventListener('mousedown', event => event.stopPropagation());
  editor.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') finish(false);
    if (event.key === 'Enter' && column.type === 'select') finish(true);
  });
  editor.addEventListener('change', () => finish(true));
  editor.addEventListener('blur', () => finish(true));
  cell.appendChild(editor);
  editor.focus();
  if (column.type !== 'select') editor.select();
}

function onCellMouseDown(e, row, col) {
  if (isEditing) closeEditor(true);
  if (e.button !== 0) return;
  isMouseDown = true;
  selectionStart = { row, col };
  selectionEnd = { row, col };
  activeCell = { row, col };
  updateSelectionUI();
}

function onCellMouseEnter(row, col) {
  if (!isMouseDown || isEditing) return;
  selectionEnd = { row, col };
  updateSelectionUI();
}

window.addEventListener('mouseup', () => { isMouseDown = false; });

function getSelectedBounds() {
  if (!selectionStart || !selectionEnd) {
    return { minR: activeCell.row, maxR: activeCell.row, minC: activeCell.col, maxC: activeCell.col };
  }
  return {
    minR: Math.min(selectionStart.row, selectionEnd.row),
    maxR: Math.max(selectionStart.row, selectionEnd.row),
    minC: Math.min(selectionStart.col, selectionEnd.col),
    maxC: Math.max(selectionStart.col, selectionEnd.col)
  };
}

function updateSelectionUI() {
  const { minR, maxR, minC, maxC } = getSelectedBounds();
  document.querySelectorAll('#table-body td[data-row]').forEach(td => {
    const r = parseInt(td.dataset.row, 10);
    const c = parseInt(td.dataset.col, 10);
    td.classList.toggle('cell-selected', (r >= minR && r <= maxR && c >= minC && c <= maxC));
    td.classList.toggle('cell-active', (r === activeCell.row && c === activeCell.col));
  });
}

function startEditing(row, col) {
  if (isEditing) closeEditor(true);
  isEditing = true;

  activeCell = { row, col };
  selectionStart = { row, col };
  selectionEnd = { row, col };
  updateSelectionUI();

  const td = document.querySelector(`#table-body td[data-row="${row}"][data-col="${col}"]`);
  if (!td) return;

  const conf = schema.columns[col];
  const currentVal = (currentData.items[row] && currentData.items[row][conf.key]) ?? '';

  let editor;

  if (conf.type === 'select') {
    editor = document.createElement('select');
    editor.className = 'cell-editor';
    
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- 選択 --';
    editor.appendChild(emptyOpt);

    (conf.options || []).forEach(opt => {
      const optEl = document.createElement('option');
      optEl.value = opt;
      optEl.textContent = opt;
      if (opt === currentVal) optEl.selected = true;
      editor.appendChild(optEl);
    });

    editor.addEventListener('mousedown', (e) => e.stopPropagation());
    editor.addEventListener('click', (e) => e.stopPropagation());
    editor.addEventListener('change', () => closeEditor(true));
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeEditor(false);
      else if (e.key === 'Enter') { closeEditor(true); moveActiveCell(1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); closeEditor(true); moveActiveCell(0, e.shiftKey ? -1 : 1); }
    });
    editor.addEventListener('blur', () => {
      setTimeout(() => { if (isEditing && document.activeElement !== editor) closeEditor(true); }, 120);
    });

  } else {
    editor = document.createElement('textarea');
    editor.className = 'cell-editor';
    editor.value = currentVal;

    editor.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // 【IME対応】日本語変換中のEnterやキー操作をテーブル側に拾わせない
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return; // IME変換中は抜ける

      if (e.key === 'Escape') {
        closeEditor(false);
      } else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        closeEditor(true);
        moveActiveCell(1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeEditor(true);
        moveActiveCell(0, e.shiftKey ? -1 : 1);
      }
    });

    editor.addEventListener('blur', () => {
      if (isEditing) closeEditor(true);
    });

    setTimeout(() => { editor.select(); }, 0);
  }

  td.appendChild(editor);
  editor.focus();
}

function closeEditor(saveChanges) {
  if (!isEditing) return;
  const editor = document.querySelector('.cell-editor');
  if (editor) {
    const { row, col } = activeCell;
    const colKey = schema.columns[col].key;
    const newVal = editor.value;

    if (saveChanges) {
      while (row >= currentData.items.length) {
        currentData.items.push(createEmptyRow());
      }
      currentData.items[row][colKey] = newVal;
      notifyChange();
    }
    editor.remove();
  }
  isEditing = false;
  renderRows();
}

function moveActiveCell(rDelta, cDelta) {
  const maxR = currentData.items.length;
  const maxC = schema.columns.length - 1;
  activeCell = {
    row: Math.max(0, Math.min(activeCell.row + rDelta, maxR)),
    col: Math.max(0, Math.min(activeCell.col + cDelta, maxC))
  };
  selectionStart = { ...activeCell };
  selectionEnd = { ...activeCell };
  updateSelectionUI();
}

// キーボード制御（セル移動と確定操作に限定し、IME誤爆を防ぐ）
window.addEventListener('keydown', (e) => {
  if (isEditing || e.isComposing || e.keyCode === 229) return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'c') { copyRange(); e.preventDefault(); return; }
  if (e.key === 'Enter' || e.key === 'F2') { startEditing(activeCell.row, activeCell.col); e.preventDefault(); return; }
  if (e.key === 'ArrowUp')    { moveActiveCell(-1, 0); e.preventDefault(); }
  if (e.key === 'ArrowDown')  { moveActiveCell(1, 0);  e.preventDefault(); }
  if (e.key === 'ArrowLeft')  { moveActiveCell(0, -1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { moveActiveCell(0, 1);  e.preventDefault(); }
  if (e.key === 'Tab')        { moveActiveCell(0, e.shiftKey ? -1 : 1); e.preventDefault(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { clearRange(); e.preventDefault(); }
});

function copyRange() {
  const { minR, maxR, minC, maxC } = getSelectedBounds();
  const plain = [];
  let html = '<table border="1">';

  for (let r = minR; r <= maxR; r++) {
    const item = currentData.items[r] || {};
    const cols = [];
    html += '<tr>';
    for (let c = minC; c <= maxC; c++) {
      let val = (item[schema.columns[c].key] ?? '').toString();
      let pVal = (val.includes('\n') || val.includes('"') || val.includes('\t')) ? `"${val.replace(/"/g, '""')}"` : val;
      cols.push(pVal);

      let hVal = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br style="mso-data-placement:same-cell;">');
      html += `<td style="mso-number-format:'\\@';">${hVal}</td>`;
    }
    plain.push(cols.join('\t'));
    html += '</tr>';
  }
  html += '</table>';

  const tsv = plain.join('\r\n');
  const blobT = new Blob([tsv], { type: 'text/plain' });
  const blobH = new Blob([html], { type: 'text/html' });
  navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobT, 'text/html': blobH })]).catch(() => {
    navigator.clipboard.writeText(tsv);
  });
}

function clearRange() {
  const { minR, maxR, minC, maxC } = getSelectedBounds();
  let mod = false;
  for (let r = minR; r <= maxR; r++) {
    if (r < currentData.items.length) {
      for (let c = minC; c <= maxC; c++) {
        currentData.items[r][schema.columns[c].key] = '';
        mod = true;
      }
    }
  }
  if (mod) { notifyChange(); renderRows(); }
}

window.addEventListener('paste', (e) => {
  if (isEditing) return;
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text) return;
  e.preventDefault();

  const grid = parseTSV(text);
  const sRow = activeCell.row;
  const sCol = activeCell.col;

  grid.forEach((vals, rOffset) => {
    const tRow = sRow + rOffset;
    while (tRow >= currentData.items.length) currentData.items.push(createEmptyRow());
    vals.forEach((v, cOffset) => {
      const tCol = sCol + cOffset;
      if (tCol < schema.columns.length) {
        currentData.items[tRow][schema.columns[tCol].key] = v;
      }
    });
  });

  notifyChange();
  renderRows();
});

function parseTSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i+1];
    if (c === '"') {
      if (inQ && n === '"') { cell += '"'; i++; }
      else inQ = !inQ;
    } else if (c === '\t' && !inQ) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\r' || c === '\n') && !inQ) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length > 0) { row.push(cell.trim()); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] && r[0].trim() !== ''));
}

function notifyChange() {
  const cleanItems = currentData.items.filter(row =>
    Object.values(row).some(v => v !== null && v !== undefined && v.toString().trim() !== '')
  );
  const nextData = { ...currentData, items: cleanItems };
  (schema.subtables || []).forEach(subtable => {
    const subtableItems = Array.isArray(currentData[subtable.data_key]) ? currentData[subtable.data_key] : [];
    nextData[subtable.data_key] = subtableItems.filter(row =>
      Object.values(row).some(v => v !== null && v !== undefined && v.toString().trim() !== '')
    );
  });
  vscode.postMessage({
    type: 'change',
    data: nextData
  });
}

window.addEventListener('message', e => {
  if (e.data.type === 'init') {
    schema = e.data.schema;
    currentData = e.data.data || { items: [] };
    availableSchemas = e.data.availableSchemas || [];
    if (!currentData.items) currentData.items = [];
    setupStructure();
  }
});

vscode.postMessage({ type: 'ready' });
