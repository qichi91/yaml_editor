const vscode = acquireVsCodeApi();

let schema = null;
let currentData = { schema: '', items: [] };
let availableSchemas = [];

let isMouseDown = false;
let selectionStart = null;
let selectionEnd = null;
let activeCell = { row: 0, col: 0 };
let activeSubtableIndex = null;
let isEditing = false;
let closeActiveEditor = null;
let undoStack = [];
let redoStack = [];

// 非編集時も常時フォーカスを保持する不可視input。IME切替キー等をブラウザ標準動作に委ねるための仕組み
const keyCapture = document.getElementById('key-capture');

// IME変換候補ウィンドウが正しい位置に出るよう、アクティブセルの位置に重ねてから focus する
function positionKeyCaptureAtActiveCell() {
  const selector = activeSubtableIndex === null
    ? `#table-body td[data-row="${activeCell.row}"][data-col="${activeCell.col}"]`
    : `#subtable-container td[data-table="${activeSubtableIndex}"][data-row="${activeCell.row}"][data-col="${activeCell.col}"]`;
  const cellEl = document.querySelector(selector);
  if (!cellEl) return;
  const rect = cellEl.getBoundingClientRect();
  keyCapture.style.top = `${rect.top}px`;
  keyCapture.style.left = `${rect.left}px`;
  keyCapture.style.width = `${Math.max(rect.width, 1)}px`;
  keyCapture.style.height = `${Math.max(rect.height, 1)}px`;
}

function focusKeyCapture() {
  if (isEditing || !keyCapture) return;
  positionKeyCaptureAtActiveCell();
  keyCapture.focus({ preventScroll: true });
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data || { schema: '', items: [] }));
}

function pushUndoState(snapshot) {
  const before = cloneData(snapshot);
  const prev = undoStack[undoStack.length - 1];
  const shouldPush = !prev
    || JSON.stringify(prev) !== JSON.stringify(before)
    || (undoStack.length === 1 && JSON.stringify(prev) === JSON.stringify(before));
  if (shouldPush) {
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
  }
}

function commitBulkEdit(mutator) {
  const before = cloneData(currentData);
  pushUndoState(before);
  mutator();
  if (JSON.stringify(before) === JSON.stringify(currentData)) {
    undoStack.pop();
    return false;
  }
  return true;
}

function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  currentData = cloneData(snapshot);
  if (!Array.isArray(currentData.items)) currentData.items = [];
  renderRows();
  renderSubtables();
  updateSelectionUI();
  notifyChange();
}

function undoHistory() {
  if (undoStack.length <= 1) return;
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneData(currentData));
  restoreSnapshot(prev);
}

function redoHistory() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneData(currentData));
  restoreSnapshot(next);
}

// 値が空、もしくは列の初期値と同じ場合は「未入力」とみなす
function isBlankValue(value, defaultValue) {
  if (value === null || value === undefined) return true;
  const str = value.toString().trim();
  if (str === '') return true;
  return defaultValue !== undefined && defaultValue !== null && str === defaultValue.toString().trim();
}

function isRowBlank(row, columns) {
  const defaultsByKey = new Map((columns || []).map(col => [col.key, col.default]));
  return Object.entries(row || {}).every(([key, value]) => isBlankValue(value, defaultsByKey.get(key)));
}

function buildDirtyData() {
  const cleanItems = (currentData.items || []).filter(row => !isRowBlank(row, schema.columns));
  const nextData = { ...currentData, items: cleanItems };
  (schema.subtables || []).forEach(subtable => {
    const subtableItems = Array.isArray(currentData[subtable.data_key]) ? currentData[subtable.data_key] : [];
    nextData[subtable.data_key] = subtableItems.filter(row => !isRowBlank(row, subtable.columns));
  });
  return nextData;
}

function saveCurrentData() {
  vscode.postMessage({
    type: 'save',
    data: buildDirtyData()
  });
}

function getActiveTable() {
  if (activeSubtableIndex === null) {
    return {
      items: currentData.items,
      columns: schema.columns,
      createRow: createEmptyRow,
      render: renderRows
    };
  }

  const subtable = schema.subtables[activeSubtableIndex];
  if (!Array.isArray(currentData[subtable.data_key])) {
    currentData[subtable.data_key] = [];
  }
  return {
    items: currentData[subtable.data_key],
    columns: subtable.columns,
    createRow: () => createEmptySubtableRow(subtable),
    render: renderSubtables
  };
}

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
    const before = cloneData(currentData);
    pushUndoState(before);
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
      const before = cloneData(currentData);
      pushUndoState(before);
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
      td.dataset.table = 'main';
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
  if (schema) schema.columns.forEach(c => row[c.key] = c.default ?? '');
  return row;
}

