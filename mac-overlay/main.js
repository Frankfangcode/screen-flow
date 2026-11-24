'use strict';

// Transparent, click-through, always-on-top window.
// It loads /screen?overlay=1 so danmaku and a corner QR sit over Keynote or PowerPoint.
// Quit from the menu-bar icon, or press Command+Shift+Q.

const DEFAULT_URL = 'https://workshop-danmaku-1124.onrender.com/screen?overlay=1';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  dialog,
  globalShortcut,
  screen,
  ipcMain,
  nativeImage,
} = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

let tray = null;
let overlay = null;
let setup = null;
let consoleWin = null;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function normalizeUrl(input) {
  const url = new URL(String(input || '').trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('網址需要以 http:// 或 https:// 開頭');
  }
  if (!url.pathname.includes('/screen')) url.pathname = '/screen';
  if (url.searchParams.get('overlay') !== '1') url.searchParams.set('overlay', '1');
  return url.toString();
}

function findDisplay(id) {
  const all = screen.getAllDisplays();
  return all.find((display) => String(display.id) === String(id)) || screen.getPrimaryDisplay();
}

function closeOverlay() {
  if (!overlay || overlay.isDestroyed()) {
    overlay = null;
    return;
  }
  const win = overlay;
  overlay = null;
  win.destroy();
}

function raiseOverlay(win) {
  if (!win || win.isDestroyed()) return;
  // screen-saver is above normal always-on-top windows, including many slideshows.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setFullScreenable(false);
  win.moveTop();
}

function openOverlay(url, displayId) {
  closeOverlay();
  const display = findDisplay(displayId);
  const bounds = display.bounds;
  overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    fullscreen: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    type: process.platform === 'darwin' ? 'panel' : 'normal',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  overlay.setIgnoreMouseEvents(true);
  raiseOverlay(overlay);
  overlay.on('show', () => raiseOverlay(overlay));
  overlay.webContents.on('did-finish-load', () => raiseOverlay(overlay));
  overlay.loadURL(url);
  overlay.webContents.on('did-fail-load', (_event, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3) return;
    closeOverlay();
    openSetup(`無法打開 ${failedUrl || url}（${desc || code}）`);
  });
  if (setup && !setup.isDestroyed()) setup.close();
}

function toggleQr() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.executeJavaScript(
    'window.__toggleOverlayQr && window.__toggleOverlayQr()'
  ).catch(() => {});
}

