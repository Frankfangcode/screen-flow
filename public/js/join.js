(function () {
  const $ = (id) => document.getElementById(id);
  const MOTION_LABEL = {
    scroll: '由右至左',
    top: '上方停留',
    bottom: '下方停留',
    float: '向上飄',
    bounce: '彈跳',
  };
  const SIZE_LABEL = { s: '小', m: '中', l: '大' };
  const COLOR_LABEL = {
    '#FFFFFF': '白',
    '#FFE14A': '黃',
    '#7CFFB2': '綠',
    '#7AD7FF': '藍',
    '#FF8AD4': '粉',
    '#FF6B4A': '珊瑚',
    '#D4B5FF': '紫',
    '#C8F542': '萊姆',
  };

  const fallback = {
    maxLength: 50,
    msgIntervalMs: 3000,
    emojiIntervalMs: 1500,
    sizes: ['s', 'm', 'l'],
    colors: ['#FFFFFF', '#FFE14A', '#7CFFB2', '#7AD7FF', '#FF8AD4', '#FF6B4A', '#D4B5FF', '#C8F542'],
    motions: ['scroll', 'top', 'bottom', 'float', 'bounce'],
    emojis: ['👍', '😂', '❤️', '🔥', '👏', '🤯'],
  };

  let options = fallback;
  let room = readRoom();
  let clientId = readClientId();
  let size = 'm';
  let color = '#FFE14A';
  let motion = 'scroll';
  let paused = false;
  let sending = false;
  let sendSeq = 0;
  let socket = null;
  let heartbeatTimer = null;

  function readRoom() {
    const fromQuery = new URLSearchParams(location.search).get('room') || '';
    let stored = '';
    try { stored = sessionStorage.getItem('danmaku-room') || ''; } catch (err) { stored = ''; }
    return (fromQuery || stored).trim().toUpperCase();
  }

  function readClientId() {
    let current = '';
    try { current = localStorage.getItem('danmaku-client-id') || ''; } catch (err) { current = ''; }
    if (/^[A-Za-z0-9_-]{8,64}$/.test(current)) return current;
    const next = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(16).slice(2).padEnd(16, '0')).slice(0, 32);
    try { localStorage.setItem('danmaku-client-id', next); } catch (err) { /* private mode */ }
    return next;
  }

  function reasonText(res) {
    const reason = res && res.reason;
    if (reason === 'paused') return '主持人已暫停留言';
    if (reason === 'rate') return `太快了，請再等 ${Math.max(1, Math.ceil((res.retryInMs || 1000) / 1000))} 秒`;
    if (reason === 'busy') return '現在太多人同時送出，請再試一次';
    if (reason === 'filter') return '這則留言含有不適當的字，沒有送出';
    if (reason === 'empty') return '請先輸入留言';
    if (reason === 'too-long') return `最多 ${options.maxLength} 字`;
    if (reason === 'room') return '這個房間代碼不對';
    return '沒有送出，請再試一次';
  }

  function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${kind || ''}`;
  }

  function feedback(text, kind) {
    const el = $('feedback');
    el.textContent = text || '';
    el.className = `feedback ${kind || ''}`;
  }

  function clampText(value) {
    const chars = Array.from(value);
    if (chars.length <= options.maxLength) return value;
    return chars.slice(0, options.maxLength).join('');
  }

  function updateCount() {
    $('count').textContent = String(Array.from($('text').value).length);
  }

  function showGate(message) {
    document.documentElement.classList.add('needs-room');
    $('gate').hidden = false;
    $('composer').hidden = true;
    $('react').hidden = true;
    $('room-error').textContent = message || '';
  }

  function showComposer() {
    document.documentElement.classList.remove('needs-room');
    $('gate').hidden = true;
    $('composer').hidden = false;
    $('react').hidden = false;
    $('room-label').textContent = room;
  }

  function applyPaused(next) {
    paused = Boolean(next);
    $('pause-note').hidden = !paused;
    $('text').disabled = paused;
    $('send').disabled = paused || sending;
    document.querySelectorAll('#emojis button').forEach((button) => {
      button.disabled = paused;
    });
  }

  function buildControls() {
    const sizes = $('sizes');
    options.sizes.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.size = value;
      button.textContent = SIZE_LABEL[value] || value;
      button.setAttribute('aria-pressed', String(value === size));
      button.addEventListener('click', () => {
        size = value;
        sizes.querySelectorAll('button').forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
      });
      sizes.appendChild(button);
    });

    const colors = $('colors');
    options.colors.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.color = value;
      button.style.background = value;
      button.setAttribute('aria-label', COLOR_LABEL[value] || value);
      button.setAttribute('aria-pressed', String(value === color));
      button.addEventListener('click', () => {
        color = value;
        colors.querySelectorAll('button').forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
      });
      colors.appendChild(button);
    });

    const motions = $('motions');
    options.motions.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.motion = value;
      button.textContent = MOTION_LABEL[value] || value;
      button.setAttribute('aria-pressed', String(value === motion));
      button.addEventListener('click', () => {
        motion = value;
        motions.querySelectorAll('button').forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
      });
      motions.appendChild(button);
    });

    const emojis = $('emojis');
    options.emojis.forEach((emoji) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = emoji;
      button.setAttribute('aria-label', `送出 ${emoji}`);
      button.addEventListener('click', () => sendEmoji(emoji));
      emojis.appendChild(button);
    });
  }

  function connect(nextRoom) {
    room = String(nextRoom || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(room)) {
      showGate('請輸入 1 到 12 碼的英數房間代碼');
      return;
    }
    try { sessionStorage.setItem('danmaku-room', room); } catch (err) { /* ignore */ }
    showComposer();
    setStatus('連線中', 'pending');
    if (socket) socket.close();
    socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 10000,
    });
    socket.on('connect', () => {
      socket.emit('hello', { role: 'join', room, clientId }, (res) => {
        if (!res || !res.ok) {
          setStatus('房間代碼不正確', 'bad');
          showGate(reasonText(res));
          socket.disconnect();
          return;
        }
        if (res.clientId && res.clientId !== clientId) {
          clientId = res.clientId;
          try { localStorage.setItem('danmaku-client-id', clientId); } catch (err) { /* ignore */ }
        }
        applyState(res.state);
        setStatus('已連線', 'ok');
      });
    });
    socket.on('disconnect', () => setStatus('重新連線中', 'pending'));
    socket.on('connect_error', () => setStatus('連不上伺服器', 'bad'));
    socket.on('state', applyState);
    socket.on('viewers', (msg) => {
      if (msg && typeof msg.count === 'number') $('viewers').textContent = `在線 ${msg.count}`;
    });
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket && socket.connected) socket.emit('heartbeat');
    }, 45000);
  }

  function applyState(next) {
    if (!next) return;
    applyPaused(next.paused);
    if (typeof next.viewers === 'number') $('viewers').textContent = `在線 ${next.viewers}`;
  }

  function sendMessage() {
    if (!socket || !socket.connected) {
      feedback('連不上伺服器', 'bad');
      return;
    }
    if (paused || sending) return;
    const text = clampText($('text').value);
    $('text').value = text;
    updateCount();
    if (!Array.from(text).length) {
      feedback('請先輸入留言', 'bad');
      return;
    }
    sending = true;
    $('send').disabled = true;
    const seq = ++sendSeq;
    const timer = setTimeout(() => {
      if (seq !== sendSeq) return;
      sendSeq += 1;
      sending = false;
      $('send').disabled = paused;
      feedback('沒有回應，請再試一次', 'bad');
    }, 4000);
    socket.emit('message', { text, size, color, motion }, (res) => {
      if (seq !== sendSeq) return;
      clearTimeout(timer);
      sendSeq += 1;
      sending = false;
      $('send').disabled = paused;
      if (!res || !res.ok) {
        feedback(reasonText(res), 'bad');
        return;
      }
      $('text').value = '';
      updateCount();
      feedback('已送上螢幕', 'ok');
    });
  }

  function sendEmoji(emoji) {
    if (!socket || !socket.connected) {
      feedback('連不上伺服器', 'bad');
      return;
    }
    if (paused) return;
    socket.emit('emoji', { emoji }, (res) => {
      if (!res || !res.ok) {
        feedback(reasonText(res), 'bad');
        if (res && res.reason === 'rate') lockEmoji(res.retryInMs || options.emojiIntervalMs);
        return;
      }
      feedback('表情已送出', 'ok');
      lockEmoji(options.emojiIntervalMs);
    });
  }

  function lockEmoji(ms) {
    document.querySelectorAll('#emojis button').forEach((button) => { button.disabled = true; });
    setTimeout(() => {
      if (!paused) document.querySelectorAll('#emojis button').forEach((button) => { button.disabled = false; });
    }, Math.max(200, ms));
  }

  async function boot() {
    try {
      const res = await fetch('/api/options');
      if (res.ok) {
        const data = await res.json();
        options = {
          maxLength: data.maxLength || fallback.maxLength,
          msgIntervalMs: data.msgIntervalMs || fallback.msgIntervalMs,
          emojiIntervalMs: data.emojiIntervalMs || fallback.emojiIntervalMs,
          sizes: data.sizes || fallback.sizes,
          colors: data.colors || fallback.colors,
          motions: data.motions || fallback.motions,
          emojis: data.emojis || fallback.emojis,
        };
      }
    } catch (err) { /* use fallback */ }
    buildControls();
    $('text').addEventListener('input', () => {
      const next = clampText($('text').value);
      if (next !== $('text').value) $('text').value = next;
      updateCount();
    });
    $('composer').addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });
    $('text').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage();
      }
    });
    $('room-go').addEventListener('click', () => connect($('room-input').value));
    $('room-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') connect($('room-input').value);
    });
    if (room) connect(room);
    else showGate('');
  }

  boot();
})();
