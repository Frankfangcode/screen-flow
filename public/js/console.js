(function () {
  const $ = (id) => document.getElementById(id);
  const desktop = window.desktop || null;
  let token = '';
  let socket = null;
  let closed = false;
  let danmakuOn = true;
  let qrOn = true;
  let filterWords = [];
  const recent = [];
  const seen = new Set();
  let heartbeat = null;

  function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${kind || ''}`;
  }

  function note(text) {
    $('note').textContent = text || '';
  }

  function showPanel() {
    $('login').hidden = true;
    $('panel').hidden = false;
  }

  function renderInteraction() {
    const button = $('interaction');
    button.textContent = closed ? '開放互動' : '暫停互動';
    button.classList.toggle('is-closed', closed);
    button.setAttribute('aria-pressed', String(closed));
    $('interaction-note').textContent = closed
      ? '互動已關閉。新的留言不會出現，手機上會看到「主持人暫時關閉互動」。'
      : '開放時大家可以送留言。暫停互動會拒絕新留言，畫面上已經在飛的字不會停。';
    setStatus(closed ? '互動已關閉' : '已連線', closed ? 'bad' : 'ok');
  }

  function renderRecent() {
    const list = $('recent');
    list.replaceChildren();
    recent.slice(0, 12).forEach((item) => {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = item.at ? new Date(item.at).toLocaleTimeString('zh-Hant-TW', { hour12: false }) : '';
      time.dateTime = item.at ? new Date(item.at).toISOString() : '';
      li.append(time, document.createTextNode(item.text || ''));
      list.append(li);
    });
  }

  function pushRecent(item) {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    recent.unshift(item);
    if (recent.length > 40) recent.pop();
    renderRecent();
  }

  async function rememberPassword(password) {
    try { localStorage.setItem('danmaku-host-password', password); } catch (err) { /* ignore */ }
    if (desktop && desktop.saveConfig) await desktop.saveConfig({ password });
  }

  async function savedPassword() {
    if (desktop && desktop.getConfig) {
      const cfg = await desktop.getConfig();
      if (cfg && cfg.password) return cfg.password;
    }
    try { return localStorage.getItem('danmaku-host-password') || ''; } catch (err) { return ''; }
  }

  async function login(password) {
    const res = await fetch('/api/host/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $('login-error').textContent = data.error || '密碼不正確';
      setStatus('密碼不正確', 'bad');
      return false;
    }
    token = data.token;
    filterWords = data.filter || [];
    await rememberPassword(password);
    $('login-error').textContent = '';
    showPanel();
    connect(data.state);
    return true;
  }

  function connect(initial) {
    if (socket) socket.close();
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('hello', { role: 'console', room: window.__room || '', clientId: consoleId() }, () => {
        socket.emit('host-join', { token }, (res) => {
          if (!res || !res.ok) {
            setStatus('請重新輸入密碼', 'bad');
            $('panel').hidden = true;
            $('login').hidden = false;
            return;
          }
          if (Array.isArray(res.filter)) filterWords = res.filter;
          applyState(res.state || initial);
        });
      });
    });
    socket.on('state', applyState);
    socket.on('viewers', (msg) => {
      if (msg && typeof msg.count === 'number') $('viewers').textContent = `在線 ${msg.count}`;
    });
    socket.on('danmaku', pushRecent);
    socket.on('backlog', (items) => (items || []).forEach(pushRecent));
    socket.on('disconnect', () => setStatus('重新連線中', ''));
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (socket && socket.connected) socket.emit('heartbeat');
    }, 45000);
  }

  function applyState(next) {
    if (!next) return;
    closed = Boolean(next.interactionClosed);
    if (typeof next.viewers === 'number') $('viewers').textContent = `在線 ${next.viewers}`;
    renderInteraction();
  }

  function hostEmit(event, payload) {
    return new Promise((resolve) => {
      socket.emit(event, { token, ...payload }, resolve);
    });
  }

  function consoleId() {
    const key = 'danmaku-console-id';
    try {
      const current = localStorage.getItem(key) || '';
      if (/^[A-Za-z0-9_-]{8,64}$/.test(current)) return current;
      const next = `console${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 32);
      localStorage.setItem(key, next);
      return next;
    } catch (err) {
      return `console${Math.random().toString(16).slice(2)}0000`.slice(0, 32);
    }
  }

  $('login').addEventListener('submit', (event) => {
    event.preventDefault();
    login($('password').value);
  });

  $('interaction').addEventListener('click', async () => {
    const res = await hostEmit('host-interaction', { closed: !closed });
    if (!res || !res.ok) {
      note('沒有改成');
      return;
    }
    applyState(res.state);
    note(closed ? '已暫停互動' : '已開放互動');
  });

  $('clear').addEventListener('click', async () => {
    const res = await hostEmit('host-clear', {});
    note(res && res.ok ? '已清空畫面' : '沒有清空');
  });

  $('danmaku').addEventListener('click', async () => {
    if (!desktop || !desktop.setDanmaku) {
      note('請用 Mac app 的控制台切換彈幕層');
      return;
    }
    danmakuOn = !danmakuOn;
    const res = await desktop.setDanmaku(danmakuOn);
    if (!res || !res.ok) {
      danmakuOn = !danmakuOn;
      note('疊加視窗沒有打開');
      return;
    }
    $('danmaku').textContent = danmakuOn ? '隱藏彈幕層' : '顯示彈幕層';
    $('danmaku').classList.toggle('is-off', !danmakuOn);
    $('danmaku').setAttribute('aria-pressed', String(danmakuOn));
    note(danmakuOn ? '彈幕層已顯示' : '彈幕層已隱藏');
  });

  $('qr').addEventListener('click', async () => {
    if (!desktop || !desktop.setQr) {
      note('請用 Mac app 的控制台切換 QR');
      return;
    }
    qrOn = !qrOn;
    const res = await desktop.setQr(qrOn);
    if (!res || !res.ok) {
      qrOn = !qrOn;
      note('疊加視窗沒有打開');
      return;
    }
    $('qr').textContent = qrOn ? '隱藏 QR' : '顯示 QR';
    $('qr').classList.toggle('is-off', !qrOn);
    $('qr').setAttribute('aria-pressed', String(qrOn));
    note(qrOn ? 'QR 已顯示' : 'QR 已隱藏');
  });

  $('filter-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const word = $('word').value.trim();
    if (!word) return;
    const words = filterWords.concat([word]);
    const res = await hostEmit('host-filter', { words });
    if (!res || !res.ok) {
      note('沒有加入');
      return;
    }
    filterWords = res.words || words;
    $('word').value = '';
    note(`已加入「${word}」`);
  });

  $('export').addEventListener('click', async () => {
    note('正在匯出…');
    const res = await fetch('/api/export.csv', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      note('匯出失敗');
      return;
    }
    const text = await res.text();
    const filename = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/);
    const name = filename ? filename[1] : 'danmaku.csv';
    if (desktop && desktop.saveCsv) {
      const saved = await desktop.saveCsv({ filename: name, text });
      note(saved && saved.ok ? '已儲存 CSV' : '已取消儲存');
      return;
    }
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
    note('已下載 CSV');
  });

  async function boot() {
    const info = await fetch('/api/join-info').then((res) => res.json()).catch(() => ({}));
    window.__room = info.room || '';
    const password = await savedPassword();
    if (password) {
      $('password').value = password;
      const ok = await login(password);
      if (!ok) $('password').value = '';
    } else {
      setStatus('請輸入密碼', '');
    }
  }

  boot();
})();
