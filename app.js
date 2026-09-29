const SHEET_ID = '1R4h8YtBFPDzD70DlNZQ88C7nJ9Gd9Yfd';
const API = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq';
const SHEET_EDIT_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit';
const $ = selector => document.querySelector(selector);

let staff = [];
let photoMap = {};
let matrixTable = null;
let trainingTable = null;
let trainingLoading = false;
let trainingLoadError = '';
let activeSheet = 'Matriz';
let selected = null;
let pdfSelectedIds = new Set();
let requestNo = 0;
const sheetColumnFilters = { Matriz: {}, Treinamentos: {} };

const txt = (row, index) => String(Array.isArray(row)
  ? row[index] ?? ''
  : row?.c?.[index]?.f ?? row?.c?.[index]?.v ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[char]));
const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

function query(sheet, headers) {
  return new Promise((resolve, reject) => {
    const callback = '__sheet_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      delete window[callback];
      script.remove();
      error ? reject(error) : resolve(value);
    };
    window[callback] = value => value.status === 'ok'
      ? finish(null, value.table)
      : finish(new Error(value.errors?.[0]?.detailed_message || 'Não foi possível ler a planilha.'));
    script.onerror = () => finish(new Error('Falha ao conectar com a planilha.'));
    const timer = setTimeout(() => finish(new Error('Tempo de conexão esgotado.')), 18000);
    script.src = API + '?tqx=' + encodeURIComponent('out:json;responseHandler:' + callback)
      + '&sheet=' + encodeURIComponent(sheet) + '&headers=' + headers;
    document.head.append(script);
  });
}

function formatDate(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:00\/01\/1900|01\/00\/1900|0{1,2}\/0{1,2}\/1900)$/i.test(text)) return '';
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return text;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const monthFirst = first <= 12 && second <= 12 ? true : first <= 12;
  const day = monthFirst ? second : first;
  const month = monthFirst ? first : second;
  return String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0') + '/' + match[3];
}

function photoSource(id, stored = '') {
  if (stored) return stored;
  const source = photoMap[id];
  if (!source) return '';
  return source.startsWith('assets/') ? source
    : 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(source) + '=w1000';
}

function readStoredPhoto(id) {
  try {
    return localStorage.getItem('badge-photo-' + id) || '';
  } catch (_) {
    return '';
  }
}

function formatMonthYear(value) {
  const text = formatDate(value);
  const match = text.match(/^\d{2}\/(\d{2})\/(\d{4})$/);
  if (!match) return text;
  const month = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(match[1]) - 1];
  return month ? month + '-' + match[2].slice(-2) : text;
}

