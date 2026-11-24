'use strict';

// End-to-end check: filter, embed URLs, health, sockets, every motion,
// emoji, pause, clear, QR, bad words, per-client and global rate limits, PDF upload.

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { isBlocked } = require('../lib/filter');
const { toEmbedUrl } = require('../lib/embed');
const { buildSamplePdf } = require('../lib/samplePdf');
const OPTIONS = require('../lib/options');

const PORT = process.env.SIM_PORT || '4733';
const BASE = process.env.SIM_BASE || `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.SIM_PASSWORD || 'test-pass';
const ROOM = '1124';

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok  ', msg);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitAck(socket, event, payload, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), timeout);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function connect(base = BASE) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { transports: ['websocket'], forceNew: true, timeout: 5000 });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function hello(socket, role, clientId, room = ROOM) {
  return emitAck(socket, 'hello', { role, room, clientId });
}

function nid(prefix) {
  return `${prefix}${crypto.randomBytes(6).toString('hex')}`.slice(0, 32);
}

function unit() {
  assert(isBlocked('他媽的', ['他媽的']), 'blocks exact Chinese');
  assert(isBlocked('他 媽 的', ['他媽的']), 'blocks Chinese with spaces');
  assert(isBlocked('ＦＵＣＫ you', ['fuck']), 'blocks fullwidth latin');
  assert(isBlocked('what the f u c k', ['fuck']), 'blocks spaced latin');
  assert(!isBlocked('我媽媽今天來', ['他媽的']), 'does not block 我媽媽');
  assert(!isBlocked('大家好', ['fuck', '幹你']), 'allows a normal line');
  assert(!isBlocked('幹什麼', ['幹你']), 'does not treat 幹 as 幹你');
  assert(isBlocked('幹你娘', ['幹你']), 'blocks 幹你 inside a longer slur');

  const slides = 'https://docs.google.com/presentation/d/abc_DEF-123/edit?usp=sharing';
  assert(
    toEmbedUrl(slides) === 'https://docs.google.com/presentation/d/abc_DEF-123/embed?start=false&loop=false&delayms=3000',
    'rewrites a Google Slides edit link'
  );
  const published = 'https://docs.google.com/presentation/d/e/2PACX-abc/pub?start=false';
  assert(
    toEmbedUrl(published) === 'https://docs.google.com/presentation/d/e/2PACX-abc/embed?start=false&loop=false&delayms=3000',
    'rewrites a published Google Slides link'
  );
  assert(toEmbedUrl('https://example.com/deck') === 'https://example.com/deck', 'keeps a normal https url');
  assert(toEmbedUrl('javascript:alert(1)') === null, 'rejects javascript urls');
  assert(toEmbedUrl('not a url') === null, 'rejects junk');

  const pdf = buildSamplePdf();
  assert(pdf.slice(0, 5).toString() === '%PDF-', 'sample pdf header');
  const pageObjs = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || [];
  assert(pageObjs.length === 3, `sample pdf has 3 pages (got ${pageObjs.length})`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT,
        HOST_PASSWORD: PASSWORD,
        ROOM_CODE: ROOM,
        PUBLIC_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    let settled = false;
    child.stdout.on('data', (buf) => { logs += buf; });
    child.stderr.on('data', (buf) => { logs += buf; });
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`server exited ${code}\n${logs}`));
    });
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/health`);
        if (res.ok) {
          settled = true;
          clearInterval(timer);
          child.logs = logs;
          resolve(child);
        }
      } catch (err) { /* not up yet */ }
      if (!settled && Date.now() - started > 8000) {
        clearInterval(timer);
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`server did not become healthy\n${logs}`));
      }
    }, 120);
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(1500).then(() => child.kill('SIGKILL')),
  ]);
}

