const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const overlay = document.documentElement.classList.contains('overlay');
const DEFAULT_DECK = 'https://ai-grad-workshop-1124.onrender.com/';

function queryBg() {
  if (overlay) return '';
  const raw = params.get('bg');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch (err) {
    return '';
  }
}

let pinnedBg = queryBg();
let qrOverride = null;
if (overlay) qrOverride = params.get('qr') === '0' ? 'hidden' : 'corner';
else if (pinnedBg) qrOverride = 'corner';
const layer = $('layer');
const seen = new Set();
const lanes = [];
const stacks = { top: [], bottom: [] };

let socket = null;
let hostToken = '';
let current = null;
let shown = null;
let deckJob = 0;
let inflightDeck = '';
let pdfDoc = null;
let pdfRev = null;
let renderTask = null;
let pdfjsPromise = null;
let panelOpen = false;
let keyLock = 0;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('/vendor/pdfjs/build/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

function remember(id) {
  if (!id || seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  return true;
}

function fontPx(size) {
  if (size === 'l') return Math.max(52, Math.min(window.innerWidth * 0.064, 120));
  if (size === 's') return Math.max(26, Math.min(window.innerWidth * 0.026, 48));
  return Math.max(36, Math.min(window.innerWidth * 0.042, 78));
}

function laneTop(size) {
  const laneH = Math.max(fontPx(size) * 1.25, 42);
  const top = Math.round(window.innerHeight * 0.12);
  const bottom = Math.round(window.innerHeight * 0.8);
  const count = Math.max(1, Math.floor((bottom - top) / laneH));
  while (lanes.length < count) lanes.push(0);
  const now = performance.now();
  let best = 0;
  for (let i = 1; i < count; i += 1) {
    if ((lanes[i] || 0) < (lanes[best] || 0)) best = i;
  }
  lanes[best] = now + 2600;
  return top + best * laneH;
}

function trim(selector, max) {
  const nodes = layer.querySelectorAll(selector);
  if (nodes.length > max) nodes[0].remove();
}

function placeFixed(el, where) {
  const live = (stacks[where] || []).filter((node) => node.isConnected);
  live.push(el);
  while (live.length > 4) live.shift().remove();
  stacks[where] = live;
  live.forEach((node, index) => {
    let offset = where === 'top' ? 78 : 24;
    for (let i = 0; i < index; i += 1) offset += live[i].offsetHeight + 10;
    node.style.top = where === 'top' ? `${offset}px` : '';
    node.style.bottom = where === 'bottom' ? `${offset}px` : '';
  });
}

function reflow(where) {
  const live = (stacks[where] || []).filter((node) => node.isConnected);
  stacks[where] = live;
  if (!live.length) return;
  placeFixed(live.pop(), where);
}

function spawnDanmaku(item) {
  if (!item || !remember(item.id)) return;
  const el = document.createElement('div');
  el.className = `danmaku size-${item.size || 'm'} motion-${item.motion || 'scroll'}`;
  el.textContent = item.text || '';
  if (/^#[0-9A-F]{6}$/.test(item.color || '')) el.style.color = item.color;
  const motion = item.motion;
  if (motion === 'scroll') {
    el.style.top = `${laneTop(item.size)}px`;
    const ms = Math.min(15000, Math.max(8000, 7000 + Array.from(el.textContent).length * 90));
    el.style.animationDuration = `${ms}ms`;
    removeLater(el, ms + 400);
  } else if (motion === 'top' || motion === 'bottom') {
    removeLater(el, 5600, () => reflow(motion));
  } else if (motion === 'float') {
    el.style.left = `${8 + Math.random() * 68}%`;
    el.style.top = '72%';
    el.style.setProperty('--drift', `${Math.round(Math.random() * 80 - 40)}px`);
    removeLater(el, 7400);
  } else {
    el.style.left = `${10 + Math.random() * 65}%`;
    el.style.top = `${18 + Math.random() * 48}%`;
    removeLater(el, 5000);
  }
  layer.appendChild(el);
  trim('.danmaku', 60);
  if (motion === 'top' || motion === 'bottom') placeFixed(el, motion);
}

function spawnEmoji(item) {
  if (!item || !remember(item.id)) return;
  const el = document.createElement('div');
  el.className = 'emoji-float';
  el.textContent = item.emoji || '';
  el.style.left = `${8 + Math.random() * 76}%`;
  el.style.setProperty('--rot', `${Math.round(Math.random() * 24 - 12)}deg`);
  layer.appendChild(el);
  trim('.emoji-float', 30);
  removeLater(el, 3800);
}

function removeLater(el, ms, after) {
  const done = () => {
    el.remove();
    if (after) after();
  };
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, ms);
}

function setQrMode(mode) {
  const effective = qrOverride || mode || 'full';
  const qr = $('qr');
  qr.classList.remove('qr-full', 'qr-corner', 'qr-hidden');
  qr.classList.add(effective === 'corner' ? 'qr-corner' : effective === 'hidden' ? 'qr-hidden' : 'qr-full');
  document.documentElement.classList.toggle('qr-off', overlay && effective === 'hidden');
  document.querySelectorAll('[data-qr]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.qr === effective));
  });
}

function embedShowing() {
  if (overlay) return false;
  const frame = $('embed');
  return Boolean(frame && !frame.hidden && frame.getAttribute('src'));
}

function focusDeck() {
  const frame = $('embed');
  if (!embedShowing()) return;
  try {
    frame.contentWindow.focus();
  } catch (err) {
    frame.focus();
  }
}

function forwardKey(key) {
  const frame = $('embed');
  if (!frame || !frame.contentWindow) return;
  try {
    frame.contentWindow.postMessage({ source: 'workshop-danmaku', type: 'key', key }, '*');
  } catch (err) { /* cross-origin post is still best-effort */ }
  focusDeck();
}

window.__toggleOverlayQr = () => {
  qrOverride = qrOverride === 'hidden' ? 'corner' : 'hidden';
  setQrMode(qrOverride);
  return qrOverride !== 'hidden';
};
window.__setOverlayQr = (on) => {
  qrOverride = on ? 'corner' : 'hidden';
  setQrMode(qrOverride);
};

let danmakuVisible = true;
window.__setDanmakuVisible = (on) => {
  danmakuVisible = Boolean(on);
  $('layer').style.visibility = danmakuVisible ? 'visible' : 'hidden';
  return danmakuVisible;
};
window.__toggleDanmaku = () => window.__setDanmakuVisible(!danmakuVisible);

function updateHostChrome(next) {
  const pause = $('btn-pause');
  if (pause) pause.textContent = next.paused ? '繼續' : '暫停';
  setQrMode(next.qrMode);
}

function applyState(next) {
  if (!next) return;
  current = next;
  document.body.classList.toggle('is-paused', Boolean(next.paused));
  $('paused-pill').hidden = !next.paused;
  $('viewer-count').textContent = `在線 ${next.viewers || 0}`;
  updateHostChrome(next);
  let deck = next.deck || { type: 'slides', page: 1, pageCount: 3 };
  if (pinnedBg) deck = { type: 'url', url: pinnedBg, page: 1, pageCount: 1, rev: deck.rev || 0 };
  const paging = deck.type !== 'url';
  $('page-label').hidden = !paging;
  $('page-label').textContent = paging ? `${deck.page || 1} / ${deck.pageCount || 1}` : '';
  updateDeck(deck);
}

async function updateDeck(deck) {
  const signature = `${deck.type}|${deck.rev || 0}|${deck.page || 1}|${deck.url || ''}`;
  if (shown === signature || inflightDeck === signature) return;
  inflightDeck = signature;
  const job = ++deckJob;
  $('slides').hidden = deck.type !== 'slides';
  $('pdf-canvas').hidden = deck.type !== 'pdf';
  $('embed').hidden = deck.type !== 'url';
  if (deck.type !== 'url') {
    const frame = $('embed');
    if (frame.src && frame.src !== 'about:blank') frame.src = 'about:blank';
  }
  if (deck.type === 'slides') {
    document.querySelectorAll('.slide').forEach((el) => {
      el.hidden = Number(el.dataset.page) !== Number(deck.page);
    });
    $('pdf-status').hidden = true;
    shown = signature;
    inflightDeck = '';
    return;
  }
  if (deck.type === 'url') {
    $('pdf-status').hidden = true;
    const frame = $('embed');
    if (deck.url && frame.src !== deck.url) frame.src = deck.url;
    shown = signature;
    inflightDeck = '';
    focusDeck();
    return;
  }
  if (overlay) {
    shown = signature;
    inflightDeck = '';
    return;
  }
  const status = $('pdf-status');
  status.hidden = false;
  status.textContent = '正在載入 PDF…';
  try {
    await ensurePdf(deck);
    if (job !== deckJob) return;
    await renderPdf(deck.page || 1);
    if (job !== deckJob) return;
    status.hidden = true;
    shown = signature;
  } catch (err) {
    if (job !== deckJob) return;
    console.error(err);
    status.hidden = false;
    status.textContent = 'PDF 無法顯示';
  } finally {
    if (inflightDeck === signature) inflightDeck = '';
  }
}

async function ensurePdf(deck) {
  if (pdfDoc && pdfRev === deck.rev) return pdfDoc;
  const lib = await loadPdfJs();
  if (renderTask) {
    try { renderTask.cancel(); } catch (err) { /* already finished */ }
    renderTask = null;
  }
  if (pdfDoc) {
    try { await pdfDoc.destroy(); } catch (err) { /* ignore */ }
    pdfDoc = null;
  }
  const task = lib.getDocument({
    url: `/api/pdf?rev=${encodeURIComponent(deck.rev)}`,
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
  });
  pdfDoc = task.promise ? await task.promise : await task;
  pdfRev = deck.rev;
  if (hostToken && pdfDoc.numPages) {
    socket.emit('host-pages', { token: hostToken, pageCount: pdfDoc.numPages });
  }
  return pdfDoc;
}

async function renderPdf(pageNumber) {
  if (!pdfDoc) return;
  const pageNo = Math.min(pdfDoc.numPages, Math.max(1, pageNumber));
  if (renderTask) {
    try { renderTask.cancel(); } catch (err) { /* ignore */ }
    renderTask = null;
  }
  const page = await pdfDoc.getPage(pageNo);
  const canvas = $('pdf-canvas');
  const stage = $('stage');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = stage.clientWidth;
  const ch = stage.clientHeight;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(cw / base.width, ch / base.height) * dpr;
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.left = `${(cw - cssW) / 2}px`;
  canvas.style.top = `${(ch - cssH) / 2}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  renderTask = page.render({ canvasContext: ctx, viewport });
  try {
    await renderTask.promise;
  } catch (err) {
    if (err && (err.name === 'RenderingCancelledException' || /cancel/i.test(err.message || ''))) return;
    throw err;
  }
}

function togglePanel(force) {
  panelOpen = typeof force === 'boolean' ? force : !panelOpen;
  $('host').hidden = !panelOpen;
  $('host-toggle').textContent = panelOpen ? '收合' : '主持控制';
  $('host-toggle').setAttribute('aria-expanded', String(panelOpen));
}

function hostMsg(text) {
  $('host-msg').textContent = text || '';
}

function showLock(message) {
  $('lock').hidden = false;
  $('controls').hidden = true;
  $('lock-error').textContent = message || '';
}

function showControls(words) {
  $('lock').hidden = true;
  $('controls').hidden = false;
  $('lock-error').textContent = '';
  if (Array.isArray(words)) $('filter-box').value = words.join('\n');
}

async function unlockWithPassword(password) {
  const res = await fetch('/api/host/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showLock(data.error || '密碼不正確');
    return;
  }
  $('password').value = '';
  try { sessionStorage.setItem('danmaku-host-token', data.token); } catch (err) { /* ignore */ }
  await adoptToken(data.token, data.filter);
}

function adoptToken(token, words) {
  hostToken = token;
  return new Promise((resolve) => {
    socket.emit('host-join', { token }, (res) => {
      if (!res || !res.ok) {
        hostToken = '';
        try { sessionStorage.removeItem('danmaku-host-token'); } catch (err) { /* ignore */ }
        showLock('請重新輸入密碼');
        resolve(false);
        return;
      }
      showControls(words || res.filter || []);
      resolve(true);
    });
  });
}

function hostEmit(event, payload, okText) {
  if (!hostToken) {
    hostMsg('請先解鎖');
    return;
  }
  socket.emit(event, { token: hostToken, ...payload }, (res) => {
    if (!res || !res.ok) {
      hostMsg(res && res.reason === 'bad-url' ? '這個網址不能嵌入' : '沒有套用');
      return;
    }
    if (event === 'host-deck') pinnedBg = '';
    if (res.state) applyState(res.state);
    if (Array.isArray(res.words)) $('filter-box').value = res.words.join('\n');
    if (okText) hostMsg(okText);
  });
}

async function loadJoinInfo() {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch('/api/join-info', { cache: 'no-store' });
      if (!res.ok) throw new Error('join-info');
      const data = await res.json();
      $('qr-img').src = data.qrDataUrl;
      $('qr-img').alt = `加入房間 ${data.room} 的 QR code`;
      $('qr-room').textContent = data.room;
      $('qr-url').textContent = data.joinUrl;
      return data.room;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  $('qr-room').textContent = '----';
  $('qr-url').textContent = 'QR code 暫時無法顯示';
  throw lastError;
}

function connect(room) {
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10000,
  });
  socket.on('connect', () => {
    socket.emit('hello', { role: 'screen', room, clientId: screenClientId() }, (res) => {
      if (!res || !res.ok) return;
      applyState(res.state);
      let saved = '';
      try { saved = sessionStorage.getItem('danmaku-host-token') || ''; } catch (err) { saved = ''; }
      if (saved) adoptToken(saved);
    });
  });
  socket.on('state', applyState);
  socket.on('viewers', (msg) => {
    if (msg && typeof msg.count === 'number') $('viewer-count').textContent = `在線 ${msg.count}`;
  });
  socket.on('danmaku', spawnDanmaku);
  socket.on('emoji', spawnEmoji);
  socket.on('backlog', (items) => {
    (items || []).forEach((item, index) => setTimeout(() => spawnDanmaku(item), index * 140));
  });
  socket.on('cleared', () => {
    layer.replaceChildren();
    stacks.top = [];
    stacks.bottom = [];
  });
  socket.on('filter', (msg) => {
    if (!msg || !Array.isArray(msg.words)) return;
    if (document.activeElement === $('filter-box')) return;
    $('filter-box').value = msg.words.join('\n');
  });
  setInterval(() => {
    if (socket.connected) socket.emit('heartbeat');
  }, 45000);
}

function screenClientId() {
  const key = 'danmaku-screen-id';
  try {
    const current = localStorage.getItem(key) || '';
    if (/^[A-Za-z0-9_-]{8,64}$/.test(current)) return current;
    const next = `screen${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 32);
    localStorage.setItem(key, next);
    return next;
  } catch (err) {
    return `screen${Math.random().toString(16).slice(2)}00000000`.slice(0, 32);
  }
}

