const SPREADSHEET_ID = '1iOH7Erj9IcNcgko1Ur57Ffs5kiAm3eX4HVLs6R151EM';
const PLAYLIST_SHEET = 'Playlist';
const CONFIG_SHEET = 'Config';
const VISITS_SHEET = 'Visitas';
const NOTICES_SHEET = 'Avisos';
const SPONSORS_SHEET = 'Patrocinio';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'playlist';
  if (action === 'visit') return registerVisit_(e.parameter || {});
  return getPlaylistPayload_();
}

function getPlaylistPayload_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const playlistSheet = spreadsheet.getSheetByName(PLAYLIST_SHEET);
  const configSheet = spreadsheet.getSheetByName(CONFIG_SHEET);
  const noticesSheet = spreadsheet.getSheetByName(NOTICES_SHEET);
  const sponsorsSheet = spreadsheet.getSheetByName(SPONSORS_SHEET);
  if (!playlistSheet) throw new Error('Aba Playlist não encontrada.');

  const rows = playlistSheet.getDataRange().getDisplayValues();
  const headers = rows.shift().map(normalize_);
  const col = name => headers.indexOf(normalize_(name));
  const numberCol = col('numero_faixa');
  const orderCol = col('ordem');
  const titleCol = col('título') >= 0 ? col('título') : col('titulo');
  const pathCol = col('caminho');
  const activeCol = col('ativo');

  const items = rows.map(row => ({
    number: String(row[numberCol] || '').trim(),
    order: Number(row[orderCol] || 0),
    title: String(row[titleCol] || '').trim(),
    path: String(row[pathCol] || '').trim(),
    active: /^(sim|s|yes|true|1)$/i.test(String(row[activeCol] || '').trim())
  })).filter(item => item.number && item.path && item.active);

  const config = readConfig_(configSheet);
  const byNumber = Object.fromEntries(items.map(item => [item.number, item]));
  let ordered;
  if (config.sequencia) {
    ordered = config.sequencia.split(',').map(value => byNumber[String(value).trim()]).filter(Boolean);
    const used = new Set(ordered.map(item => item.number));
    ordered = ordered.concat(items.filter(item => !used.has(item.number)).sort((a, b) => a.order - b.order));
  } else {
    ordered = items.sort((a, b) => a.order - b.order);
  }

  return json_({
    playlist: ordered.map(item => ({ number: item.number, title: item.title, path: item.path })),
    sequence: ordered.map(item => item.number),
    refreshSeconds: Number(config.intervalo_atualizacao_segundos || 60),
    crossfadeSeconds: Number(config.crossfade_segundos || 6),
    siteMode: normalize_(config.modo_site || 'normal') === 'construcao' ? 'construcao' : 'normal',
    notices: readNotices_(noticesSheet),
    sponsors: readSponsors_(sponsorsSheet),
    visitsTotal: countVisits_(),
    updatedAt: new Date().toISOString()
  });
}

function readNotices_(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) return [];
  const headers = rows.shift().map(normalize_);
  const orderCol = headers.indexOf('ordem');
  const textCol = headers.indexOf('texto');
  const activeCol = headers.indexOf('ativo');
  return rows.map(row => ({
    order: Number(row[orderCol] || 0),
    text: String(row[textCol] || '').trim(),
    active: /^(sim|s|yes|true|1)$/i.test(String(row[activeCol] || '').trim())
  })).filter(item => item.text && item.active).sort((a, b) => a.order - b.order).map(item => ({ order: item.order, text: item.text }));
}

function readSponsors_(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) return [];
  const headers = rows.shift().map(normalize_);
  const col = name => headers.indexOf(normalize_(name));
  const orderCol = col('ordem');
  const nameCol = col('nome');
  const imageCol = col('imagem_url');
  const descriptionCol = col('descricao');
  const purchaseCol = col('link_compra');
  const activeCol = col('ativo');
  return rows.map(row => ({
    order: Number(row[orderCol] || 0),
    name: String(row[nameCol] || '').trim(),
    imageUrl: String(row[imageCol] || '').trim(),
    description: String(row[descriptionCol] || '').trim(),
    purchaseUrl: String(row[purchaseCol] || '').trim(),
    active: /^(sim|s|yes|true|1)$/i.test(String(row[activeCol] || '').trim())
  })).filter(item => item.name && item.imageUrl && item.purchaseUrl && item.active).sort((a, b) => a.order - b.order).map(item => ({
    order: item.order,
    name: item.name,
    imageUrl: item.imageUrl,
    description: item.description,
    purchaseUrl: item.purchaseUrl
  }));
}

function registerVisit_(params) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(VISITS_SHEET);
  if (!sheet) throw new Error('Aba Visitas não encontrada.');
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    sheet.appendRow([new Date(), params.event || 'page_view', params.page || 'home']);
    SpreadsheetApp.flush();
    return json_({ ok: true, visitsTotal: countVisits_(), updatedAt: new Date().toISOString() });
  } finally {
    lock.releaseLock();
  }
}

function readConfig_(sheet) {
  if (!sheet) return {};
  const result = {};
  sheet.getDataRange().getDisplayValues().forEach(row => {
    if (row[0]) result[normalize_(row[0])] = String(row[1] || '').trim();
  });
  return result;
}

function countVisits_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(VISITS_SHEET);
  return sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
}

function normalize_(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
