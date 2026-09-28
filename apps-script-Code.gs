const SPREADSHEET_ID = '1iOH7Erj9IcNcgko1Ur57Ffs5kiAm3eX4HVLs6R151EM';
const PLAYLIST_SHEET = 'Playlist';
const CONFIG_SHEET = 'Config';
const VISITS_SHEET = 'Visitas';
const NOTICES_SHEET = 'Avisos';
const SPONSORS_SHEET = 'Patrocinio';
const MESSAGE_DOCUMENT_ID = '1g_BH04OePllwQZkmlxRzcMAtzBYsKSRiZ-J68i3CWuI';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'playlist';
  if (action === 'visit') return registerVisit_(e.parameter || {});
  if (action === 'event') return registerAnalyticsEvent_(e.parameter || {});
  if (action === 'summary') return writeDailySummary_(e.parameter || {});
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

  const maintenanceValue = String(config.em_manutencao || '').trim();
  const maintenanceEnabled = maintenanceValue
    ? /^(sim|s|yes|true|1)$/i.test(maintenanceValue)
    : normalize_(config.modo_site || 'normal') === 'construcao';

  return json_({
    playlist: ordered.map(item => ({ number: item.number, title: item.title, path: item.path })),
    sequence: ordered.map(item => item.number),
    refreshSeconds: Number(config.intervalo_atualizacao_segundos || 60),
    crossfadeSeconds: Number(config.crossfade_segundos || 6),
    siteMode: maintenanceEnabled ? 'construcao' : 'normal',
    messageOfTheDay: readMessageOfTheDay_(),
    notices: readNotices_(noticesSheet),
    sponsors: readSponsors_(sponsorsSheet),
    visitsTotal: countVisits_(),
    updatedAt: new Date().toISOString()
  });
}

function readMessageOfTheDay_() {
  try {
    return DocumentApp.openById(MESSAGE_DOCUMENT_ID).getBody().getText().trim();
  } catch (error) {
    return '';
  }
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

function registerAnalyticsEvent_(params) {
  const event = String(params.event || '').trim().toLowerCase();
  const sessionId = String(params.session || '').trim().slice(0, 120);
  const allowedEvents = ['radio_start', 'radio_pause', 'radio_resume', 'heartbeat'];
  if (!allowedEvents.includes(event) || !sessionId) return json_({ ok: false, error: 'Evento inválido.' });

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureEventsSheet_(spreadsheet);
  sheet.appendRow([new Date(), sessionId, event]);
  return json_({ ok: true });
}

function ensureEventsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName('Eventos');
  if (!sheet) sheet = spreadsheet.insertSheet('Eventos');
  if (sheet.getLastRow() === 0) sheet.appendRow(['data_hora', 'sessao', 'evento']);
  return sheet;
}

function writeDailySummary_(params) {
  params = params || {};
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const eventsSheet = spreadsheet.getSheetByName('Eventos');
  const visitsSheet = spreadsheet.getSheetByName(VISITS_SHEET);
  const summarySheet = spreadsheet.getSheetByName('ResumoDiario');
  if (!summarySheet) throw new Error('Aba ResumoDiario não encontrada.');

  const timeZone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  const targetDate = String(params.data || Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd')).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('Data inválida. Use AAAA-MM-DD.');
  const dayStart = new Date(`${targetDate}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) throw new Error('Data inválida.');
  const nextDate = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const eventRows = eventsSheet ? eventsSheet.getDataRange().getValues().slice(1) : [];
  const visitRows = visitsSheet ? visitsSheet.getDataRange().getValues().slice(1) : [];
  const inDay = value => value instanceof Date && value >= dayStart && value < nextDate;
  const events = eventRows.filter(row => inDay(row[0]));
  const visits = visitRows.filter(row => inDay(row[0]));
  const starts = events.filter(row => row[2] === 'radio_start');
  const heartbeats = events.filter(row => row[2] === 'heartbeat');
  const sessions = new Set(starts.map(row => String(row[1])));
  const activeByMinute = {};
  const activeSessions = new Set();
  heartbeats.forEach(row => {
    activeSessions.add(String(row[1]));
    const minute = Utilities.formatDate(row[0], timeZone, 'yyyy-MM-dd HH:mm');
    if (!activeByMinute[minute]) activeByMinute[minute] = new Set();
    activeByMinute[minute].add(String(row[1]));
  });
  const peakListeners = Object.values(activeByMinute).reduce((max, set) => Math.max(max, set.size), 0);
  const listeningMinutes = Math.round(heartbeats.length / 1);
  const values = [targetDate, visits.length, starts.length, activeSessions.size, peakListeners, listeningMinutes, sessions.size];
  const headers = summarySheet.getRange(1, 1, 1, 7).getDisplayValues()[0].map(normalize_);
  const dateCol = headers.indexOf('data');
  if (dateCol < 0) throw new Error('A coluna data não foi encontrada em ResumoDiario.');
  const existing = summarySheet.getDataRange().getDisplayValues();
  const existingRow = existing.findIndex((row, index) => index > 0 && String(row[dateCol]).trim() === targetDate);
  if (existingRow >= 1) summarySheet.getRange(existingRow + 1, 1, 1, 7).setValues([values]);
  else summarySheet.appendRow(values);
  return json_({ ok: true, date: targetDate, values: values });
}

function installDailySummaryTrigger_() {
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'writeDailySummary_').forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('writeDailySummary_').timeBased().everyDays(1).atHour(23).nearMinute(59).create();
}

function gerarResumoAgora() {
  return writeDailySummary_({});
}

function instalarMedicaoDiaria() {
  installDailySummaryTrigger_();
}

function autorizarAcessos() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  DocumentApp.openById(MESSAGE_DOCUMENT_ID).getName();
  return 'Acessos autorizados.';
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