function createEmptySubtableRow(subtable) {
  const row = {};
  subtable.columns.forEach(column => row[column.key] = column.default ?? '');
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
        cell.dataset.table = String(subtableIndex);
        cell.dataset.row = rowIndex;
        cell.dataset.col = colIndex;
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
        cell.addEventListener('mousedown', event => onCellMouseDown(event, rowIndex, colIndex, subtableIndex));
        cell.addEventListener('mouseenter', () => onCellMouseEnter(rowIndex, colIndex, subtableIndex));
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

function startSubtableEditing(subtableIndex, rowIndex, colIndex, cell, initialValue) {
  if (isEditing && closeActiveEditor) closeActiveEditor(true);
  isEditing = true;

  const subtable = schema.subtables[subtableIndex];
  const column = subtable.columns[colIndex];
  const items = Array.isArray(currentData[subtable.data_key]) ? currentData[subtable.data_key] : [];
  const currentValue = initialValue !== undefined ? initialValue : (items[rowIndex]?.[column.key] ?? '');
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
      const before = cloneData(currentData);
      pushUndoState(before);
      const targetItems = Array.isArray(currentData[subtable.data_key]) ? currentData[subtable.data_key] : [];
      while (rowIndex >= targetItems.length) targetItems.push(createEmptySubtableRow(subtable));
      targetItems[rowIndex][column.key] = editor.value;
      currentData[subtable.data_key] = targetItems;
      notifyChange();
    }
    editor.remove();
    isEditing = false;
    closeActiveEditor = null;
    renderSubtables();
    focusKeyCapture();
  };
  closeActiveEditor = finish;

  editor.addEventListener('mousedown', event => event.stopPropagation());
  editor.addEventListener('click', event => event.stopPropagation());
  // 【メインテーブルと同一操作】Enterで確定し次行へ、Tabで確定し次列へ、Escapeでキャンセル
  editor.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      finish(false);
    } else if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      finish(true);
      moveActiveCell(1, 0);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      finish(true);
      moveActiveCell(0, event.shiftKey ? -1 : 1);
    }
  });
  editor.addEventListener('change', () => finish(true));
  editor.addEventListener('blur', () => finish(true));
  cell.appendChild(editor);
  editor.focus();
  if (column.type === 'select') {
    // no-op: select型は選択操作のみ
  } else if (initialValue !== undefined) {
    const len = editor.value.length;
    setTimeout(() => editor.setSelectionRange(len, len), 0);
  } else {
    editor.select();
  }
}

function onCellMouseDown(e, row, col, subtableIndex = null) {
  if (isEditing && closeActiveEditor) closeActiveEditor(true);
  if (e.button !== 0) return;
  // td既定のフォーカス処理（非フォーカス要素へのblur等）がkeyCaptureへのfocus()を上書きするのを防ぐ
  e.preventDefault();
  isMouseDown = true;
  activeSubtableIndex = subtableIndex;
  selectionStart = { row, col };
  selectionEnd = { row, col };
  activeCell = { row, col };
  updateSelectionUI();
  focusKeyCapture();
}

function onCellMouseEnter(row, col, subtableIndex = null) {
  if (!isMouseDown || isEditing) return;
  if (activeSubtableIndex !== subtableIndex) return;
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
  const tableId = activeSubtableIndex === null ? 'main' : String(activeSubtableIndex);
  document.querySelectorAll('td[data-table][data-row]').forEach(td => {
    const r = parseInt(td.dataset.row, 10);
    const c = parseInt(td.dataset.col, 10);
    const isActiveTable = td.dataset.table === tableId;
    td.classList.toggle('cell-selected', isActiveTable && r >= minR && r <= maxR && c >= minC && c <= maxC);
    td.classList.toggle('cell-active', isActiveTable && r === activeCell.row && c === activeCell.col);
  });
}

function startEditing(row, col, initialValue) {
  if (isEditing && closeActiveEditor) closeActiveEditor(true);
  isEditing = true;
  closeActiveEditor = closeEditor;

  activeCell = { row, col };
  selectionStart = { row, col };
  selectionEnd = { row, col };
  updateSelectionUI();

  const td = document.querySelector(`#table-body td[data-row="${row}"][data-col="${col}"]`);
  if (!td) return;

  const conf = schema.columns[col];
  const currentVal = initialValue !== undefined ? initialValue : ((currentData.items[row] && currentData.items[row][conf.key]) ?? '');

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

    // Excelのように直接入力を開始した場合は選択せずカーソルを末尾に置く
    if (initialValue !== undefined) {
      const len = editor.value.length;
      setTimeout(() => editor.setSelectionRange(len, len), 0);
    } else {
      setTimeout(() => { editor.select(); }, 0);
    }
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
      const before = cloneData(currentData);
      pushUndoState(before);
      while (row >= currentData.items.length) {
        currentData.items.push(createEmptyRow());
      }
      currentData.items[row][colKey] = newVal;
      notifyChange();
    }
    editor.remove();
  }
  isEditing = false;
  closeActiveEditor = null;
  renderRows();
  focusKeyCapture();
}

