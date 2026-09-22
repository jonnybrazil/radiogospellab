(() => {
  "use strict";

  const PROGRAMMING_ENDPOINT = "https://script.google.com/macros/s/AKfycbz2pwgLGM4BBDvOMF033qNCi3AAmwXJwCZGFKWh46e7yFTB4X2L67Zky3eIR1KKpjKZfg/exec";
  const LOCAL_PLAYLIST_SOURCE = "playlist.csv";
  const CONTENT = {
    message: "mensagem.txt",
    notices: "avisos.txt",
    sponsors: "patrocinadores.html"
  };
  const DEFAULT_REFRESH_MS = 60_000;
  const DEFAULT_CROSSFADE_SECONDS = 6;
  const DEFAULT_VOLUME = 0.85;

  const $ = (id) => document.getElementById(id);
  const audio = [$('audio-a'), $('audio-b')];
  let active = 0;
  let playlist = [];
  let currentIndex = 0;
  let currentTrack = null;
  let nextTrack = null;
  let playing = false;
  let transitioning = false;
  let refreshTimer;
  let refreshMs = DEFAULT_REFRESH_MS;
  let crossfadeSeconds = DEFAULT_CROSSFADE_SECONDS;
  let audioContext = null;
  let gain = [];
  let masterGain = null;
  let volume = DEFAULT_VOLUME;
  let muted = false;
  let noticesLoaded = false;
  let noticeTimer = null;
  let noticeIndex = 0;

  const setText = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  const cacheBust = (url) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
  const absoluteAudioUrl = (path) => { try { return new URL(path, document.baseURI).href; } catch (_) { return path; } };

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"' && quoted && next === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { row.push(field.trim()); field = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i += 1;
        row.push(field.trim()); field = '';
        if (row.some(Boolean)) rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); }
    return rows;
  }

  function parseLocalPlaylist(text) {
    const rows = parseCSV(text).filter(row => row[0] && !row[0].startsWith('#'));
    if (!rows.length) return [];
    const header = rows[0].map(v => v.toLowerCase());
    const hasHeader = header.includes('title') || header.includes('titulo') || header.includes('url') || header.includes('arquivo');
    const data = hasHeader ? rows.slice(1) : rows;
    const titleAt = hasHeader ? Math.max(header.indexOf('title'), header.indexOf('titulo')) : 0;
    const urlAt = hasHeader ? Math.max(header.indexOf('url'), header.indexOf('arquivo'), header.indexOf('file')) : 1;
    return data.map(row => {
      const rawUrl = row[urlAt] || '';
      return { title: row[titleAt] || rawUrl.split('/').pop() || 'Sem título', url: absoluteAudioUrl(rawUrl) };
    }).filter(track => track.url);
  }

  async function loadPlaylistFromEndpoint() {
    const response = await fetch(cacheBust(PROGRAMMING_ENDPOINT), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Programação indisponível (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload.playlist) || !payload.playlist.length) throw new Error('Programação vazia');
    refreshMs = Math.max(15_000, Number(payload.refreshSeconds || 60) * 1000);
    crossfadeSeconds = Math.max(1, Number(payload.crossfadeSeconds || DEFAULT_CROSSFADE_SECONDS));
    applyRemoteNotices(payload.notices);
    return payload.playlist.map(track => ({ title: track.title || track.path, url: absoluteAudioUrl(track.path), number: track.number }));
  }

  async function loadPlaylistFromFile() {
    const response = await fetch(cacheBust(LOCAL_PLAYLIST_SOURCE), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Playlist indisponível (${response.status})`);
    return parseLocalPlaylist(await response.text());
  }

  async function loadPlaylist() {
    let fresh;
    let remote = true;
    try { fresh = await loadPlaylistFromEndpoint(); }
    catch (_) { remote = false; fresh = await loadPlaylistFromFile(); }
    if (!fresh.length) throw new Error('Playlist vazia');
    const oldUrl = currentTrack?.url;
    playlist = fresh;
    const stillCurrent = oldUrl ? playlist.findIndex(t => t.url === oldUrl) : -1;
    if (stillCurrent >= 0) currentIndex = (stillCurrent + 1) % playlist.length;
    else if (currentIndex >= playlist.length) currentIndex = 0;
    updateNextLabel();
    setText('queue-status', remote ? 'Google Sheets' : `Fila local · ${playlist.length} faixas`);
    schedulePlaylistRefresh();
  }

  function schedulePlaylistRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
      try { await loadPlaylist(); } catch (_) { schedulePlaylistRefresh(); }
    }, refreshMs);
  }

  async function registerVisit() {
    try {
      const url = `${PROGRAMMING_ENDPOINT}?action=visit&page=home`;
      const response = await fetch(cacheBust(url), { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível registrar a visita');
      const payload = await response.json();
      if (Number.isFinite(Number(payload.visitsTotal))) setText('view-counter', Number(payload.visitsTotal).toLocaleString('pt-BR'));
    } catch (_) { setText('view-counter', '—'); }
  }

  async function loadContent(id, url, html = false) {
    try {
      const response = await fetch(cacheBust(url), { cache: 'no-store' });
      if (!response.ok) throw new Error('Conteúdo indisponível');
      const text = await response.text();
      const node = $(id);
      if (html) node.innerHTML = text;
      else node.innerHTML = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => `<p>${escapeHtml(line.trim())}</p>`).join('') || '<p>Conteúdo em atualização.</p>';
    } catch (_) { setText(id, 'Conteúdo em atualização.'); }
  }

  function applyRemoteNotices(items) {
    if (!Array.isArray(items) || !items.length) return false;
    const valid = items.map(item => String(item?.text || '').trim()).filter(Boolean);
    if (!valid.length) return false;
    noticesLoaded = true;
    if (noticeTimer) clearInterval(noticeTimer);
    noticeIndex = 0;
    const node = $('notices-content');
    const show = (text, fading = false) => {
      if (fading) node.classList.add('is-fading');
      window.setTimeout(() => { node.textContent = text; node.classList.remove('is-fading'); }, fading ? 500 : 0);
    };
    show(valid[noticeIndex]);
    if (valid.length > 1) {
      noticeTimer = window.setInterval(() => {
        noticeIndex = (noticeIndex + 1) % valid.length;
        show(valid[noticeIndex], true);
      }, 10_000);
    }
    return true;
  }

  function escapeHtml(value) { return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch])); }
  function formatTime(value) { if (!Number.isFinite(value)) return '00:00'; const s = Math.max(0, Math.floor(value)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  function updateNextLabel() { setText('next-title', playlist.length ? (playlist[currentIndex]?.title || '—') : '—'); }

  function ensureAudioGraph() {
    if (audioContext) { if (audioContext.state === 'suspended') audioContext.resume(); return; }
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain(); masterGain.gain.value = volume;
    gain = audio.map(element => { const source = audioContext.createMediaElementSource(element); const node = audioContext.createGain(); node.gain.value = 0; source.connect(node).connect(masterGain); return node; });
    masterGain.connect(audioContext.destination);
  }

  function effectiveVolume() { return muted ? 0 : volume; }
  function setMasterVolume() { if (masterGain) masterGain.gain.setTargetAtTime(effectiveVolume(), audioContext.currentTime, .03); }
  function setGain(index, value, duration = .15) { if (gain[index]) gain[index].gain.setTargetAtTime(value, audioContext.currentTime, duration); }

  function updateMetadata(track) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: 'Rádio Gospel Lab', album: 'Programação ao vivo' });
    navigator.mediaSession.setActionHandler('play', () => { if (!playing) toggleRadio(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (playing) toggleRadio(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { if (playing) startNextTrack(true); });
  }

  function prepareNext() { nextTrack = playlist[currentIndex] || null; updateNextLabel(); }

  async function startTrack(track, index, immediate = false) {
    if (!track) return;
    ensureAudioGraph();
    const nextPlayer = active === 0 ? 1 : 0;
    const element = audio[nextPlayer];
    element.src = track.url; element.load();
    try { await element.play(); } catch (_) { showPlayerMessage('Toque em Iniciar rádio para liberar o áudio.'); return; }
    setGain(nextPlayer, 0, 0);
    setGain(nextPlayer, effectiveVolume() > 0 ? 1 : 0, immediate ? .01 : crossfadeSeconds);
    if (!immediate) setGain(active, 0, crossfadeSeconds);
    const oldPlayer = active; active = nextPlayer; currentTrack = track; currentIndex = (index + 1) % playlist.length;
    prepareNext(); updateMetadata(track); setText('current-title', track.title); setText('radio-status', 'Pausar rádio'); $('radio-toggle').setAttribute('aria-pressed', 'true'); $('radio-icon').textContent = 'Ⅱ'; $('live-dot').classList.add('is-live'); setText('live-label', 'Ao vivo');
    if (!immediate) window.setTimeout(() => { audio[oldPlayer].pause(); audio[oldPlayer].removeAttribute('src'); }, crossfadeSeconds * 1000 + 250);
  }

  async function startNextTrack(force = false) {
    if (!playing || transitioning || !playlist.length) return;
    transitioning = true;
    const track = nextTrack || playlist[currentIndex];
    const index = currentIndex;
    nextTrack = null;
    await startTrack(track, index, force || !currentTrack);
    transitioning = false;
  }

  function onTimeUpdate() {
    const element = audio[active], duration = element.duration;
    if (!Number.isFinite(duration)) return;
    const remaining = duration - element.currentTime;
    $('progress-fill').style.width = `${Math.min(100, (element.currentTime / duration) * 100)}%`;
    setText('elapsed-time', formatTime(element.currentTime)); setText('remaining-time', `-${formatTime(remaining)}`);
    if (remaining <= crossfadeSeconds + .15 && !transitioning) startNextTrack();
  }

  function stopRadio() { playing = false; audio.forEach((element, index) => { element.pause(); if (gain[index]) setGain(index, 0, .1); }); setText('radio-status', 'Continuar rádio'); $('radio-icon').textContent = '▶'; $('live-dot').classList.remove('is-live'); setText('live-label', 'Pausado'); $('radio-toggle').setAttribute('aria-pressed', 'false'); }

  async function toggleRadio() {
    if (playing) { stopRadio(); return; }
    try { await loadPlaylist(); } catch (_) { showPlayerMessage('Não foi possível carregar a playlist.'); return; }
    ensureAudioGraph(); if (audioContext.state === 'suspended') await audioContext.resume(); playing = true;
    if (currentTrack && audio[active].src) { await audio[active].play(); setGain(active, effectiveVolume(), .1); setText('radio-status', 'Pausar rádio'); $('radio-icon').textContent = 'Ⅱ'; $('live-dot').classList.add('is-live'); setText('live-label', 'Ao vivo'); }
    else await startNextTrack(true);
  }

  function showPlayerMessage(message) { setText('player-message', message); window.setTimeout(() => { if ($('player-message').textContent === message) setText('player-message', ''); }, 6000); }
  function setupControls() {
    $('radio-toggle').addEventListener('click', toggleRadio);
    $('volume-control').addEventListener('input', event => { volume = Number(event.target.value); muted = false; $('mute-toggle').setAttribute('aria-pressed', 'false'); setMasterVolume(); if (gain[active]) setGain(active, volume, .05); });
    $('mute-toggle').addEventListener('click', () => { muted = !muted; $('mute-toggle').textContent = muted ? 'Ativar som' : 'Silenciar'; $('mute-toggle').setAttribute('aria-pressed', String(muted)); setMasterVolume(); });
    $('message-toggle').addEventListener('click', () => toggleExpandable('message-content', 'message-toggle'));
    $('sponsors-toggle').addEventListener('click', () => toggleExpandable('sponsors-content', 'sponsors-toggle'));
    audio.forEach(element => { element.addEventListener('timeupdate', onTimeUpdate); element.addEventListener('ended', () => { if (element === audio[active] && playing) startNextTrack(); }); element.addEventListener('error', () => { if (element === audio[active]) showPlayerMessage('Não foi possível carregar esta faixa. Pulando para a próxima.'); }); });
  }

  function toggleExpandable(contentId, buttonId) { const content = $(contentId), button = $(buttonId); const open = content.classList.toggle('is-open'); button.textContent = open ? 'Ver menos' : 'Ver mais'; }
  function setupServiceWorker() { if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }

  async function init() {
    setupControls(); setupServiceWorker(); setText('current-year', new Date().getFullYear());
    await Promise.all([registerVisit(), loadContent('message-content', CONTENT.message), loadContent('sponsors-content', CONTENT.sponsors, true)]);
    try { await loadPlaylist(); } catch (_) { setText('queue-status', 'Playlist em configuração'); schedulePlaylistRefresh(); }
    if (!noticesLoaded) await loadContent('notices-content', CONTENT.notices);
    window.addEventListener('pagehide', () => { if (refreshTimer) clearTimeout(refreshTimer); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