function parseSheetDate(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:00\/01\/1900|01\/00\/1900|0{1,2}\/0{1,2}\/1900)$/i.test(text)) return null;

  let parts = text.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/i);
  if (parts) return new Date(Number(parts[1]), Number(parts[2]), Number(parts[3]));

  parts = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));

  parts = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!parts) return null;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const monthFirst = first <= 12 && second <= 12 ? true : first <= 12;
  const month = monthFirst ? first : second;
  const day = monthFirst ? second : first;
  const date = new Date(Number(parts[3]), month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function accessIsCurrent(value) {
  const expiry = parseSheetDate(value);
  if (!expiry) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return expiry > today;
}

function restrictedAreas(row) {
  const labels = ['SE', 'MINA', 'PAIOL', 'BRR'];
  return labels.map((fallback, offset) => {
    const index = offset + 11;
    const value = txt(row, index);
    const rawExpiry = Array.isArray(row) ? value : row?.c?.[index]?.v ?? value;
    const name = headerName(offset + 11).replace(/^MIN$/i, 'MINA') || fallback;
    return {
      name,
      date: formatMonthYear(value),
      active: accessIsCurrent(rawExpiry)
    };
  });
}

function documentValidity(row) {
  return [
    { value: formatDate(txt(row, 7)) },
    { label: 'INTEGR. VAL' },
    { value: formatDate(txt(row, 6)) },
    { label: 'CNH VAL.' },
    { value: formatDate(txt(row, 10)) }
  ];
}

function canonicalTrainingName(value) {
  const name = String(value ?? '').trim();
  const knownLabels = {
    'nr22 introdutorio mvv': 'NR-22 Introdutório MVV',
    'nr35 - trabalho em altura': 'NR35 Trabalho em Altura 8h',
    'nr35 trabalho em altura 8h': 'NR35 Trabalho em Altura 8h',
    'nr11 mini carregadeira': 'NR 11 Mini Carregadeira'
  };
  return knownLabels[normalize(name)] || name;
}

function headerName(index) {
  const name = String(window.__headers?.[index] || '').replace(/^\d+\s+/, '').trim();
  return name.replace(/^(?:DADOS GERAIS DO FUNCIONÁRIO|VALIDADE DO TREINAMENTO|AREAS RESTRITAS|AUTORIZADO A EXECUTAR|AUTORIZADO A OPERAR|AUTORIZADO A LIBERAR|EPI ESPECIAL|AUTORIZADO A PORTAR)\s*/i, '').trim();
}

function readGroups(row) {
  const ranges = [
    { title: 'AUTORIZADO A EXECUTAR', indices: Array.from({ length: 23 }, (_, i) => i + 19) },
    { title: 'AUTORIZADO A OPERAR', indices: Array.from({ length: 12 }, (_, i) => i + 42) },
    { title: 'AUTORIZADO A CONDUZIR', indices: Array.from({ length: 4 }, (_, i) => i + 54) },
    { title: 'AUTORIZADO A LIBERAR', indices: Array.from({ length: 8 }, (_, i) => i + 58) },
    { title: 'EPI ESPECIAL', indices: Array.from({ length: 4 }, (_, i) => i + 66) }
  ];
  return ranges.map(group => ({
    title: group.title,
    items: group.indices.map(index => ({
      name: canonicalTrainingName(headerName(index)),
      date: formatDate(txt(row, index))
    })).filter(item => item.name && item.date)
  })).filter(group => group.items.length);
}

function setStatus(message, error = false) {
  const status = $('#source-status');
  status.textContent = message;
  status.dataset.state = error ? 'error' : 'ok';
}

function updateSuggestions() {
  const term = normalize($('#registro').value);
  const isNumber = /^\d+$/.test(term);
  const matches = staff.filter(person =>
    !term || normalize(person.id).includes(term) || normalize(txt(person.cells, 1)).includes(term)
  ).slice(0, 12);
  $('#staff-suggestions').innerHTML = matches.map(person => {
    const name = esc(txt(person.cells, 1));
    return '<option value="' + esc(isNumber ? person.id : txt(person.cells, 1))
      + '" label="' + esc(isNumber ? name : 'Registro ' + person.id) + '"></option>';
  }).join('');
  const matchesSelected = selected && (term === normalize(selected.id)
    || term === normalize(txt(selected.cells, 1)));
  $('#pdf').disabled = !matchesSelected;
  $('#png').disabled = !matchesSelected;
  $('#photo').disabled = !matchesSelected;
}

function sheetData(table) {
  if (!table) return { columns: [], rows: [] };
  const values = table.rows.map(row => Array.from({ length: table.cols.length }, (_, index) => {
    const cell = row.c?.[index];
    const value = String(cell?.f ?? cell?.v ?? '').trim();
    return formatDate(value);
  }));
  const indexes = table.cols.map((column, index) => ({ column, index }))
    .filter(({ column, index }) => String(column.label || '').trim() || values.some(row => row[index]));
  const rows = values.map(row => indexes.map(({ index }) => row[index])).filter(row => row.some(Boolean));
  return {
    columns: indexes.map(({ column, index }) => ({
      label: column.label || ('Coluna ' + (index + 1)), sourceIndex: index
    })),
    rows,
    sourceRows: table.rows.filter((_, rowIndex) => values[rowIndex].some(Boolean))
  };
}

function statusForRow(row, columns, sourceRow) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let earliestDays = Infinity;
  columns.forEach((column, displayIndex) => {
    // The live Google Visualization feed currently exposes A:AB only. This is
    // the same G:AB range used by its STATUS formula; later workbook columns
    // are absent, so never infer the status from a partial date range.
    if (column.sourceIndex < 6 || column.sourceIndex > 27) return;
    const rawCell = sourceRow?.c?.[column.sourceIndex];
    const expiry = parseSheetDate(rawCell?.v ?? rawCell?.f ?? row[displayIndex]);
    if (!expiry) return;
    const expiryDay = Date.UTC(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const remainingDays = Math.round((expiryDay - todayDay) / 86400000);
    earliestDays = Math.min(earliestDays, remainingDays);
  });
  const sourceStatus = normalize(txt(sourceRow, 5));
  const label = sourceStatus === 'atencao' ? 'ATENÇÃO'
    : sourceStatus === 'vencido' ? 'VENCIDO'
      : sourceStatus === 'valido' ? 'VÁLIDO' : txt(sourceRow, 5);
  return {
    label,
    days: earliestDays === Infinity ? null : earliestDays
  };
}

function sheetRows(table) {
  return sheetData(table).rows;
}

function updateSheetLabels() {
  $('#sheet-tab-matrix').textContent = matrixTable
    ? 'Matriz · ' + sheetRows(matrixTable).length : 'Matriz';
  $('#sheet-tab-training').textContent = trainingLoading
    ? 'Treinamentos · atualizando…'
    : trainingTable ? 'Treinamentos · ' + sheetRows(trainingTable).length
      : trainingLoadError ? 'Treinamentos · indisponível' : 'Treinamentos';
}

function renderSheet() {
  const table = activeSheet === 'Matriz' ? matrixTable : trainingTable;
  if (!table) {
    const message = activeSheet === 'Treinamentos'
      ? trainingLoading ? 'Carregando a aba Treinamentos…'
        : trainingLoadError || 'Aba Treinamentos indisponível.'
      : 'Aba Matriz indisponível.';
    $('#sheet-count').textContent = '—';
    $('#sheet-content').innerHTML = '<div class="sheet-empty">' + esc(message) + '</div>';
    return;
  }
  const data = sheetData(table);
  const allRows = data.rows;
  const term = normalize($('#sheet-filter').value);
  const filters = sheetColumnFilters[activeSheet];
  const sourceRows = data.sourceRows;
  const statusIndex = activeSheet === 'Matriz'
    ? data.columns.findIndex(column => column.sourceIndex === 5) : -1;
  const preparedRows = allRows.map((row, index) => {
    const status = statusIndex >= 0 ? statusForRow(row, data.columns, sourceRows[index]) : null;
    const displayRow = row.slice();
    if (statusIndex >= 0 && status.label) displayRow[statusIndex] = status.label;
    return { row: displayRow, status };
  });
  const matches = preparedRows
    .filter(({ row }) => (!term || normalize(row.join(' ')).includes(term))
      && data.columns.every((column, index) => !filters[column.sourceIndex]
        || normalize(row[index]).includes(normalize(filters[column.sourceIndex]))));
  const rows = matches.map(item => item.row);
  $('#sheet-tab-matrix').setAttribute('aria-selected', String(activeSheet === 'Matriz'));
  $('#sheet-tab-training').setAttribute('aria-selected', String(activeSheet === 'Treinamentos'));
  $('#sheet-count').textContent = rows.length + ' / ' + allRows.length;
  if (!rows.length) {
    $('#sheet-content').innerHTML = '<div class="sheet-empty">Nenhuma linha encontrada.</div>';
    return;
  }
  const headers = data.columns.map(column => '<th scope="col">' + esc(column.label)
    + '<input class="column-filter" type="search" data-column="' + column.sourceIndex
    + '" value="' + esc(filters[column.sourceIndex] || '') + '" placeholder="Filtrar…" aria-label="Filtrar coluna ' + esc(column.label) + '"></th>'
  ).join('');
  const body = matches.map(({ row, status }) => '<tr>' + row.map((value, index) => {
    const statusLabel = index === statusIndex ? status?.label || '' : '';
    const tone = normalize(statusLabel) === 'vencido' ? 'cell-expired'
      : normalize(statusLabel) === 'atencao' ? 'cell-attention' : '';
    const daysText = !Number.isFinite(status?.days) ? '' : status.days > 0
      ? 'Vence em ' + status.days + (status.days === 1 ? ' dia' : ' dias')
      : status.days < 0 ? 'Vencido há ' + Math.abs(status.days) + (status.days === -1 ? ' dia' : ' dias')
        : 'Vence hoje';
    const attention = (statusLabel === 'ATENÇÃO' || statusLabel === 'VENCIDO') && daysText
      ? '<span class="status-tooltip" tabindex="0" title="' + esc(daysText) + '" aria-label="' + esc(statusLabel + '. ' + daysText) + '">' + esc(statusLabel)
        + '<span class="status-days" role="tooltip">' + esc(daysText) + '</span></span>' : esc(statusLabel || value);
    return '<td' + (tone ? ' class="' + tone + '"' : '') + '>' + attention + '</td>';
  }).join('') + '</tr>').join('');
  $('#sheet-content').innerHTML = '<table class="sheet-table"><thead><tr>' + headers
    + '</tr></thead><tbody>' + body + '</tbody></table>';
}

async function loadData() {
  const thisRequest = ++requestNo;
  setStatus('Conectando à planilha…');
  $('#error').hidden = true;
  trainingLoading = true;
  trainingLoadError = '';
  updateSheetLabels();
  if ($('#sheet-dialog').open) renderSheet();
  const trainingRequest = query('Treinamentos', 1).then(
    table => ({ table, error: '' }),
    error => ({ table: null, error: error.message || 'Não foi possível ler a aba Treinamentos.' })
  );
  try {
    const [matrix, photos] = await Promise.all([
      query('Matriz', 3),
      fetch('assets/photos.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).catch(() => null)
    ]);
    if (thisRequest !== requestNo) return;
    if (photos && typeof photos === 'object' && !Array.isArray(photos)) photoMap = photos;
    matrixTable = matrix;
    window.__headers = matrix.cols.map(column => column.label || '');
    staff = matrix.rows.map(row => ({ cells: row, id: txt(row, 0) }))
      .filter(person => person.id && txt(person.cells, 1));
    setStatus('Dados carregados.');
    updateSuggestions();
    updateSheetLabels();
    $('#sheet-open').disabled = false;
    if (!selected && staff.length) {
      selected = staff[Math.floor(Math.random() * staff.length)];
      $('#registro').value = selected.id;
      render(selected);
    }
    if ($('#sheet-dialog').open) renderSheet();
    if (selected) {
      const updated = staff.find(person => person.id === selected.id);
      if (updated) {
        selected = updated;
        render(selected);
      } else clearResult();
    }
    updateSuggestions();

    const trainingResult = await trainingRequest;
    if (thisRequest !== requestNo) return;
    trainingTable = trainingResult.table;
    trainingLoadError = trainingResult.error;
    trainingLoading = false;
    updateSheetLabels();
    if ($('#sheet-dialog').open) renderSheet();
  } catch (error) {
    if (thisRequest !== requestNo) return;
    trainingLoading = false;
    trainingLoadError = 'Não foi possível atualizar a aba Treinamentos.';
    updateSheetLabels();
    if ($('#sheet-dialog').open) renderSheet();
    setStatus('Falha de conexão', true);
    $('#error').textContent = error.message;
    $('#error').hidden = false;
  }
}

function field(label, value, extraClass = '') {
  return '<div class="field ' + extraClass + '"><b>' + esc(label) + '</b><span>' + esc(value || '—') + '</span></div>';
}

function render(item) {
  const row = item.cells;
  const id = item.id;
  const name = txt(row, 1);
  $('#employee-id').textContent = 'REGISTRO ' + id;
  $('#employee-name').textContent = name;
  $('#employee-role').textContent = txt(row, 2) + ' · ' + txt(row, 4);
  $('#empty').hidden = true;
  $('#error').hidden = true;
  $('#result').hidden = false;

  const stored = readStoredPhoto(id);
  const photoSrc = photoSource(id, stored);
  const photo = photoSrc
    ? '<img class="portrait" crossorigin="anonymous" alt="Foto de ' + esc(name) + '" src="' + esc(photoSrc) + '" onerror="this.classList.add(\'photo-failed\')">'
    : '<div class="portrait photo-empty" role="img" aria-label="Foto não cadastrada">FOTO</div>';

  const areas = restrictedAreas(row);
  const areaRows = areas.map(area =>
    '<li aria-label="' + esc(area.name + (area.active ? ', acesso válido até ' + area.date : ', sem autorização vigente')) + '"><span class="area-status" aria-hidden="true">' + (area.active ? 'X' : '') + '</span>' +
      '<span class="area-name">' + esc(area.name) + '</span><b>' + esc(area.date) + '</b></li>'
  ).join('');
  const validityRows = documentValidity(row).map(entry =>
    entry.label
      ? '<li><b>' + esc(entry.label) + '</b></li>'
      : '<li><span>' + esc(entry.value) + '</span></li>'
  ).join('');

  $('#front-card').innerHTML =
    '<section class="front-panel">' +
      '<div class="front-head">' +
        '<img class="enaex-logo" src="assets/enaex.png" alt="Enaex Brasil">' +
        '<div class="credential">' +
          '<img class="seal" src="assets/chi.png" alt="Controle crítico">' +
          '<div class="badge-register"><b>REGISTRO</b><span>' + esc(id) + '</span></div>' +
        '</div>' +
        '<span class="version">VER. 1.1</span>' +
      '</div>' +
      '<div class="portrait-row">' + photo +
        '<div class="identity-fields">' + field('NOME', name) + field('FUNÇÃO', txt(row, 2)) + '</div>' +
      '</div>' +
      '<div class="microgrid">' + field('EMPRESA', txt(row, 3)) + field('SETOR', txt(row, 4)) + '</div>' +
      '<section class="restricted">' +
        '<div class="restricted-areas"><div class="restricted-heading"><b>AREAS RESTRITAS</b></div><ul>' + areaRows + '</ul></div>' +
        '<div class="validity-column"><div class="restricted-heading"><b>ASO</b></div><ul>' + validityRows + '</ul></div>' +
      '</section>' +
      '<div class="validity">CONTROLE DE HABILITAÇÃO INTERNA<br>(C.H.I)</div>' +
    '</section>';

  const groups = readGroups(row);
  const training = groups.map(group =>
    '<section class="training-group">' +
      '<div class="back-head"><span>' + esc(group.title) + '</span><b>VALIDADE</b></div>' +
      '<ul>' + group.items.map(entry =>
        '<li><span>' + esc(entry.name) + '</span><b>' + esc(entry.date) + '</b></li>'
      ).join('') + '</ul>' +
    '</section>'
  ).join('') || '<div class="permission-empty">—</div>';
  const serial = txt(row, 70) || 'T.I MVV';
  $('#back-card').innerHTML =
    '<section class="back-panel"><div class="permissions">' + training + '</div>' +
      '<div class="authorization">' +
        '<div class="back-head"><span>AUTORIZADO A PORTAR</span><b>SERIAL</b></div>' +
        '<div class="license">' + esc(serial) + '</div>' +
        '<div class="signature"><span></span><b>SSO MVV</b></div>' +
      '</div>' +
    '</section>';

  $('#photo').value = '';
  $('#pdf').disabled = false;
  $('#png').disabled = false;
  $('#photo').disabled = false;
}

function clearResult() {
  selected = null;
  $('#result').hidden = true;
  $('#empty').hidden = false;
  $('#empty').textContent = 'Digite o nome ou o registro do colaborador.';
  $('#pdf').disabled = true;
  $('#png').disabled = true;
  $('#photo').disabled = true;
}

function search() {
  const value = $('#registro').value.trim();
  const key = normalize(value);
  $('#error').hidden = true;
  if (!value) {
    $('#error').textContent = 'Digite o nome ou o registro do colaborador.';
    $('#error').hidden = false;
    return;
  }
  const exactId = staff.find(candidate => candidate.id === value);
  const exactNames = staff.filter(candidate => normalize(txt(candidate.cells, 1)) === key);
  let person = exactId || (exactNames.length === 1 ? exactNames[0] : null);
  if (!person) {
    const matches = staff.filter(candidate =>
      normalize(candidate.id).includes(key) || normalize(txt(candidate.cells, 1)).includes(key)
    );
    $('#error').textContent = exactNames.length > 1 || matches.length > 1
      ? 'Mais de um colaborador corresponde. Refine o nome ou informe o registro.'
      : 'Colaborador não encontrado.';
    $('#error').hidden = false;
    return;
  }
  $('#registro').value = person.id;
  selected = person;
  render(person);
}

const svgText = (x, y, value, size = 18, weight = 400, color = '#111', anchor = 'start') =>
  '<text x="' + x + '" y="' + y + '" font-family="Calibri,Arial,Helvetica,sans-serif" font-size="' + size
  + '" font-weight="' + weight + '" fill="' + color + '" text-anchor="' + anchor + '">' + xml(value) + '</text>';
const truncate = (value, limit) => String(value || '—').length > limit
  ? String(value || '—').slice(0, limit - 1) + '…' : String(value || '—');
const svgField = (x, y, width, height, label, value, size = 20) => {
  const compact = height <= 70;
  return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" fill="white" stroke="#222"/>'
    + svgText(x + 9, y + (compact ? 18 : 22), label, 16, 700)
    + svgText(x + 9, y + (compact ? 42 : 50), truncate(value, 33), size, 400);
};

function exportSnapshot(person = selected) {
  if (!person) return null;
  return {
    id: person.id,
    cells: person.cells,
    photoSrc: photoSource(person.id, readStoredPhoto(person.id))
  };
}

async function badgeSvg(panel, person = selected) {
  if (!person) throw new Error('Selecione um colaborador antes de exportar.');
  const row = person.cells;
  const id = person.id;
  const photoSrc = person.photoSrc ?? photoSource(id, readStoredPhoto(id));
  const [logoBlob, sealBlob] = await Promise.all([
    fetch('assets/enaex.png').then(response => {
      if (!response.ok) throw new Error('Não foi possível carregar a marca Enaex.');
      return response.blob();
    }),
    fetch('assets/chi.png').then(response => {
      if (!response.ok) throw new Error('Não foi possível carregar o selo CHI.');
      return response.blob();
    })
  ]);
  const asDataUrl = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const [logoUrl, sealUrl] = await Promise.all([asDataUrl(logoBlob), asDataUrl(sealBlob)]);
  let photoUrl = '';
  if (photoSrc) {
    try {
      photoUrl = await asDataUrl(await fetch(photoSrc).then(response => {
        if (!response.ok) throw new Error('Foto indisponível');
        return response.blob();
      }));
    } catch (_) {}
  }
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3600" viewBox="0 0 600 900">'
    + '<rect x="2" y="2" width="596" height="896" fill="#fff" stroke="#111" stroke-width="2"/>';

  if (panel.id === 'front-card') {
    svg += '<image href="' + logoUrl + '" x="25" y="39" width="235" height="84" preserveAspectRatio="xMinYMid meet"/>'
      + svgText(576, 22, 'VER. 1.1', 14, 400, '#111', 'end')
      + '<image href="' + sealUrl + '" x="453" y="35" width="105" height="90" preserveAspectRatio="xMidYMid meet"/>'
      + '<rect x="446" y="153" width="120" height="70" fill="white" stroke="#111"/>'
      + svgText(506, 176, 'REGISTRO', 17, 700, '#111', 'middle')
      + svgText(506, 215, id, 22, 400, '#111', 'middle')
      + '<rect x="22" y="178" width="174" height="245" fill="#e7e9ea" stroke="#555"/>';
    if (photoUrl) svg += '<image href="' + photoUrl + '" x="24" y="180" width="170" height="241" preserveAspectRatio="xMidYMid slice"/>';
    else svg += svgText(109, 315, 'FOTO', 20, 600, '#858b90', 'middle');
    svg += svgField(230, 256, 336, 67, 'NOME', txt(row, 1), 20)
      + svgField(230, 357, 336, 67, 'FUNÇÃO', txt(row, 2), 20)
      + '<rect x="22" y="459" width="556" height="72" fill="white" stroke="#222"/>'
      + '<line x1="406" y1="459" x2="406" y2="531" stroke="#222"/>'
      + svgText(31, 481, 'EMPRESA', 16, 700)
      + svgText(31, 509, txt(row, 3), 20, 400)
      + svgText(415, 481, 'SETOR', 16, 700)
      + svgText(415, 509, txt(row, 4), 20, 400)
      + '<rect x="22" y="558" width="556" height="203" fill="white" stroke="#333"/>'
      + '<line x1="405" y1="558" x2="405" y2="761" stroke="#444"/>'
      + '<line x1="22" y1="594" x2="578" y2="594" stroke="#444"/>'
      + svgText(31, 582, 'AREAS RESTRITAS', 16, 700)
      + svgText(491.5, 582, 'ASO', 16, 700, '#111', 'middle');
    [627, 660, 694, 727].forEach(y => {
      svg += '<line x1="405" y1="' + y + '" x2="578" y2="' + y + '" stroke="#666"/>';
    });
    const areas = restrictedAreas(row);
    areas.forEach((area, index) => {
      const y = 594 + (167 / 4) * (index + .55);
      svg += '<rect x="31" y="' + (y - 9) + '" width="10" height="10" fill="white" stroke="#111" stroke-width="1" stroke-dasharray="2 1"/>'
        + (area.active ? svgText(36, y - 1, 'X', 8, 700, '#111', 'middle') : '')
        + svgText(50, y, area.name, 18, 400)
        + svgText(397, y, area.date, 18, 700, '#111', 'end');
    });
    documentValidity(row).forEach((entry, index) => {
      const y = 616 + index * 33;
      if (entry.label) {
        svg += svgText(491.5, y, entry.label, 14, 700, '#111', 'middle');
      } else {
        svg += svgText(491.5, y, entry.value, 15, 400, '#111', 'middle');
      }
    });
    svg += '<rect x="22" y="778" width="556" height="94" fill="#21653d"/>'
      + svgText(300, 818, 'CONTROLE DE HABILITAÇÃO INTERNA', 18, 700, '#fff', 'middle')
      + svgText(300, 847, '(C.H.I)', 17, 700, '#fff', 'middle');
  } else {
    const groups = readGroups(row);
    const itemCount = groups.reduce((count, group) => count + group.items.length, 0);
    const rowStep = Math.max(14, Math.min(34, (606 - groups.length * 39) / Math.max(itemCount, 1)));
    let y = 15;
    groups.forEach(group => {
      svg += '<rect x="12" y="' + y + '" width="576" height="38" fill="#454c53"/>'
        + svgText(23, y + 25, group.title, 16, 700, '#fff')
        + svgText(577, y + 25, 'VALIDADE', 15, 700, '#fff', 'end');
      y += 38;
      const fontSize = Math.max(12, Math.min(20, rowStep * .7));
      group.items.forEach(entry => {
        y += rowStep;
        svg += svgText(23, y, truncate(entry.name, 52), fontSize, 400)
          + svgText(577, y, entry.date, fontSize, 400, '#111', 'end');
      });
      y += 8;
    });
    svg += '<rect x="12" y="624" width="576" height="156" fill="white" stroke="#333"/>'
      + '<rect x="12" y="624" width="576" height="38" fill="#454c53"/>'
      + svgText(23, 650, 'AUTORIZADO A PORTAR', 16, 700, '#fff')
      + svgText(577, 650, 'SERIAL', 16, 700, '#fff', 'end')
      + svgText(300, 744, txt(row, 70) || 'T.I MVV', 16, 400, '#111', 'middle')
      + '<rect x="12" y="780" width="576" height="104" fill="white" stroke="#333"/>'
      + '<line x1="180" y1="834" x2="420" y2="834" stroke="#333" stroke-width="2"/>'
      + svgText(300, 865, 'SSO MVV', 16, 400, '#111', 'middle');
  }
  return svg + '</svg>';
}

async function cardCanvas(panel, person = selected) {
  const svg = await badgeSvg(panel, person);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 3600;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(url, name) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportPng() {
  const person = exportSnapshot();
  if (!person) return;
  const filenameId = String(person.id).replace(/[\\/:*?"<>|]/g, '_');
  try {
    const files = [];
    for (const [panel, side] of [[$('#front-card'), 'frente'], [$('#back-card'), 'verso']]) {
      const canvas = await cardCanvas(panel, person);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(file => file ? resolve(file) : reject(new Error('Falha ao gerar imagem.')), 'image/png')
      );
      files.push({ name: 'cracha-' + filenameId + '-' + side + '.png', bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(URL.createObjectURL(createZip(files)), 'cracha-' + filenameId + '.zip');
  } catch (error) {
    $('#error').textContent = error.message;
    $('#error').hidden = false;
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function put16(view, offset, value) { view.setUint16(offset, value, true); }
function put32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    put32(lv, 0, 0x04034b50); put16(lv, 4, 20); put16(lv, 6, 0x0800);
    put16(lv, 8, 0); put32(lv, 14, crc); put32(lv, 18, file.bytes.length);
    put32(lv, 22, file.bytes.length); put16(lv, 26, name.length); local.set(name, 30);
    localParts.push(local, file.bytes);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    put32(cv, 0, 0x02014b50); put16(cv, 4, 20); put16(cv, 6, 20); put16(cv, 8, 0x0800);
    put16(cv, 10, 0); put32(cv, 16, crc); put32(cv, 20, file.bytes.length);
    put32(cv, 24, file.bytes.length); put16(cv, 28, name.length); put32(cv, 42, localOffset);
    central.set(name, 46); centralParts.push(central);
    localOffset += local.length + file.bytes.length;
  }
  const centralDirectory = concatenate(centralParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  put32(ev, 0, 0x06054b50); put16(ev, 8, files.length); put16(ev, 10, files.length);
  put32(ev, 12, centralDirectory.length); put32(ev, 16, localOffset);
  return new Blob([concatenate([...localParts, centralDirectory, end])], { type: 'application/zip' });
}

function concatenate(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function jpegBytes(panel, person) {
  const canvas = await cardCanvas(panel, person);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(file => file ? resolve(file) : reject(new Error('Falha ao preparar o PDF.')), 'image/jpeg', .96)
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function createPdf(pages) {
  const encoder = new TextEncoder();
  const objects = [];
  objects[1] = encoder.encode('<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pages.map((_, index) => 3 + index * 4);
  objects[2] = encoder.encode('<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  const width = '595.276';
  const height = '841.890';
  const cardWidth = '138.898';
  const cardHeight = '208.346';
  const x1 = '28.346';
  const x2 = '171.779';
  const y = '615.402';
  pages.forEach((images, index) => {
    const pageId = 3 + index * 4, contentId = pageId + 1, frontId = pageId + 2, backId = pageId + 3;
    const content = encoder.encode('q\n' + cardWidth + ' 0 0 ' + cardHeight + ' ' + x1 + ' ' + y + ' cm\n/Front Do\nQ\n'
      + 'q\n' + cardWidth + ' 0 0 ' + cardHeight + ' ' + x2 + ' ' + y + ' cm\n/Back Do\nQ\n');
    objects[pageId] = encoder.encode('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height
      + '] /Resources << /XObject << /Front ' + frontId + ' 0 R /Back ' + backId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    objects[contentId] = concatenate([encoder.encode('<< /Length ' + content.length + ' >>\nstream\n'), content, encoder.encode('endstream')]);
    images.forEach((jpeg, side) => {
      const imageId = side === 0 ? frontId : backId;
      objects[imageId] = concatenate([
        encoder.encode('<< /Type /XObject /Subtype /Image /Width 2400 /Height 3600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'),
        jpeg, encoder.encode('\nendstream')
      ]);
    });
  });
  const parts = [encoder.encode('%PDF-1.4\n')];
  const offsets = [0];
  let length = parts[0].length;
  const objectCount = 2 + pages.length * 4;
  for (let index = 1; index <= objectCount; index++) {
    offsets[index] = length;
    const head = encoder.encode(index + ' 0 obj\n');
    const tail = encoder.encode('\nendobj\n');
    parts.push(head, objects[index], tail);
    length += head.length + objects[index].length + tail.length;
  }
  const xref = length;
  let table = 'xref\n0 ' + (objectCount + 1) + '\n0000000000 65535 f \n';
  for (let index = 1; index <= objectCount; index++) table += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
  table += 'trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  parts.push(encoder.encode(table));
  return new Blob([concatenate(parts)], { type: 'application/pdf' });
}

function renderPdfStaff() {
  const term = normalize($('#pdf-search').value);
  const matches = staff.filter(person => normalize(person.id + ' ' + txt(person.cells, 1)).includes(term));
  $('#pdf-staff-list').innerHTML = matches.map(person => '<label class="pdf-staff-option"><input type="checkbox" data-id="' + esc(person.id) + '"'
    + (pdfSelectedIds.has(person.id) ? ' checked' : '') + '><span><b>' + esc(txt(person.cells, 1)) + '</b><small>Registro ' + esc(person.id) + '</small></span></label>').join('')
    || '<div class="sheet-empty">Nenhum colaborador encontrado.</div>';
  $('#pdf-selection-count').textContent = pdfSelectedIds.size + ' selecionado(s)';
  $('#pdf-generate').disabled = !pdfSelectedIds.size;
}

async function exportPdf() {
  const people = staff.filter(person => pdfSelectedIds.has(person.id)).map(person => ({
    id: person.id, cells: person.cells, photoSrc: photoSource(person.id, readStoredPhoto(person.id))
  }));
  if (!people.length) return;
  const button = $('#pdf-generate');
  button.disabled = true;
  button.textContent = 'Preparando 0/' + people.length + '…';
  try {
    const pages = [];
    for (let index = 0; index < people.length; index++) {
      pages.push(await Promise.all([jpegBytes($('#front-card'), people[index]), jpegBytes($('#back-card'), people[index])]));
      button.textContent = 'Preparando ' + (index + 1) + '/' + people.length + '…';
    }
    download(URL.createObjectURL(createPdf(pages)), 'chi-colaboradores.pdf');
    $('#pdf-dialog').close();
  } catch (error) {
    $('#error').textContent = error.message;
    $('#error').hidden = false;
  } finally {
    button.textContent = 'Baixar PDF';
    renderPdfStaff();
  }
}

$('#registro').addEventListener('input', updateSuggestions);
$('#search').addEventListener('click', search);
$('#registro').addEventListener('keydown', event => {
  if (event.key === 'Enter') search();
});
$('#refresh').addEventListener('click', loadData);
$('#sheet-open').addEventListener('click', () => {
  activeSheet = 'Matriz';
  $('#sheet-filter').value = '';
  updateSheetLabels();
  renderSheet();
  $('#sheet-dialog').showModal();
});
$('#fill-sheet').addEventListener('click', () => {
  $('#sheet-password').value = '';
  $('#sheet-auth-error').hidden = true;
  $('#sheet-auth-dialog').showModal();
  $('#sheet-password').focus();
});
$('#sheet-auth-close').addEventListener('click', () => $('#sheet-auth-dialog').close());
$('#sheet-auth-cancel').addEventListener('click', () => $('#sheet-auth-dialog').close());
$('#sheet-auth-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('#sheet-password').value !== 'Admin') {
    $('#sheet-auth-error').hidden = false;
    $('#sheet-password').focus();
    $('#sheet-password').select();
    return;
  }
  const link = document.createElement('a');
  link.href = SHEET_EDIT_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
  $('#sheet-auth-dialog').close();
});
$('#sheet-close').addEventListener('click', () => $('#sheet-dialog').close());
$('#sheet-tab-matrix').addEventListener('click', () => {
  activeSheet = 'Matriz';
  renderSheet();
});
$('#sheet-tab-training').addEventListener('click', () => {
  activeSheet = 'Treinamentos';
  renderSheet();
});
$('#sheet-filter').addEventListener('input', renderSheet);
$('#sheet-content').addEventListener('input', event => {
  const input = event.target.closest('.column-filter');
  if (!input) return;
  const column = input.dataset.column;
  sheetColumnFilters[activeSheet][column] = input.value;
  const selection = input.selectionStart;
  renderSheet();
  const replacement = $('#sheet-content').querySelector('.column-filter[data-column="' + column + '"]');
  replacement?.focus();
  replacement?.setSelectionRange(selection, selection);
});
$('#sheet-dialog').addEventListener('click', event => {
  if (event.target === $('#sheet-dialog')) $('#sheet-dialog').close();
});
$('#pdf').addEventListener('click', () => {
  pdfSelectedIds = new Set(selected ? [selected.id] : []);
  $('#pdf-search').value = '';
  renderPdfStaff();
  $('#pdf-dialog').showModal();
  $('#pdf-search').focus();
});
$('#pdf-close').addEventListener('click', () => $('#pdf-dialog').close());
$('#pdf-cancel').addEventListener('click', () => $('#pdf-dialog').close());
$('#pdf-search').addEventListener('input', renderPdfStaff);
$('#pdf-staff-list').addEventListener('change', event => {
  const input = event.target.closest('input[data-id]');
  if (!input) return;
  if (input.checked) pdfSelectedIds.add(input.dataset.id);
  else pdfSelectedIds.delete(input.dataset.id);
  renderPdfStaff();
});
$('#pdf-select-visible').addEventListener('click', () => {
  $('#pdf-staff-list').querySelectorAll('input[data-id]').forEach(input => pdfSelectedIds.add(input.dataset.id));
  renderPdfStaff();
});
$('#pdf-clear').addEventListener('click', () => { pdfSelectedIds.clear(); renderPdfStaff(); });
$('#pdf-generate').addEventListener('click', exportPdf);
$('#png').addEventListener('click', exportPng);
$('#photo').addEventListener('change', event => {
  const file = event.target.files?.[0];
  const personId = selected?.id;
  if (!file || !personId) return;
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    $('#error').textContent = 'Escolha uma imagem raster válida (JPG, PNG ou WebP).';
    $('#error').hidden = false;
    event.target.value = '';
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    $('#error').textContent = 'A imagem deve ter no máximo 4 MB.';
    $('#error').hidden = false;
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      try {
        localStorage.setItem('badge-photo-' + personId, reader.result);
        if (selected?.id === personId) render(selected);
      } catch (_) {
        if (selected?.id !== personId) return;
        $('#error').textContent = 'Não há espaço local disponível para salvar esta foto.';
        $('#error').hidden = false;
      }
    };
    image.onerror = () => {
      if (selected?.id !== personId) return;
      $('#error').textContent = 'O arquivo escolhido não é uma imagem válida.';
      $('#error').hidden = false;
    };
    image.src = reader.result;
  };
  reader.onerror = () => {
    if (selected?.id !== personId) return;
    $('#error').textContent = 'Não foi possível ler a imagem escolhida.';
    $('#error').hidden = false;
  };
  reader.readAsDataURL(file);
});

loadData();
