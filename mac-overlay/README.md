# 彈幕疊加（Mac）

透明、點擊穿透、永遠在最上層的小工具。彈幕和角落的加入 QR 會浮在 PowerPoint 或 Keynote 上面。

預設連到 `https://workshop-danmaku-1124.onrender.com/screen?overlay=1`。

## 使用方式

1. 確認彈幕伺服器有回應：打開 <https://workshop-danmaku-1124.onrender.com/health>，看到 `ok` 即可。
2. 在投影機那台 Mac 上：

```bash
cd mac-overlay
npm install
npm start
```

3. 設定視窗裡的網址已經填好。選外接螢幕（投影機），按 **開始疊加**。
4. 右下角會出現加入用的 QR code。選單列的圖示，或按 `Command Shift J`，可以把它藏起來或再顯示。
5. 簡報筆和點擊會穿過這層，直接進 Keynote 或 PowerPoint。
6. 結束：選單列 → **結束**，或按 `Command Shift Q`。

| 快捷鍵 | 作用 |
| --- | --- |
| Command Shift H | 顯示或隱藏整個疊加 |
| Command Shift J | 顯示或隱藏 QR |
| Command Shift R | 重新載入 |
| Command Shift Q | 結束 |

視窗使用 `screen-saver` 層級，`visibleOnFullScreen`，並且隱藏 Dock 圖示，盡量蓋在播放中的簡報上。Keynote 若佔用獨立的全螢幕空間，macOS 仍可能把其他空間的視窗藏住。比較穩的做法是把簡報視窗最大化，不要進 Keynote 自己的全螢幕。

打包（要在 Mac 上做，成品未簽署）：

```bash
npm run dist
```

Gatekeeper 擋下時，對 app 按右鍵選「打開」。

Build and usage in English are also in the repository README.
