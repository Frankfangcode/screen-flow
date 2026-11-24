'use strict';

// Transparent, click-through, always-on-top window.
// It loads /screen?overlay=1 so only danmaku is drawn over Keynote or PowerPoint.
// Quit from the menu-bar icon, or press Command+Shift+Q.

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setFullScreenable(false);
  overlay.loadURL(url);
  overlay.webContents.on('did-fail-load', (_event, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3) return;
    closeOverlay();
    openSetup(`無法打開 ${failedUrl || url}（${desc || code}）`);
  });
  if (setup && !setup.isDestroyed()) setup.close();
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
      url: cfg.url || process.env.DANMAKU_URL || 'http://127.0.0.1:4721/screen?overlay=1',
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

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('彈幕疊加');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '顯示或隱藏', click: toggleOverlay },
    {
      label: '重新載入',
      click: () => {
        if (overlay && !overlay.isDestroyed()) overlay.webContents.reload();
      },
    },
    { label: '重新設定網址', click: () => openSetup('') },
    { type: 'separator' },
    { label: '結束', click: () => app.quit() },
  ]));
}

function toggleOverlay() {
  if (!overlay || overlay.isDestroyed()) {
    const cfg = readConfig();
    if (cfg.url) openOverlay(cfg.url, cfg.displayId);
    else openSetup('');
    return;
  }
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive();
}

function boot() {
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
    globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      if (overlay && !overlay.isDestroyed()) overlay.webContents.reload();
    });

    const cfg = readConfig();
    if (process.env.DANMAKU_URL) {
      try {
        openOverlay(normalizeUrl(process.env.DANMAKU_URL), cfg.displayId);
        return;
      } catch (err) {
        openSetup(err.message);
        return;
      }
    }
    if (cfg.url) openOverlay(cfg.url, cfg.displayId);
    else openSetup('');
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    // Stay in the menu bar until 結束.
  });
}