function openSetup(errorText) {
  if (setup && !setup.isDestroyed()) {
    setup.focus();
    setup.webContents.send('setup-error', errorText || '');
    return;
  }
  setup = new BrowserWindow({
    width: 520,
    height: 620,
    title: '彈幕疊加',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#16140f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  setup.on('closed', () => { setup = null; });
  setup.webContents.on('did-finish-load', () => {
    if (!setup || setup.isDestroyed()) return;
    const cfg = readConfig();
    const primary = screen.getPrimaryDisplay();
    setup.webContents.send('setup-data', {
      url: cfg.url || process.env.DANMAKU_URL || DEFAULT_URL,
      displayId: cfg.displayId,
      error: errorText || '',
      displays: screen.getAllDisplays().map((display) => ({
        id: display.id,
        width: display.size.width,
        height: display.size.height,
        internal: Boolean(display.internal),
        primary: display.id === primary.id,
      })),
    });
  });
  setup.loadFile(path.join(__dirname, 'setup.html'));
}

function serverOrigin() {
  try {
    return new URL(readConfig().url || process.env.DANMAKU_URL || DEFAULT_URL).origin;
  } catch (err) {
    return 'https://workshop-danmaku-1124.onrender.com';
  }
}

function openConsole() {
  if (consoleWin && !consoleWin.isDestroyed()) {
    consoleWin.show();
    consoleWin.focus();
    return;
  }
  consoleWin = new BrowserWindow({
    width: 420,
    height: 740,
    minWidth: 360,
    minHeight: 560,
    title: '彈幕控制台',
    backgroundColor: '#f4efe4',
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  consoleWin.on('closed', () => { consoleWin = null; });
  consoleWin.loadURL(`${serverOrigin()}/console`);
}

function runOnOverlay(code) {
  if (!overlay || overlay.isDestroyed()) return Promise.resolve(false);
  return overlay.webContents.executeJavaScript(code).then(() => true).catch(() => false);
}

function setLaunchAtLogin(on) {
  const cfg = readConfig();
  cfg.launchAtLogin = Boolean(on);
  writeConfig(cfg);
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: cfg.launchAtLogin });
  }
  if (tray) tray.setContextMenu(buildMenu());
}

function buildMenu() {
  const cfg = readConfig();
  return Menu.buildFromTemplate([
    { label: '控制台', click: openConsole },
    { label: '顯示或隱藏疊加', click: toggleOverlay },
    { label: '顯示或隱藏 QR', click: toggleQr },
    {
      label: '顯示或隱藏彈幕',
      click: () => runOnOverlay('window.__toggleDanmaku && window.__toggleDanmaku()'),
    },
    {
      label: '重新載入',
      click: () => {
        if (overlay && !overlay.isDestroyed()) overlay.webContents.reload();
      },
    },
    { label: '重新設定網址', click: () => openSetup('') },
    { type: 'separator' },
    {
      label: '登入時自動開啟',
      type: 'checkbox',
      checked: Boolean(cfg.launchAtLogin),
      click: (item) => setLaunchAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: '結束', click: () => app.quit() },
  ]);
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('工作坊彈幕');
  tray.setContextMenu(buildMenu());
}

function toggleOverlay() {
  if (!overlay || overlay.isDestroyed()) {
    const cfg = readConfig();
    if (cfg.url) openOverlay(cfg.url, cfg.displayId);
    else openOverlay(DEFAULT_URL, cfg.displayId);
    return;
  }
  if (overlay.isVisible()) overlay.hide();
  else {
    overlay.showInactive();
    raiseOverlay(overlay);
  }
}

function boot() {
  ipcMain.handle('desktop-get-config', () => {
    const cfg = readConfig();
    return {
      url: cfg.url || DEFAULT_URL,
      password: cfg.password || '',
      launchAtLogin: Boolean(cfg.launchAtLogin),
    };
  });

  ipcMain.handle('desktop-save-config', (_event, patch) => {
    const cfg = readConfig();
    const body = patch && typeof patch === 'object' ? patch : {};
    if (typeof body.password === 'string') cfg.password = body.password;
    if (typeof body.url === 'string' && body.url.trim()) {
      try { cfg.url = normalizeUrl(body.url); } catch (err) { /* keep the previous url */ }
    }
    writeConfig(cfg);
    if (tray) tray.setContextMenu(buildMenu());
    return { ok: true, url: cfg.url || DEFAULT_URL };
  });

  ipcMain.handle('overlay-qr', async (_event, on) => {
    const code = typeof on === 'boolean'
      ? `window.__setOverlayQr && window.__setOverlayQr(${on ? 'true' : 'false'})`
      : 'window.__toggleOverlayQr && window.__toggleOverlayQr()';
    return { ok: await runOnOverlay(code) };
  });

  ipcMain.handle('overlay-danmaku', async (_event, on) => {
    const code = typeof on === 'boolean'
      ? `window.__setDanmakuVisible && window.__setDanmakuVisible(${on ? 'true' : 'false'})`
      : 'window.__toggleDanmaku && window.__toggleDanmaku()';
    return { ok: await runOnOverlay(code) };
  });

  ipcMain.handle('save-csv', async (_event, payload) => {
    const text = payload && payload.text != null ? String(payload.text) : '';
    const filename = payload && payload.filename ? String(payload.filename) : 'danmaku.csv';
    const options = {
      defaultPath: filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    };
    const win = BrowserWindow.getFocusedWindow() || consoleWin;
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false };
    fs.writeFileSync(result.filePath, text);
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.on('start-overlay', (event, payload) => {
    try {
      const url = normalizeUrl(payload && payload.url);
      const displayId = payload && payload.displayId;
      writeConfig({ url, displayId });
      openOverlay(url, displayId);
    } catch (err) {
      event.sender.send('setup-error', err.message || '網址不正確');
    }
  });

  app.on('second-instance', () => {
    if (setup && !setup.isDestroyed()) setup.focus();
    else openSetup('');
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    createTray();
    globalShortcut.register('CommandOrControl+Shift+H', toggleOverlay);
    globalShortcut.register('CommandOrControl+Shift+J', toggleQr);
    globalShortcut.register('CommandOrControl+Shift+C', openConsole);
    globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      if (overlay && !overlay.isDestroyed()) overlay.webContents.reload();
    });

    const cfg = readConfig();
    if (cfg.launchAtLogin) setLaunchAtLogin(true);
    if (process.env.DANMAKU_URL) {
      try {
        openOverlay(normalizeUrl(process.env.DANMAKU_URL), cfg.displayId);
      } catch (err) {
        openSetup(err.message);
      }
    } else {
      openOverlay(cfg.url || DEFAULT_URL, cfg.displayId);
    }
    if (!readConfig().password) openConsole();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    // Stay in the menu bar until 結束.
  });
}
