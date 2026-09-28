const SHEET_ID = '1R4h8YtBFPDzD70DlNZQ88C7nJ9Gd9Yfd';
const API = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq';
const $ = selector => document.querySelector(selector);

let staff = [];
let photoMap = {};
let matrixTable = null;
let trainingTable = null;
let activeSheet = 'Matriz';
let selected = null;
let requestNo = 0;

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

function formatMonthYear(value) {
  const text = formatDate(value);
  const match = text.match(/^\d{2}\/(\d{2})\/(\d{4})$/);
  if (!match) return text;
  const month = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(match[1]) - 1];
  return month ? month + '-' + match[2].slice(-2) : text;
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
      name: headerName(index),
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
      label: column.label || ('Coluna ' + (index + 1))
    })),
    rows
  };
}

function sheetRows(table) {
  return sheetData(table).rows;
}

function updateSheetLabels() {
  const matrixCount = sheetRows(matrixTable).length;
  const trainingCount = sheetRows(trainingTable).length;
  $('#sheet-tab-matrix').textContent = 'Matriz · ' + matrixCount;
  $('#sheet-tab-training').textContent = 'Treinamentos · ' + trainingCount;
}

function renderSheet() {
  const table = activeSheet === 'Matriz' ? matrixTable : trainingTable;
  if (!table) return;
  const data = sheetData(table);
  const allRows = data.rows;
  const term = normalize($('#sheet-filter').value);
  const rows = term
    ? allRows.filter(row => normalize(row.join(' ')).includes(term))
    : allRows;
  $('#sheet-tab-matrix').setAttribute('aria-selected', String(activeSheet === 'Matriz'));
  $('#sheet-tab-training').setAttribute('aria-selected', String(activeSheet === 'Treinamentos'));
  $('#sheet-count').textContent = rows.length + ' / ' + allRows.length;
  if (!rows.length) {
    $('#sheet-content').innerHTML = '<div class="sheet-empty">Nenhuma linha encontrada.</div>';
    return;
  }
  const headers = data.columns.map(column =>
    '<th scope="col">' + esc(column.label) + '</th>'
  ).join('');
  const body = rows.map(row => '<tr>' + row.map(value =>
    '<td>' + esc(value) + '</td>'
  ).join('') + '</tr>').join('');
  $('#sheet-content').innerHTML = '<table class="sheet-table"><thead><tr>' + headers
    + '</tr></thead><tbody>' + body + '</tbody></table>';
}

