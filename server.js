'use strict';

// One in-memory room for a single workshop night.
// Restarting the process drops messages, the uploaded PDF, pause, and filter edits.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const { DEFAULT_WORDS, isBlocked, sanitizeWordList } = require('./lib/filter');
const { toEmbedUrl } = require('./lib/embed');
const OPTIONS = require('./lib/options');
const { buildSamplePdf } = require('./lib/samplePdf');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 4721;
const HOST_PASSWORD = process.env.HOST_PASSWORD || '';
const ROOM = normalizeRoom(process.env.ROOM_CODE || '1124') || '1124';
const PDF_LIMIT = 12 * 1024 * 1024;
const BACKLOG_MAX = 12;
const GLOBAL_MSG_PER_SEC = 20;
const GLOBAL_EMOJI_PER_SEC = 30;

const publicDir = path.join(__dirname, 'public');
const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
const samplePdfPath = path.join(publicDir, 'sample', 'workshop.pdf');

const state = {
  paused: false,
  qrMode: 'full',
  filterWords: DEFAULT_WORDS.slice(),
  deck: 'slides',
  embedUrl: '',
  pdfKind: '',
  pdfBuf: null,
  pdfName: '',
  pdfRev: 1,
  page: 1,
  pageCount: 3,
  backlog: [],
};

const hostTokens = new Set();
const rates = new Map();
const msgWindow = [];
const emojiWindow = [];
const loginHits = new Map();
const qrCache = new Map();
let samplePdfBuf = loadSamplePdf();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_LIMIT, files: 1 },
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// Socket.IO answers /socket.io on the same HTTP server. Stop Express from
// reading the body or writing a 404 first, or the polling transport (the
// WebSocket fallback Render uses when an upgrade is dropped) never completes.
app.use((req, res, next) => {
  if (req.url.startsWith('/socket.io')) return;
  next();
});
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.get('/api/options', (req, res) => {
  res.json({ ok: true, ...OPTIONS });
});

app.get('/api/join-info', async (req, res) => {
  try {
    const base = publicBase(req);
    const joinUrl = `${base}/?room=${encodeURIComponent(ROOM)}`;
    let qrDataUrl = qrCache.get(joinUrl);
    if (!qrDataUrl) {
      qrDataUrl = await QRCode.toDataURL(joinUrl, {
        errorCorrectionLevel: 'Q',
        margin: 1,
        width: 640,
        color: { dark: '#16140f', light: '#ffffff' },
      });
      qrCache.set(joinUrl, qrDataUrl);
    }
    res.json({ ok: true, room: ROOM, joinUrl, qrDataUrl });
  } catch (err) {
    console.error('qr', err);
    res.status(500).json({ ok: false, error: 'QR code 產生失敗' });
  }
});

app.post('/api/host/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowLogin(ip)) {
    return res.status(429).json({ ok: false, error: '嘗試太多次，請稍後再試' });
  }
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!HOST_PASSWORD || !safeEqual(password, HOST_PASSWORD)) {
    return res.status(401).json({ ok: false, error: '密碼不正確' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  hostTokens.add(token);
  res.json({ ok: true, token, filter: state.filterWords, state: publicState() });
});

app.get('/api/pdf', (req, res) => {
  if (state.pdfKind === 'upload' && state.pdfBuf) {
    return sendPdf(res, state.pdfBuf, state.pdfName || 'slides.pdf');
  }
  if (state.pdfKind === 'sample' && samplePdfBuf) {
    return sendPdf(res, samplePdfBuf, 'workshop.pdf');
  }
  return res.status(404).json({ ok: false, error: '尚未設定 PDF' });
});

app.post('/api/pdf', requireHost, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        ok: false,
        error: tooBig ? 'PDF 需小於 12MB' : '請上傳 PDF 檔',
      });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: '請選擇 PDF 檔' });
    }
    const buf = req.file.buffer;
    if (buf.length < 5 || buf.slice(0, 4).toString('ascii') !== '%PDF') {
      return res.status(400).json({ ok: false, error: '這不是 PDF 檔' });
    }
    setPdf('upload', buf, req.file.originalname || 'slides.pdf');
    broadcastState();
    res.json({ ok: true, state: publicState() });
  });
});

app.get('/screen', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'screen.html'));
});