async function integration() {
  const health = await fetch(`${BASE}/health`);
  const healthBody = await health.json();
  assert(health.status === 200 && healthBody.ok === true, 'GET /health');

  const info = await (await fetch(`${BASE}/api/join-info`)).json();
  assert(info.room === ROOM && info.joinUrl.includes(`room=${ROOM}`), 'join info has the room');
  assert(String(info.qrDataUrl).startsWith('data:image/png'), 'join info includes a PNG QR code');

  const options = await (await fetch(`${BASE}/api/options`)).json();
  assert(options.motions.join() === OPTIONS.motions.join(), 'options list the five motions');
  assert(options.emojis.length === 6, 'options list six emoji');

  const joinHtml = await (await fetch(`${BASE}/`)).text();
  const screenHtml = await (await fetch(`${BASE}/screen`)).text();
  const screenJs = await (await fetch(`${BASE}/js/screen.js`)).text();
  const worker = await fetch(`${BASE}/vendor/pdfjs/build/pdf.worker.min.mjs`);
  assert(joinHtml.includes('把一句話丟上螢幕') && joinHtml.includes('lang="zh-Hant"'), 'join page is Traditional Chinese');
  assert(screenHtml.includes('主持控制') && screenJs.includes('/vendor/pdfjs/build/pdf.min.mjs'), 'screen page has host controls and pdf.js');
  assert(worker.ok && String(worker.headers.get('content-type')).includes('javascript'), 'pdf.js worker is served as JavaScript');

  const polling = await new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['polling'], forceNew: true, timeout: 5000 });
    const timer = setTimeout(() => reject(new Error('polling timeout')), 5000);
    socket.on('connect', async () => {
      try {
        clearTimeout(timer);
        const res = await hello(socket, 'join', nid('poll'));
        socket.close();
        resolve(res);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  assert(polling.ok, 'Socket.IO polling transport connects');

  const screen = await connect();
  const seen = [];
  const emojis = [];
  let cleared = 0;
  screen.on('danmaku', (item) => seen.push(item));
  screen.on('emoji', (item) => emojis.push(item));
  screen.on('cleared', () => { cleared += 1; });
  const screenHello = await hello(screen, 'screen', nid('screen'));
  assert(screenHello.ok && screenHello.state.deck.type === 'slides', 'screen joins on the built-in slides');

  const wrong = await connect();
  const wrongHello = await hello(wrong, 'join', nid('wrong'), 'NOPE');
  assert(wrongHello.ok === false && wrongHello.reason === 'room', 'wrong room is rejected');
  wrong.close();

  const motions = ['scroll', 'top', 'bottom', 'float', 'bounce'];
  const sizes = ['s', 'm', 'l', 'm', 'l'];
  await Promise.all(motions.map(async (motion, index) => {
    const sock = await connect();
    const joined = await hello(sock, 'join', nid(`m${index}`));
    assert(joined.ok, `client joined for ${motion}`);
    const res = await emitAck(sock, 'message', {
      text: `樣式${motion}`,
      size: sizes[index],
      color: OPTIONS.colors[index],
      motion,
    });
    assert(res.ok, `accepted motion ${motion}`);
    sock.close();
  }));
  await sleep(250);
  for (const motion of motions) {
    assert(seen.some((item) => item.motion === motion && item.text === `樣式${motion}`), `screen received ${motion}`);
  }
  assert(seen.some((item) => item.size === 'l' && item.color === '#FF8AD4' && item.motion === 'bounce'), 'screen kept size and color');

  const limits = await connect();
  await hello(limits, 'join', nid('limit'));
  const first = await emitAck(limits, 'message', {
    text: '第一則',
    size: 'm',
    color: '#FFFFFF',
    motion: 'scroll',
  });
  const second = await emitAck(limits, 'message', {
    text: '第二則太快',
    size: 'm',
    color: '#FFFFFF',
    motion: 'scroll',
  });
  assert(first.ok, 'first message within the rate limit');
  assert(!second.ok && second.reason === 'rate' && second.retryInMs > 0 && second.retryInMs <= 3000, 'second message is rate limited to 3s');
  limits.close();

  const messy = await connect();
  await hello(messy, 'join', nid('messy'));
  const empty = await emitAck(messy, 'message', { text: '   ', size: 'm', color: '#FFFFFF', motion: 'scroll' });
  const long = await emitAck(messy, 'message', { text: '字'.repeat(51), size: 'm', color: '#FFFFFF', motion: 'scroll' });
  const exact = await emitAck(messy, 'message', { text: '字'.repeat(50), size: 's', color: '#7AD7FF', motion: 'float' });
  const slur = await emitAck(messy, 'message', { text: '這句有 fuck 不行', size: 'm', color: '#FFFFFF', motion: 'scroll' });
  assert(!empty.ok && empty.reason === 'empty', 'rejects empty');
  assert(!long.ok && long.reason === 'too-long', 'rejects 51 characters');
  assert(exact.ok, 'accepts 50 characters');
  assert(!slur.ok && slur.reason === 'filter', 'rejects a blocked word');
  await sleep(150);
  assert(!seen.some((item) => item.text && item.text.includes('fuck')), 'filtered text never reaches the screen');
  messy.close();

  const fan = await connect();
  await hello(fan, 'join', nid('fan'));
  const yay = await emitAck(fan, 'emoji', { emoji: '🔥' });
  const badEmoji = await emitAck(fan, 'emoji', { emoji: '💀' });
  const again = await emitAck(fan, 'emoji', { emoji: '👏' });
  assert(yay.ok, 'accepts a listed emoji');
  assert(!badEmoji.ok && badEmoji.reason === 'bad-emoji', 'rejects an unlisted emoji');
  assert(!again.ok && again.reason === 'rate', 'emoji is rate limited');
  await sleep(150);
  assert(emojis.some((item) => item.emoji === '🔥'), 'screen received the emoji');
  fan.close();

  const badLogin = await fetch(`${BASE}/api/host/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nope' }),
  });
  assert(badLogin.status === 401, 'wrong host password is 401');
  const goodLogin = await fetch(`${BASE}/api/host/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const auth = await goodLogin.json();
  assert(goodLogin.status === 200 && /^[a-f0-9]{48}$/.test(auth.token), 'right host password returns a token');
  assert(Array.isArray(auth.filter) && auth.filter.includes('fuck'), 'host receives the filter list');

  const control = await connect();
  const paused = await emitAck(control, 'host-pause', { token: auth.token, paused: true });
  assert(paused.ok && paused.state.paused === true, 'host can pause');
  const whilePaused = await connect();
  await hello(whilePaused, 'join', nid('paused'));
  const rejected = await emitAck(whilePaused, 'message', {
    text: '暫停中',
    size: 'm',
    color: '#FFFFFF',
    motion: 'scroll',
  });
  assert(!rejected.ok && rejected.reason === 'paused', 'paused room rejects messages');
  whilePaused.close();
  const resumed = await emitAck(control, 'host-pause', { token: auth.token, paused: false });
  assert(resumed.ok && resumed.state.paused === false, 'host can resume');

  const beforeClear = cleared;
  const didClear = await emitAck(control, 'host-clear', { token: auth.token });
  await sleep(100);
  assert(didClear.ok && cleared === beforeClear + 1, 'clear broadcasts to the screen');

  const corner = await emitAck(control, 'host-qr', { token: auth.token, mode: 'corner' });
  assert(corner.ok && corner.state.qrMode === 'corner', 'QR can move to the corner');
  const hidden = await emitAck(control, 'host-qr', { token: auth.token, mode: 'hidden' });
  assert(hidden.ok && hidden.state.qrMode === 'hidden', 'QR can be hidden');
  await emitAck(control, 'host-qr', { token: auth.token, mode: 'full' });

  const custom = await emitAck(control, 'host-filter', { token: auth.token, words: ['測試禁詞'] });
  assert(custom.ok && custom.words.length === 1, 'host can replace the filter list');
  const blockedCustom = await connect();
  await hello(blockedCustom, 'join', nid('custom'));
  const customRes = await emitAck(blockedCustom, 'message', {
    text: '請不要說測試禁詞',
    size: 'm',
    color: '#FFFFFF',
    motion: 'bottom',
  });
  assert(!customRes.ok && customRes.reason === 'filter', 'custom filter word blocks a message');
  blockedCustom.close();
  const reset = await emitAck(control, 'host-filter', { token: auth.token, reset: true });
  assert(reset.ok && reset.words.includes('機掰'), 'reset restores the default list');

  const embed = await emitAck(control, 'host-deck', {
    token: auth.token,
    type: 'url',
    url: 'https://docs.google.com/presentation/d/abc_DEF-123/edit?usp=sharing',
  });
  assert(embed.ok && embed.state.deck.url.includes('/embed?'), 'host can embed a slides url');
  const jsUrl = await emitAck(control, 'host-deck', { token: auth.token, type: 'url', url: 'javascript:alert(1)' });
  assert(!jsUrl.ok && jsUrl.reason === 'bad-url', 'javascript embed is rejected');
  const noPage = await emitAck(control, 'host-page', { token: auth.token, delta: 1 });
  assert(!noPage.ok && noPage.reason === 'no-pages', 'embedded web pages have no page keys');

  const unauthPdf = await fetch(`${BASE}/api/pdf`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + 'ab'.repeat(24) },
    body: new FormData(),
  });
  assert(unauthPdf.status === 401, 'PDF upload requires the host token');

  const fake = new FormData();
  fake.append('file', new Blob(['not a pdf'], { type: 'application/pdf' }), 'notes.pdf');
  const fakeRes = await fetch(`${BASE}/api/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}` },
    body: fake,
  });
  assert(fakeRes.status === 400, 'non-PDF bytes are rejected');

  const sample = await emitAck(control, 'host-deck', { token: auth.token, type: 'pdf', pdf: 'sample' });
  assert(sample.ok && sample.state.deck.type === 'pdf' && sample.state.deck.pageCount === 3, 'sample PDF becomes the background');
  const jumped = await emitAck(control, 'host-page', { token: auth.token, page: 99 });
  assert(jumped.ok && jumped.state.deck.page === 3, 'page changes clamp to the deck');
  const pdfRes = await fetch(`${BASE}/api/pdf?rev=${sample.state.deck.rev}`);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  assert(pdfRes.headers.get('content-type').includes('application/pdf') && pdfBuf.slice(0, 4).toString() === '%PDF', 'GET /api/pdf serves the sample');

  const uploaded = buildSamplePdf();
  const form = new FormData();
  form.append('file', new Blob([uploaded], { type: 'application/pdf' }), 'slides.pdf');
  const up = await fetch(`${BASE}/api/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}` },
    body: form,
  });
  const upBody = await up.json();
  assert(up.status === 200 && upBody.state.deck.pdf === 'upload' && upBody.state.deck.name === 'slides.pdf', 'host can upload a PDF');

  const burstSockets = await Promise.all(Array.from({ length: 25 }, () => connect()));
  await Promise.all(burstSockets.map((sock, index) => hello(sock, 'join', nid(`b${index}`))));
  const burst = await Promise.all(burstSockets.map((sock, index) => emitAck(sock, 'message', {
    text: `湧入${index}`,
    size: 's',
    color: '#FFFFFF',
    motion: 'scroll',
  })));
  const busy = burst.filter((res) => res && res.reason === 'busy').length;
  const accepted = burst.filter((res) => res && res.ok).length;
  assert(accepted <= 20 && busy >= 1, `global cap holds a 25-message burst (accepted ${accepted}, busy ${busy})`);
  burstSockets.forEach((sock) => sock.close());

  await emitAck(control, 'host-deck', { token: auth.token, type: 'slides' });
  await emitAck(control, 'host-clear', { token: auth.token });
  await emitAck(control, 'host-pause', { token: auth.token, paused: false });
  control.close();
  screen.close();
}

