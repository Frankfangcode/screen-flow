# 工作坊彈幕

Live danmaku for a university workshop. Phones send short comments; the projector shows them flying over slides. One Node process, nothing stored on disk except the sample PDF. Restarting clears messages, the uploaded deck, pause, and filter edits.

UI copy is Traditional Chinese (Taiwan).

## Run it tonight

Campus Wi-Fi often blocks phone-to-laptop traffic. If a phone cannot open the address printed below, use [Render](#deploy-on-render) (phones only need internet) or put the laptop on a phone hotspot.

1. Install Node.js 20 or newer.
2. In this folder:

```bash
npm install
export HOST_PASSWORD='pick-a-long-password'
export ROOM_CODE='1124'          # optional, this is the default
npm start
```

3. The log prints a screen URL. On the projector laptop open the `lan` one, for example `http://192.168.1.20:4721/screen`.
4. Click **主持控制**, enter `HOST_PASSWORD`, then leave the QR code up while people join.
5. Phones scan the QR code. It opens `/?room=1124`. They type a message (50 characters), pick size, color, and motion, or tap an emoji.
6. After the room has joined, switch QR to **角落** or **隱藏** so the slides show.
7. Arrow keys, Page Up / Page Down, or a presentation clicker change built-in slides and PDF pages. Those keys work only after the host password is unlocked. Press `H` to open or close the host panel.

`http://127.0.0.1:4721/health` should return `{"ok":true,...}`.

Copy `.env.example` to `.env` if you would rather not export variables. Do not commit `.env`.

## What the screen can show

- **內建投影片** — three waiting slides, the default.
- **範例 PDF** — a three-page PDF drawn with pdf.js, so you can confirm page turns before the real deck is ready.
- **上傳 PDF** — one PDF, up to 12MB, kept in memory. No password-protected files. Arrow keys and clickers change pages.
- **嵌入網址** — any `http` or `https` page in an iframe. A Google Slides edit or publish link is rewritten to the embed URL. The Slides file has to be viewable by anyone with the link. If the frame is blank, that site refuses to be embedded.

Danmaku sits on top of all of these. `/screen?overlay=1` hides the slides, QR, and controls and uses a transparent background for the Mac overlay.

## Motions and limits

Each comment is one of: 由右至左, 上方停留, 下方停留, 向上飄, 彈跳. Sizes are 小 / 中 / 大. Eight colors.

- One comment per browser every 3 seconds.
- One emoji (👍 😂 ❤️ 🔥 👏 🤯) every 1.5 seconds. Emoji float up; they are not attached to a comment.
- At most 20 comments and 30 emoji per second for the whole room, so a script cannot fill the frame.
- The host can pause (new items are rejected and what is already on screen freezes), clear, move the QR code, and edit the word list.
- The filter is a word list, Chinese and English, case-insensitive. Spaces and fullwidth letters are folded (`ｆｕｃｋ`, `f u c k`). It is not context-aware. 靠北 is intentionally not in the default list. Add or remove lines in the host panel.

The limit follows a browser id in `localStorage`. Clearing site data starts a new id. There is no per-IP limit, because a whole classroom often shares one address.

## Deploy on Render

The service is a single free Web Service. WebSockets work on Render web services; Socket.IO uses WebSocket and falls back to HTTP long-polling. The page also sends a heartbeat every 45 seconds. An open projector tab counts as incoming traffic, which keeps a free instance from spinning down (free instances sleep after 15 minutes with no HTTP request and no incoming WebSocket message).

1. Push this repository to GitHub or GitLab.
2. In the [Render dashboard](https://dashboard.render.com/), choose **New → Blueprint**.
3. Connect the repository. Render reads `render.yaml` (Node, `npm install`, `npm start`, health check `/health`, plan `free`).
4. When asked for `HOST_PASSWORD`, enter a long password. `ROOM_CODE` is already `1124`; change it in the dashboard if you want.
5. Deploy. The first build takes a few minutes. Open `https://<your-service>.onrender.com/health` and wait until it returns JSON. A cold start after sleep is about a minute, and Render shows its own loading page during that minute.
6. Open `https://<your-service>.onrender.com/screen` on the projector **by 17:15** and leave it open. Unlock the host panel. Upload the PDF or paste the Slides URL after the instance is awake — a spin-down or a new deploy wipes that memory.
7. The QR code uses the Render hostname, so phones do not need to be on the same Wi-Fi.

If the `workshop-danmaku` hostname is taken, change `name` in `render.yaml` and redeploy the blueprint.

Optional: set `PUBLIC_URL` to `https://<your-service>.onrender.com` (no trailing slash) if the QR code ever shows an internal host. You normally do not need it; the server uses `X-Forwarded-Host` and `X-Forwarded-Proto`.

## Mac overlay

A small Electron app in `mac-overlay/` opens a transparent, click-through, always-on-top window over Keynote or PowerPoint and loads `/screen?overlay=1`.

Build the `.dmg` on a Mac. This repository cannot produce a signed Mac disk image from Linux, and the app is not notarized. Gatekeeper will warn.

On the projector Mac:

```bash
cd mac-overlay
npm install
npm start
```

Paste the server address (`http://127.0.0.1:4721/screen?overlay=1` or the Render URL). Pick the projector display if there is more than one. **開始疊加**.

The window does not take clicks, so Keynote keeps the clicker. A menu-bar icon (the amber-bar template) can hide, reload, change the URL, or quit.

| Shortcut | Action |
| --- | --- |
| Command Shift H | Show or hide |
| Command Shift R | Reload |
| Command Shift Q | Quit |

Pack a disk image on that Mac:

```bash
cd mac-overlay
npm install
npm run dist
```

`dist/` will contain `Danmaku Overlay-1.0.0.dmg` (unsigned). If Gatekeeper blocks it: right-click the app, choose **Open**, or run `xattr -dr com.apple.quarantine "/Applications/Danmaku Overlay.app"`.

macOS fullscreen spaces are a separate desktop. Keynote’s own fullscreen mode can hide an always-on-top window from another Space. Prefer a maximized window on the projector display, or the browser fallback below. `visibleOnFullScreen` is set, and it still is not reliable for every fullscreen app.

## No-install fallback

Skip Electron. On the projector Mac, open Chrome and put the danmaku on a second display:

1. Start the server (local or Render).
2. Open `http://<host>:4721/screen` and drag that window to the projector display.
3. Enter the host password. Upload the PDF or paste the Slides embed if the slides live in the browser. Or, if Keynote is already on that display, open `/screen?overlay=1` instead so the page background is clear.
4. Fullscreen that window (Control-Command-F, or View → Enter Full Screen).

A browser window is not click-through. Use a second display, or run the slides inside this page (PDF or embedded URL) and do not put Keynote underneath the same window. `/screen?overlay=1` in a browser is transparent only where the page paints nothing; the window itself still catches clicks.

## Checks

```bash
npm test
```

`scripts/simulate.js` boots the server on port 4733 and checks health, the QR payload, all five motions, emoji, the word filter, both rate limits, pause, clear, QR modes, Google Slides rewriting, and PDF upload. `node scripts/simulate.js --live` keeps sending sample comments at `http://127.0.0.1:4721` for a visual check.

## 現場流程

1. 17:15 打開投影網址 `/screen`，輸入主持人密碼。
2. QR code 用「置中」，等大家掃。掃不到就請他們打開網址、輸入房間代碼（預設 `1124`）。
3. 人到齊後改「角落」或「隱藏」。
4. 投影片用內建、上傳 PDF，或貼 Google 簡報連結。方向鍵或簡報筆換頁。
5. 需要暫停就按「暫停」。清掉畫面上的字按「清除彈幕」。
6. 敏感詞一行一個，儲存後立刻生效。

## Limitations

- Memory only. A restart, a Render spin-down, or a new deploy drops comments, the uploaded PDF, pause, QR mode, and filter edits. Leave `/screen` open so the free instance stays awake, and set the deck after 17:15.
- Render’s free instance sleeps after 15 idle minutes and takes about a minute to wake. The first visitor sees Render’s loading page. Free hours are capped per workspace per month.
- One room per process. The room code is not a secret; it is on the projector. The host password is the only control.
- The per-person limit is a browser id. Someone who clears site data, or opens a private window, gets a new 3-second window. A global cap still protects the screen.
- The word filter is a list, not a moderator. Short words can false-positive; unusual spellings can slip through.
- PDF text is rendered by pdf.js in the projector browser. Password-protected PDFs fail. Very large image-heavy decks may be tight on a 512MB free instance because the file is held in memory (the cap is 12MB).
- Many websites send `X-Frame-Options` and will not appear in the iframe. Google Slides embed links work when the deck is shared.
- The Mac overlay is unsigned, Mac-only, and can lose to a native fullscreen Space. The `.dmg` has to be built on macOS (`npm run dist` in `mac-overlay`). There is no notarization.
- Comments are anonymous and public on the projector. They are not a private channel.