app.use('/vendor/pdfjs', express.static(pdfjsDir, { setHeaders: setModuleType }));
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-store');
  },
}));

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  res.status(500).json({ ok: false, error: 'server error' });
});

const server = http.createServer(app);
// Render's proxy closes idle sockets; Node's short default causes 502s.
server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;

const io = new Server(server, {
  pingInterval: 20000,
  pingTimeout: 25000,
  maxHttpBufferSize: 1e5,
});

io.on('connection', (socket) => {
  socket.on('heartbeat', () => {});

  socket.on('hello', (msg, ack) => {
    const body = asObject(msg);
    const room = String(body.room || '').trim().toUpperCase();
    if (room !== ROOM) return reply(ack, { ok: false, reason: 'room' });
    socket.data.clientId = sanitizeId(body.clientId) || crypto.randomBytes(8).toString('hex');
    socket.data.role = body.role === 'screen' ? 'screen' : 'join';
    if (socket.data.role === 'screen') socket.emit('backlog', state.backlog);
    reply(ack, {
      ok: true,
      clientId: socket.data.clientId,
      room: ROOM,
      state: publicState(),
    });
    io.emit('viewers', { count: countViewers() });
  });

  socket.on('disconnect', () => {
    io.emit('viewers', { count: countViewers(socket.id) });
  });

  socket.on('message', (msg, ack) => {
    const result = acceptMessage(socket, msg);
    if (result.ok) {
      state.backlog.push(result.item);
      if (state.backlog.length > BACKLOG_MAX) state.backlog.shift();
      io.emit('danmaku', result.item);
      reply(ack, { ok: true, id: result.item.id });
      return;
    }
    reply(ack, result);
  });

  socket.on('emoji', (msg, ack) => {
    const result = acceptEmoji(socket, msg);
    if (result.ok) {
      io.emit('emoji', result.item);
      reply(ack, { ok: true, id: result.item.id });
      return;
    }
    reply(ack, result);
  });

  socket.on('host-join', (msg, ack) => {
    if (!hostOk(msg)) {
      socket.data.host = false;
      return reply(ack, { ok: false, reason: 'auth' });
    }
    socket.data.host = true;
    reply(ack, { ok: true, filter: state.filterWords, state: publicState() });
  });

  socket.on('host-pause', (msg, ack) => {
    if (!hostOk(msg)) return reply(ack, { ok: false, reason: 'auth' });
    state.paused = Boolean(msg.paused);
    broadcastState();
    reply(ack, { ok: true, state: publicState() });
  });

  socket.on('host-clear', (msg, ack) => {
    if (!hostOk(msg)) return reply(ack, { ok: false, reason: 'auth' });
    state.backlog = [];
    io.emit('cleared');
    reply(ack, { ok: true });
  });

  socket.on('host-qr', (msg, ack) => {
    if (!hostOk(msg)) return reply(ack, { ok: false, reason: 'auth' });
    if (!['full', 'corner', 'hidden'].includes(msg.mode)) {
      return reply(ack, { ok: false, reason: 'bad-request' });
    }
    state.qrMode = msg.mode;
    broadcastState();
    reply(ack, { ok: true, state: publicState() });
  });

  socket.on('host-filter', (msg, ack) => {
    if (!hostOk(msg)) return reply(ack, { ok: false, reason: 'auth' });
    state.filterWords = msg.reset ? DEFAULT_WORDS.slice() : sanitizeWordList(msg.words);
    for (const peer of io.sockets.sockets.values()) {
      if (peer.data.host) peer.emit('filter', { words: state.filterWords });
    }
    reply(ack, { ok: true, words: state.filterWords });
  });

  socket.on('host-deck', (msg, ack) => {
    if (!hostOk(msg)) return reply(ack, { ok: false, reason: 'auth' });
    if (msg.type === 'slides') {
      setSlides();
    } else if (msg.type === 'pdf' && msg.pdf === 'sample') {
      setPdf('sample', null, 'workshop.pdf');
    } else if (msg.type === 'url') {
      const embed = toEmbedUrl(msg.url);
      if (!embed) return reply(ack, { ok: false, reason: 'bad-url' });
      state.deck = 'url';
      state.embedUrl = embed;
      state.page = 1;
      state.pageCount = 1;
    } else {
      return reply(ack, { ok: false, reason: 'bad-request' });
    }
    broadcastState();
    reply(ack, { ok: true, state: publicState() });
  });

  socket.on('host-page', (msg, ack) => {
    if (!hostOk(msg)) return reply(ack, { ok: false, reason: 'auth' });
    if (state.deck === 'url') return reply(ack, { ok: false, reason: 'no-pages' });
    const count = Math.max(1, state.pageCount || 1);
    let page = state.page;
    if (msg.page !== undefined && msg.page !== null && msg.page !== '') {
      page = Number(msg.page);
    } else if (msg.delta) {
      page += Number(msg.delta) || 0;
    }
    if (!Number.isFinite(page)) return reply(ack, { ok: false, reason: 'bad-request' });
    state.page = Math.min(count, Math.max(1, Math.floor(page)));
    broadcastState();
    reply(ack, { ok: true, state: publicState() });
  });

  socket.on('host-pages', (msg, ack) => {
    if (!hostOk(msg)) return reply(ack, { ok: false, reason: 'auth' });
    if (state.deck !== 'pdf') return reply(ack, { ok: false, reason: 'no-pdf' });
    const n = Math.floor(Number(msg.pageCount));
    if (!(n >= 1 && n <= 500)) return reply(ack, { ok: false, reason: 'bad-request' });
    state.pageCount = n;
    if (state.page > n) state.page = n;
    broadcastState();
    reply(ack, { ok: true, state: publicState() });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanIPv4();
  console.log(`danmaku listening on 0.0.0.0:${PORT}`);
  console.log(`screen  http://127.0.0.1:${PORT}/screen`);
  if (lan) console.log(`lan     http://${lan}:${PORT}/screen`);
  console.log(`room    ${ROOM}`);
  console.log(HOST_PASSWORD ? 'host password set' : 'HOST_PASSWORD is empty — host controls are disabled');
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function acceptMessage(socket, msg) {
  if (!socket.data.clientId) return { ok: false, reason: 'hello' };
  if (state.paused) return { ok: false, reason: 'paused' };
  const body = asObject(msg);
  const text = cleanText(body.text);
  const length = Array.from(text).length;
  if (!text) return { ok: false, reason: 'empty' };
  if (length > OPTIONS.maxLength) return { ok: false, reason: 'too-long' };
  if (!OPTIONS.sizes.includes(body.size)) return { ok: false, reason: 'bad-size' };
  const color = String(body.color || '').toUpperCase();
  if (!OPTIONS.colors.includes(color)) return { ok: false, reason: 'bad-color' };
  if (!OPTIONS.motions.includes(body.motion)) return { ok: false, reason: 'bad-motion' };
  if (isBlocked(text, state.filterWords)) return { ok: false, reason: 'filter' };

  const now = Date.now();
  const rec = clientRate(socket.data.clientId);
  const wait = OPTIONS.msgIntervalMs - (now - rec.msgAt);
  if (rec.msgAt && wait > 0) return { ok: false, reason: 'rate', retryInMs: wait };
  if (!takeSlot(msgWindow, GLOBAL_MSG_PER_SEC, 1000)) {
    return { ok: false, reason: 'busy', retryInMs: 500 };
  }
  rec.msgAt = now;
  pruneRates();
  return {
    ok: true,
    item: {
      id: crypto.randomBytes(8).toString('hex'),
      text,
      size: body.size,
      color,
      motion: body.motion,
      at: now,
    },
  };
}

function acceptEmoji(socket, msg) {
  if (!socket.data.clientId) return { ok: false, reason: 'hello' };
  if (state.paused) return { ok: false, reason: 'paused' };
  const emoji = asObject(msg).emoji;
  if (!OPTIONS.emojis.includes(emoji)) return { ok: false, reason: 'bad-emoji' };
  const now = Date.now();
  const rec = clientRate(socket.data.clientId);
  const wait = OPTIONS.emojiIntervalMs - (now - rec.emojiAt);
  if (rec.emojiAt && wait > 0) return { ok: false, reason: 'rate', retryInMs: wait };
  if (!takeSlot(emojiWindow, GLOBAL_EMOJI_PER_SEC, 1000)) {
    return { ok: false, reason: 'busy', retryInMs: 400 };
  }
  rec.emojiAt = now;
  return {
    ok: true,
    item: { id: crypto.randomBytes(8).toString('hex'), emoji, at: now },
  };
}

function setSlides() {
  state.deck = 'slides';
  state.page = 1;
  state.pageCount = 3;
}

function setPdf(kind, buf, name) {
  state.deck = 'pdf';
  state.pdfKind = kind;
  if (kind === 'upload') state.pdfBuf = buf;
  state.pdfName = name || (kind === 'sample' ? 'workshop.pdf' : 'slides.pdf');
  state.page = 1;
  const guessed = kind === 'sample' ? guessPdfPages(samplePdfBuf) : guessPdfPages(buf);
  state.pageCount = guessed || 1;
  state.pdfRev += 1;
}

function guessPdfPages(buf) {
  if (!buf) return 0;
  const matches = buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

function publicState() {
  return {
    paused: state.paused,
    qrMode: state.qrMode,
    viewers: countViewers(),
    deck: {
      type: state.deck,
      url: state.deck === 'url' ? state.embedUrl : '',
      pdf: state.deck === 'pdf' ? state.pdfKind : '',
      name: state.deck === 'pdf' ? state.pdfName : '',
      page: state.page,
      pageCount: state.pageCount,
      rev: state.pdfRev,
    },
  };
}

function broadcastState() {
  io.emit('state', publicState());
}

function countViewers(exceptId) {
  const ids = new Set();
  for (const peer of io.sockets.sockets.values()) {
    if (peer.id === exceptId) continue;
    if (peer.data.role === 'join' && peer.data.clientId) ids.add(peer.data.clientId);
  }
  return ids.size;
}

function clientRate(clientId) {
  let rec = rates.get(clientId);
  if (!rec) {
    rec = { msgAt: 0, emojiAt: 0 };
    rates.set(clientId, rec);
  }
  return rec;
}

function pruneRates() {
  if (rates.size < 3000) return;
  const now = Date.now();
  for (const [key, rec] of rates) {
    if (now - Math.max(rec.msgAt, rec.emojiAt) > 30 * 60 * 1000) rates.delete(key);
  }
}

function takeSlot(bucket, limit, windowMs) {
  const now = Date.now();
  while (bucket.length && now - bucket[0] > windowMs) bucket.shift();
  if (bucket.length >= limit) return false;
  bucket.push(now);
  return true;
}

function allowLogin(ip) {
  const now = Date.now();
  const rec = loginHits.get(ip) || { start: now, n: 0 };
  if (now - rec.start > 60000) {
    rec.start = now;
    rec.n = 0;
  }
  rec.n += 1;
  loginHits.set(ip, rec);
  return rec.n <= 8;
}

function requireHost(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+([a-f0-9]{48})$/i);
  if (!match || !hostTokens.has(match[1])) {
    return res.status(401).json({ ok: false, error: '需要主持人密碼' });
  }
  next();
}

function hostOk(msg) {
  return Boolean(msg && typeof msg.token === 'string' && hostTokens.has(msg.token));
}

function sendPdf(res, buf, name) {
  res.set('Content-Type', 'application/pdf');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Disposition', `inline; filename="${String(name).replace(/["\r\n]/g, '')}"`);
  res.send(buf);
}

function publicBase(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/$/, '');
  const fwdHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = fwdHost || req.get('host') || `127.0.0.1:${PORT}`;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const hostname = host.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    const port = host.includes(':') ? host.split(':').pop() : String(PORT);
    const lan = lanIPv4();
    if (lan) return `http://${lan}:${port}`;
  }
  return `${proto}://${host}`;
}

function lanIPv4() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      found.push(net.address);
    }
  }
  return found.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip))
    || found[0]
    || null;
}

function loadSamplePdf() {
  try {
    if (fs.existsSync(samplePdfPath)) return fs.readFileSync(samplePdfPath);
  } catch (err) {
    console.error('sample pdf read', err);
  }
  const buf = buildSamplePdf();
  try {
    fs.mkdirSync(path.dirname(samplePdfPath), { recursive: true });
    fs.writeFileSync(samplePdfPath, buf);
  } catch (err) {
    console.error('sample pdf write', err);
  }
  return buf;
}

function normalizeRoom(value) {
  const room = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(room) ? room : '';
}

function sanitizeId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function reply(ack, data) {
  if (typeof ack === 'function') ack(data);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function setModuleType(res, filePath) {
  if (filePath.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