async function live() {
  const base = process.env.SIM_BASE || 'http://127.0.0.1:4721';
  const room = process.env.ROOM_CODE || '1124';
  const lines = [
    ['這堂課聽得好清楚', 'm', '#FFFFFF', 'scroll'],
    ['投影片可以再停一下', 'l', '#FFE14A', 'top'],
    ['台北今晚好冷', 's', '#7AD7FF', 'scroll'],
    ['我聽懂了', 'm', '#7CFFB2', 'bottom'],
    ['QR 掃得到', 'm', '#FF8AD4', 'float'],
    ['字好大', 'l', '#FF6B4A', 'bounce'],
    ['再講一次剛才那個例子', 'm', '#D4B5FF', 'scroll'],
    ['現場好安靜', 's', '#C8F542', 'scroll'],
    ['這個顏色很亮', 'l', '#FFFFFF', 'top'],
    ['謝謝老師', 'm', '#FFE14A', 'bottom'],
  ];
  const emojis = OPTIONS.emojis;
  const clients = [];
  for (let i = 0; i < 6; i += 1) {
    const socket = await connect(base);
    await hello(socket, 'join', nid(`live${i}`), room);
    clients.push(socket);
  }
  console.log(`live clients sending to ${base}`);
  let n = 0;
  setInterval(() => {
    const line = lines[n % lines.length];
    const socket = clients[n % clients.length];
    socket.emit('message', { text: line[0], size: line[1], color: line[2], motion: line[3] }, () => {});
    if (n % 4 === 0) socket.emit('emoji', { emoji: emojis[n % emojis.length] }, () => {});
    n += 1;
  }, 560);
}

async function main() {
  unit();
  const child = await startServer();
  try {
    await integration();
  } finally {
    await stop(child);
  }
  if (failures) {
    console.error(`\n${failures} failed`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

if (process.argv.includes('--live')) {
  live().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  main().catch(async (err) => {
    console.error(err);
    process.exit(1);
  });
}