function moveActiveCell(rDelta, cDelta) {
  const table = getActiveTable();
  const maxR = table.items.length;
  const maxC = table.columns.length - 1;
  activeCell = {
    row: Math.max(0, Math.min(activeCell.row + rDelta, maxR)),
    col: Math.max(0, Math.min(activeCell.col + cDelta, maxC))
  };
  selectionStart = { ...activeCell };
  selectionEnd = { ...activeCell };
  updateSelectionUI();
  positionKeyCaptureAtActiveCell();
}

// メインテーブル・サブテーブル共通: アクティブセルで編集モードへ入る
function startEditingAtActiveCell(initialValue) {
  if (activeSubtableIndex === null) {
    startEditing(activeCell.row, activeCell.col, initialValue);
    return;
  }
  const cell = document.querySelector(
    `#subtable-container td[data-table="${activeSubtableIndex}"][data-row="${activeCell.row}"][data-col="${activeCell.col}"]`
  );
  if (cell) startSubtableEditing(activeSubtableIndex, activeCell.row, activeCell.col, cell, initialValue);
}

// キーボード制御（セル移動と確定操作に限定し、IME誤爆を防ぐ）
keyCapture.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentData(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoHistory(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redoHistory(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') { copyRange(); e.preventDefault(); return; }
  if (e.key === 'Enter' || e.key === 'F2') { startEditingAtActiveCell(); e.preventDefault(); return; }
  if (e.key === 'ArrowUp')    { moveActiveCell(-1, 0); e.preventDefault(); }
  if (e.key === 'ArrowDown')  { moveActiveCell(1, 0);  e.preventDefault(); }
  if (e.key === 'ArrowLeft')  { moveActiveCell(0, -1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { moveActiveCell(0, 1);  e.preventDefault(); }
  if (e.key === 'Tab')        { moveActiveCell(0, e.shiftKey ? -1 : 1); e.preventDefault(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { clearRange(); e.preventDefault(); }
});

// Excelのように、非編集状態から文字を入力すると即編集開始。IME切替キー等の判定はブラウザ標準の
// input/compositionendイベントに委ねるため、個別のキーコードを推測する必要がない
function finalizeKeyCapture() {
  const typed = keyCapture.value;
  keyCapture.value = '';
  if (!typed || isEditing) return;
  const table = getActiveTable();
  const colConf = table.columns[activeCell.col];
  if (colConf && colConf.type !== 'select') {
    startEditingAtActiveCell(typed);
  }
}
keyCapture.addEventListener('input', (e) => {
  if (e.isComposing) return;
  finalizeKeyCapture();
});
keyCapture.addEventListener('compositionend', () => finalizeKeyCapture());

function copyRange() {
  const { minR, maxR, minC, maxC } = getSelectedBounds();
  const table = getActiveTable();
  const plain = [];
  let html = '<table border="1">';

  for (let r = minR; r <= maxR; r++) {
    const item = table.items[r] || {};
    const cols = [];
    html += '<tr>';
    for (let c = minC; c <= maxC; c++) {
      let val = (item[table.columns[c].key] ?? '').toString();
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
  const table = getActiveTable();
  const hadAny = (() => {
    for (let r = minR; r <= maxR; r++) {
      if (r < table.items.length) {
        for (let c = minC; c <= maxC; c++) {
          if ((table.items[r][table.columns[c].key] ?? '').toString().trim() !== '') {
            return true;
          }
        }
      }
    }
    return false;
  })();
  if (!hadAny) return;

  const mutated = commitBulkEdit(() => {
    for (let r = minR; r <= maxR; r++) {
      if (r < table.items.length) {
        for (let c = minC; c <= maxC; c++) {
          table.items[r][table.columns[c].key] = '';
        }
      }
    }
  });
  if (mutated) {
    notifyChange();
    table.render();
  }
}

window.addEventListener('paste', (e) => {
  if (isEditing) return;
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text) return;
  e.preventDefault();

  const table = getActiveTable();
  const before = cloneData(currentData);
  const grid = parseTSV(text);
  const sRow = activeCell.row;
  const sCol = activeCell.col;

  const mutated = commitBulkEdit(() => {
    grid.forEach((vals, rOffset) => {
      const tRow = sRow + rOffset;
      while (tRow >= table.items.length) table.items.push(table.createRow());
      vals.forEach((v, cOffset) => {
        const tCol = sCol + cOffset;
        if (tCol < table.columns.length) {
          table.items[tRow][table.columns[tCol].key] = v;
        }
      });
    });
  });

  if (mutated) {
    notifyChange();
    table.render();
  } else if (JSON.stringify(before) !== JSON.stringify(currentData)) {
    notifyChange();
    table.render();
  }
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
  const nextData = buildDirtyData();
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
    undoStack = [cloneData(currentData)];
    redoStack = [];
    setupStructure();
    focusKeyCapture();
  }
});

vscode.postMessage({ type: 'ready' });