function bindHost() {
  $('host-toggle').addEventListener('click', () => togglePanel());
  $('lock').addEventListener('submit', (event) => {
    event.preventDefault();
    unlockWithPassword($('password').value);
  });
  $('btn-pause').addEventListener('click', () => {
    hostEmit('host-pause', { paused: !(current && current.paused) }, current && current.paused ? '已繼續' : '已暫停');
  });
  $('btn-clear').addEventListener('click', () => hostEmit('host-clear', {}, '已清除'));
  document.querySelectorAll('[data-qr]').forEach((button) => {
    button.addEventListener('click', () => {
      qrOverride = button.dataset.qr;
      setQrMode(qrOverride);
      hostEmit('host-qr', { mode: button.dataset.qr }, 'QR 已更新');
    });
  });
  $('btn-slides').addEventListener('click', () => hostEmit('host-deck', { type: 'slides' }, '已改為內建投影片'));
  $('btn-sample-pdf').addEventListener('click', () => hostEmit('host-deck', { type: 'pdf', pdf: 'sample' }, '已改為範例 PDF'));
  $('pdf-file').addEventListener('change', async () => {
    const file = $('pdf-file').files && $('pdf-file').files[0];
    $('pdf-file').value = '';
    if (!file || !hostToken) return;
    hostMsg('上傳中…');
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/api/pdf', {
        method: 'POST',
        headers: { Authorization: `Bearer ${hostToken}` },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        hostMsg(data.error || '上傳失敗');
        return;
      }
      if (data.state) {
        pinnedBg = '';
        applyState(data.state);
      }
      hostMsg('PDF 已放上背景');
    } catch (err) {
      hostMsg('上傳失敗');
    }
  });
  $('url-form').addEventListener('submit', (event) => {
    event.preventDefault();
    hostEmit('host-deck', { type: 'url', url: $('embed-url').value }, '已改為網頁背景');
  });
  $('btn-prev').addEventListener('click', () => hostEmit('host-page', { delta: -1 }));
  $('btn-next').addEventListener('click', () => hostEmit('host-page', { delta: 1 }));
  $('btn-filter').addEventListener('click', () => {
    const words = $('filter-box').value.split(/\r?\n/);
    hostEmit('host-filter', { words }, '敏感詞已更新');
  });
  $('btn-filter-reset').addEventListener('click', () => hostEmit('host-filter', { reset: true }, '已恢復預設'));
}