async function loadData() {
  const thisRequest = ++requestNo;
  setStatus('Conectando à planilha…');
  $('#error').hidden = true;
  try {
    const [matrix, trainings, photos] = await Promise.all([
      query('Matriz', 3),
      query('Treinamentos', 1),
      fetch('assets/photos.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : {}).catch(() => ({}))
    ]);
    if (thisRequest !== requestNo) return;
    photoMap = photos;
    matrixTable = matrix;
    trainingTable = trainings;
    window.__headers = matrix.cols.map(column => column.label || '');
    staff = matrix.rows.map(row => ({ cells: row, id: txt(row, 0) })).filter(person => person.id);
    setStatus('Planilha atualizada · ' + staff.length + ' colaboradores');
    updateSuggestions();
    updateSheetLabels();
    $('#sheet-open').disabled = false;
    if ($('#sheet-dialog').open) renderSheet();
    if (selected) {
      const updated = staff.find(person => person.id === selected.id);
      if (updated) {
        selected = updated;
        render(selected);
      } else clearResult();
    }
  } catch (error) {
    if (thisRequest !== requestNo) return;
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

  const stored = localStorage.getItem('badge-photo-' + id);
  const photoSrc = photoSource(id, stored);
  const photo = photoSrc
    ? '<img class="portrait" crossorigin="anonymous" alt="Foto de ' + esc(name) + '" src="' + esc(photoSrc) + '" onerror="this.classList.add(\'photo-failed\')">'
    : '<div class="portrait photo-empty" role="img" aria-label="Foto não cadastrada">FOTO</div>';

  const areas = [11, 12, 13, 14].map(index => ({
    name: headerName(index).replace(/^MIN$/i, 'MINA'),
    date: formatMonthYear(txt(row, index))
  })).filter(area => area.name && area.date);
  const areaRows = areas.map(area =>
    '<li><span>' + esc(area.name) + '</span><b>' + esc(area.date) + '</b></li>'
  ).join('') || '<li class="no-area">—</li>';
  const validity = [
    ['ASO', formatDate(txt(row, 7))],
    ['INTEGR. VAL', formatDate(txt(row, 6))],
    ['CNH VAL.', formatDate(txt(row, 10))]
  ].filter(([, date]) => date);
  const validityRows = validity.map(([label, date]) =>
    '<li><b>' + esc(label) + '</b><span>' + esc(date) + '</span></li>'
  ).join('') || '<li><span>—</span></li>';

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
        '<div class="restricted-areas"><div class="restricted-heading"><b>ÁREAS RESTRITAS</b><span>VALIDADE</span></div><ul>' + areaRows + '</ul></div>' +
        '<div class="validity-column"><div class="restricted-heading"><b>DOCUMENTOS</b><span>VALIDADE</span></div><ul>' + validityRows + '</ul></div>' +
      '</section>' +
      '<div class="validity">CONTROLE DE HABILITAÇÃO INTERNA<br>(C.H.I.)</div>' +
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
  const serial = txt(row, 70) || 'T.I. MVV';
  $('#back-card').innerHTML =
    '<section class="back-panel"><div class="permissions">' + training + '</div>' +
      '<div class="authorization">' +
        '<div class="back-head"><span>AUTORIZADO A PORTAR</span><b>SERIAL</b></div>' +
        '<div class="license">' + esc(serial) + '</div>' +
        '<div class="signature"><span></span><b>SSO MVVV</b></div>' +
      '</div>' +
    '</section>';

  $('#photo').value = '';
  $('#pdf').disabled = false;
  $('#png').disabled = false;
}

function clearResult() {
  selected = null;
  $('#result').hidden = true;
  $('#empty').hidden = false;
  $('#empty').textContent = 'Digite o nome ou o registro do colaborador.';
  $('#pdf').disabled = true;
  $('#png').disabled = true;
}

function search() {
  const value = $('#registro').value.trim();
  const key = normalize(value);
  if (!value) return;
  $('#error').hidden = true;
  let person = staff.find(candidate => candidate.id === value || normalize(txt(candidate.cells, 1)) === key);
  if (!person) {
    const matches = staff.filter(candidate =>
      normalize(candidate.id).includes(key) || normalize(txt(candidate.cells, 1)).includes(key)
    );
    if (matches.length === 1) person = matches[0];
    else {
      $('#error').textContent = matches.length > 1
        ? 'Selecione o colaborador nas sugestões.'
        : 'Colaborador não encontrado.';
      $('#error').hidden = false;
      return;
    }
  }
  $('#registro').value = person.id;
  selected = person;
  render(person);
}

const svgText = (x, y, value, size = 18, weight = 400, color = '#111', anchor = 'start') =>
  '<text x="' + x + '" y="' + y + '" font-family="Arial,Helvetica,sans-serif" font-size="' + size
  + '" font-weight="' + weight + '" fill="' + color + '" text-anchor="' + anchor + '">' + xml(value) + '</text>';
const truncate = (value, limit) => String(value || '—').length > limit
  ? String(value || '—').slice(0, limit - 1) + '…' : String(value || '—');
const svgField = (x, y, width, height, label, value, size = 18) =>
  '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" fill="white" stroke="#222"/>'
  + svgText(x + 9, y + 22, label, 14, 700)
  + svgText(x + 9, y + 50, truncate(value, 33), size, 400);

async function badgeSvg(panel) {
  const row = selected.cells;
  const id = selected.id;
  const stored = localStorage.getItem('badge-photo-' + id);
  const photoSrc = photoSource(id, stored);
  const [logoBlob, sealBlob] = await Promise.all([
    fetch('assets/enaex.png').then(response => response.blob()),
    fetch('assets/chi.png').then(response => response.blob())
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
    + '<rect x="2" y="2" width="596" height="896" fill="#fff" stroke="#111" stroke-width="2"/>'
    + '<rect x="12" y="12" width="576" height="876" fill="none" stroke="#555" stroke-width="1" stroke-dasharray="3 3"/>';

  if (panel.id === 'front-card') {
    svg += '<image href="' + logoUrl + '" x="25" y="39" width="235" height="84" preserveAspectRatio="xMinYMid meet"/>'
      + svgText(576, 22, 'VER. 1.1', 14, 400, '#111', 'end')
      + '<image href="' + sealUrl + '" x="473" y="22" width="92" height="101" preserveAspectRatio="xMidYMid meet"/>'
      + '<rect x="466" y="124" width="105" height="53" fill="white" stroke="#111"/>'
      + svgText(518.5, 145, 'REGISTRO', 14, 700, '#111', 'middle')
      + svgText(518.5, 166, id, 18, 400, '#111', 'middle')
      + '<rect x="22" y="183" width="174" height="248" fill="#e7e9ea" stroke="#555"/>';
    if (photoUrl) svg += '<image href="' + photoUrl + '" x="24" y="185" width="170" height="244" preserveAspectRatio="xMidYMid slice"/>';
    else svg += svgText(109, 315, 'FOTO', 20, 600, '#858b90', 'middle');
    svg += svgField(206, 256, 372, 76, 'NOME', txt(row, 1), 18)
      + svgField(206, 339, 372, 76, 'FUNÇÃO', txt(row, 2), 18)
      + svgField(22, 454, 278, 72, 'EMPRESA', txt(row, 3), 18)
      + svgField(300, 454, 278, 72, 'SETOR', txt(row, 4), 18)
      + '<rect x="22" y="545" width="556" height="216" fill="white" stroke="#333"/>'
      + '<line x1="326" y1="545" x2="326" y2="761" stroke="#444"/>'
      + '<line x1="22" y1="579" x2="578" y2="579" stroke="#444"/>'
      + svgText(31, 568, 'ÁREAS RESTRITAS', 15, 700)
      + svgText(316, 568, 'VALIDADE', 13, 700, '#111', 'end')
      + svgText(338, 568, 'DOCUMENTOS', 15, 700)
      + svgText(568, 568, 'VALIDADE', 13, 700, '#111', 'end');
    const areas = [11, 12, 13, 14].map(index => ({
      name: headerName(index).replace(/^MIN$/i, 'MINA'),
      date: formatMonthYear(txt(row, index))
    })).filter(area => area.name && area.date);
    areas.forEach((area, index) => {
      const y = 610 + index * 35;
      svg += svgText(32, y, area.name, 15, 400)
        + svgText(316, y, area.date, 15, 700, '#111', 'end');
    });
    const validity = [
      ['ASO', formatDate(txt(row, 7))],
      ['INTEGR. VAL', formatDate(txt(row, 6))],
      ['CNH VAL.', formatDate(txt(row, 10))]
    ].filter(([, date]) => date);
    validity.forEach(([label, date], index) => {
      const y = 608 + index * 43;
      svg += svgText(338, y, label, 13, 700) + svgText(568, y, date, 13, 400, '#111', 'end');
    });
    svg += '<rect x="22" y="778" width="556" height="94" fill="#08643f"/>'
      + svgText(300, 818, 'CONTROLE DE HABILITAÇÃO INTERNA', 18, 700, '#fff', 'middle')
      + svgText(300, 847, '(C.H.I.)', 17, 700, '#fff', 'middle');
  } else {
    const groups = readGroups(row);
    const itemCount = groups.reduce((count, group) => count + group.items.length, 0);
    const rowStep = Math.max(14, Math.min(34, (606 - groups.length * 39) / Math.max(itemCount, 1)));
    let y = 15;
    groups.forEach(group => {
      svg += '<rect x="12" y="' + y + '" width="576" height="38" fill="#454c53"/>'
        + svgText(23, y + 25, group.title, 14, 700, '#fff')
        + svgText(577, y + 25, 'VALIDADE', 13, 700, '#fff', 'end');
      y += 38;
      const fontSize = Math.max(10, Math.min(15, rowStep * .54));
      group.items.forEach(entry => {
        y += rowStep;
        svg += svgText(23, y, truncate(entry.name, 52), fontSize, 400)
          + svgText(577, y, entry.date, fontSize, 400, '#111', 'end');
      });
      y += 8;
    });
    svg += '<rect x="12" y="624" width="576" height="136" fill="white" stroke="#333" stroke-dasharray="3 3"/>'
      + '<rect x="12" y="624" width="576" height="38" fill="#454c53"/>'
      + svgText(23, 650, 'AUTORIZADO A PORTAR', 14, 700, '#fff')
      + svgText(577, 650, 'SERIAL', 14, 700, '#fff', 'end')
      + svgText(300, 726, txt(row, 70) || 'T.I. MVV', 14, 400, '#111', 'middle')
      + '<rect x="12" y="760" width="576" height="112" fill="white" stroke="#333" stroke-dasharray="3 3"/>'
      + '<line x1="180" y1="819" x2="420" y2="819" stroke="#333" stroke-width="2"/>'
      + svgText(300, 850, 'SSO MVVV', 14, 400, '#111', 'middle');
  }
  return svg + '</svg>';
}

async function cardCanvas(panel) {
  const svg = await badgeSvg(panel);
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
  if (!selected) return;
  try {
    for (const [panel, side] of [[$('#front-card'), 'frente'], [$('#back-card'), 'verso']]) {
      const canvas = await cardCanvas(panel);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(file => file ? resolve(file) : reject(new Error('Falha ao gerar imagem.')), 'image/png')
      );
      download(URL.createObjectURL(blob), 'cracha-' + selected.id + '-' + side + '.png');
    }
  } catch (error) {
    $('#error').textContent = error.message;
    $('#error').hidden = false;
  }
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

async function jpegBytes(panel) {
  const canvas = await cardCanvas(panel);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(file => file ? resolve(file) : reject(new Error('Falha ao preparar o PDF.')), 'image/jpeg', .96)
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function createPdf(images) {
  const encoder = new TextEncoder();
  const objects = [];
  objects[1] = encoder.encode('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = encoder.encode('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>');
  const width = (54 * 72 / 25.4).toFixed(3);
  const height = (81 * 72 / 25.4).toFixed(3);
  for (let page = 0; page < 2; page++) {
    const pageObject = 3 + page * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const jpeg = images[page];
    const content = encoder.encode('q\n' + width + ' 0 0 ' + height + ' 0 0 cm\n/Im0 Do\nQ\n');
    objects[pageObject] = encoder.encode('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height
      + '] /Resources << /XObject << /Im0 ' + imageObject + ' 0 R >> >> /Contents ' + contentObject + ' 0 R >>');
    objects[contentObject] = concatenate([
      encoder.encode('<< /Length ' + content.length + ' >>\nstream\n'),
      content,
      encoder.encode('endstream')
    ]);
    objects[imageObject] = concatenate([
      encoder.encode('<< /Type /XObject /Subtype /Image /Width 2400 /Height 3600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'),
      jpeg,
      encoder.encode('\nendstream')
    ]);
  }
  const parts = [encoder.encode('%PDF-1.4\n')];
  const offsets = [0];
  let length = parts[0].length;
  for (let index = 1; index <= 8; index++) {
    offsets[index] = length;
    const head = encoder.encode(index + ' 0 obj\n');
    const tail = encoder.encode('\nendobj\n');
    parts.push(head, objects[index], tail);
    length += head.length + objects[index].length + tail.length;
  }
  const xref = length;
  let table = 'xref\n0 9\n0000000000 65535 f \n';
  for (let index = 1; index <= 8; index++) table += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
  table += 'trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  parts.push(encoder.encode(table));
  return new Blob([concatenate(parts)], { type: 'application/pdf' });
}

async function exportPdf() {
  if (!selected) return;
  try {
    const images = [];
    for (const panel of [$('#front-card'), $('#back-card')]) images.push(await jpegBytes(panel));
    download(URL.createObjectURL(createPdf(images)), 'cracha-' + selected.id + '.pdf');
  } catch (error) {
    $('#error').textContent = error.message;
    $('#error').hidden = false;
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
$('#sheet-dialog').addEventListener('click', event => {
  if (event.target === $('#sheet-dialog')) $('#sheet-dialog').close();
});
$('#pdf').addEventListener('click', exportPdf);
$('#png').addEventListener('click', exportPng);
$('#photo').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file || !selected) return;
  if (file.size > 4 * 1024 * 1024) {
    $('#error').textContent = 'A imagem deve ter no máximo 4 MB.';
    $('#error').hidden = false;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      localStorage.setItem('badge-photo-' + selected.id, reader.result);
      render(selected);
    } catch (_) {
      $('#error').textContent = 'Não há espaço local disponível para salvar esta foto.';
      $('#error').hidden = false;
    }
  };
  reader.readAsDataURL(file);
});

loadData();
