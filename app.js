(() => {
  "use strict";

  // Para usar uma planilha publicada como CSV, cole aqui a URL de publicação.
  // Se ficar vazio, o app usa playlist.csv do próprio repositório.
  const PLAYLIST_SOURCE_URL = "";
  const CONTENT = {
    message: "mensagem.txt",
    notices: "avisos.txt",
    sponsors: "patrocinadores.html"
  };
  const REFRESH_MS = 60_000;
  const CROSSFADE_SECONDS = 6;
  const DEFAULT_VOLUME = 0.85;

  const $ = (id) => document.getElementById(id);
  const audio = [$('audio-a'), $('audio-b')];
  let active = 0;
  let playlist = [];
  let currentIndex = 0;
  let currentTrack = null;
  let nextTrack = null;
  let playing = false;
  let userPaused = false;
  let transitioning = false;
  let refreshTimer;
  let audioContext = null;
  let gain = [];
  let masterGain = null;
  let volume = DEFAULT_VOLUME;
  let muted = false;

  const setText = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  const cacheBust = (url) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

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

  function parsePlaylist(text) {
    const rows = parseCSV(text).filter(row => row[0] && !row[0].startsWith('#'));
    if (!rows.length) return [];
    const header = rows[0].map(v => v.toLowerCase());
    const hasHeader = header.includes('title') || header.includes('titulo') || header.includes('url') || header.includes('arquivo');
    const data = hasHeader ? rows.slice(1) : rows;
    const titleAt = hasHeader ? Math.max(header.indexOf('title'), header.indexOf('titulo')) : 0;
    const urlAt = hasHeader ? Math.max(header.indexOf('url'), header.indexOf('arquivo'), header.indexOf('file')) : 1;
    return data.map(row => {
      const rawUrl = row[urlAt] || '';
      const url = rawUrl.startsWith('http') ? rawUrl : rawUrl.replace(/^\.\//, '');
      return { title: row[titleAt] || url.split('/').pop() || 'Sem título', url };
    }).filter(track => track.url);
  }

  async function loadPlaylist() {
    const source = PLAYLIST_SOURCE_URL || 'playlist.csv';
    const response = await fetch(cacheBust(source), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Playlist indisponível (${response.status})`);
    const fresh = parsePlaylist(await response.text());
    if (!fresh.length) throw new Error('Playlist vazia');
    const oldUrl = currentTrack?.url;
    playlist = fresh;
    const stillCurrent = oldUrl ? playlist.findIndex(t => t.url === oldUrl) : -1;
    if (stillCurrent >= 0) currentIndex = (stillCurrent + 1) % playlist.length;
    else if (currentIndex >= playlist.length) currentIndex = 0;
    updateNextLabel();
    setText('queue-status', PLAYLIST_SOURCE_URL ? 'Google Sheets' : `Fila local · ${playlist.length} faixas`);
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

  function escapeHtml(value) { return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch])); }
  function formatTime(value) { if (!Number.isFinite(value)) return '00:00'; const s = Math.max(0, Math.floor(value)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  function updateNextLabel() { setText('next-title', playlist.length ? (playlist[currentIndex]?.title || '—') : '—'); }

  function ensureAudioGraph() {
    if (audioContext) { if (audioContext.state === 'suspended') audioContext.resume(); return; }
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = volume;
    gain = audio.map(element => {
      const source = audioContext.createMediaElementSource(element);
      const node = audioContext.createGain(); node.gain.value = 0;
      source.connect(node).connect(masterGain);
      return node;
    });
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

  function prepareNext() {
    nextTrack = playlist[currentIndex] || null;
    updateNextLabel();
  }

  async function startTrack(track, index, immediate = false) {
    if (!track) return;
    ensureAudioGraph();
    const nextPlayer = active === 0 ? 1 : 0;
    const element = audio[nextPlayer];
    element.src = track.url;
    element.load();
    try { await element.play(); } catch (error) { showPlayerMessage('Toque em Iniciar rádio para liberar o áudio.'); return; }
    const now = audioContext.currentTime;
    setGain(nextPlayer, 0, 0);
    setGain(nextPlayer, effectiveVolume() > 0 ? 1 : 0, immediate ? .01 : CROSSFADE_SECONDS);
    if (!immediate) setGain(active, 0, CROSSFADE_SECONDS);
    const oldPlayer = active;
    active = nextPlayer;
    currentTrack = track;
    currentIndex = (index + 1) % playlist.length;
    prepareNext();
    updateMetadata(track);
    setText('current-title', track.title);
    setText('radio-status', 'Pausar rádio');
    $('radio-toggle').setAttribute('aria-pressed', 'true');
    $('radio-icon').textContent = 'Ⅱ';
    $('live-dot').classList.add('is-live');
    setText('live-label', 'Ao vivo');
    if (!immediate) window.setTimeout(() => { audio[oldPlayer].pause(); audio[oldPlayer].removeAttribute('src'); }, CROSSFADE_SECONDS * 1000 + 250);
  }

  async function startNextTrack(force = false) {
    if (!playing || transitioning || !playlist.length) return;
    transitioning = true;
    const track = nextTrack || playlist[currentIndex];
    const index = nextTrack ? currentIndex : currentIndex;
    nextTrack = null;
    await startTrack(track, index, force || !currentTrack);
    transitioning = false;
  }

  function onTimeUpdate() {
    const element = audio[active];
    const duration = element.duration;
    if (!Number.isFinite(duration)) return;
    const remaining = duration - element.currentTime;
    $('progress-fill').style.width = `${Math.min(100, (element.currentTime / duration) * 100)}%`;
    setText('elapsed-time', formatTime(element.currentTime));
    setText('remaining-time', `-${formatTime(remaining)}`);
    if (remaining <= CROSSFADE_SECONDS + .15 && !transitioning) startNextTrack();
  }

  function stopRadio() {
    playing = false; userPaused = true;
    audio.forEach((element, index) => { element.pause(); if (gain[index]) setGain(index, 0, .1); });
    setText('radio-status', 'Continuar rádio'); $('radio-icon').textContent = '▶'; $('live-dot').classList.remove('is-live'); setText('live-label', 'Pausado');
    $('radio-toggle').setAttribute('aria-pressed', 'false');
  }

  async function toggleRadio() {
    if (playing) { stopRadio(); return; }
    try { await loadPlaylist(); } catch (error) { showPlayerMessage('Não foi possível carregar a playlist.'); return; }
    ensureAudioGraph();
    if (audioContext.state === 'suspended') await audioContext.resume();
    playing = true; userPaused = false;
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
  function setupViews() { const key = 'rgl-visits'; const count = Number(localStorage.getItem(key) || 126) + 1; localStorage.setItem(key, count); setText('view-counter', count); setText('current-year', new Date().getFullYear()); }

  async function init() {
    setupControls(); setupServiceWorker(); setupViews();
    await Promise.all([loadContent('message-content', CONTENT.message), loadContent('notices-content', CONTENT.notices), loadContent('sponsors-content', CONTENT.sponsors, true)]);
    try { await loadPlaylist(); } catch (_) { setText('queue-status', 'Playlist em configuração'); }
    refreshTimer = window.setInterval(async () => { try { await loadPlaylist(); } catch (_) {} }, REFRESH_MS);
    window.addEventListener('pagehide', () => { if (refreshTimer) clearInterval(refreshTimer); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