const DECK_KEYS = new Set([
  'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp',
  'PageDown', 'PageUp', ' ', 'Enter', 'Backspace', 'Home', 'End', 'f', 'F',
]);

window.addEventListener('keydown', (event) => {
  if (overlay) return;
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((event.key === 'h' || event.key === 'H') && tag !== 'BUTTON') {
    togglePanel();
    if (!panelOpen) focusDeck();
    return;
  }
  if (embedShowing() && DECK_KEYS.has(event.key)) {
    forwardKey(event.key);
    return;
  }
  if (tag === 'BUTTON') return;
  if (!hostToken) return;
  const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key);
  const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key);
  if (!next && !prev) return;
  event.preventDefault();
  const now = Date.now();
  if (now - keyLock < 220) return;
  keyLock = now;
  hostEmit('host-page', { delta: next ? 1 : -1 });
});

window.addEventListener('resize', () => {
  if (!current || !current.deck || current.deck.type !== 'pdf' || overlay) return;
  shown = null;
  updateDeck(current.deck);
});

$('embed').addEventListener('load', () => focusDeck());
bindHost();
loadJoinInfo().then(connect).catch((err) => {
  console.error(err);
  $('pdf-status').hidden = false;
  $('pdf-status').textContent = '連不上伺服器';
});
