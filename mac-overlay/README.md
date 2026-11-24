# 工作坊彈幕（Mac）

雙擊就能開的小工具。透明、點擊穿透的彈幕層浮在 PowerPoint 或 Keynote 上面。另外有一個可以點的控制台視窗。

伺服器預設是 `https://workshop-danmaku-1124.onrender.com`。網址和主持人密碼存在這台 Mac，下次打開會自己連上。

## 安裝

1. 到 GitHub 這個專案的 **Releases** 下載 `.dmg`（標籤是 `v1.0.` 加上該次建置號碼）。
2. 打開 dmg，把 **工作坊彈幕** 拖到「應用程式」。
3. 第一次打開：在「應用程式」裡對 **工作坊彈幕** 按右鍵，選 **打開**，再按一次 **打開**。這個 app 沒有簽署。
4. 若 macOS 說應用程式已損毀，在終端機執行：

```bash
xattr -cr /Applications/工作坊彈幕.app
```

5. 第一次會打開控制台，輸入 `HOST_PASSWORD`。之後會記住，疊加層會自動連上伺服器。

從原始碼開（開發用）：

```bash
cd mac-overlay
npm install
npm start
```

## 控制台

選單列的 **控制台**，或按 `Command Shift C`。

- **暫停互動 / 開放互動**：暫停時伺服器拒絕新留言，手機顯示「主持人暫時關閉互動」。已經在畫面上飛的字不會停。這和投影頁的「暫停」（把動畫凍住）是兩件事。
- **清空畫面**
- **隱藏彈幕層 / 顯示彈幕層**
- **隱藏 QR / 顯示 QR**
- **過濾詞**：加入一個詞
- **匯出留言 CSV**：要有主持人密碼。檔案是 UTF-8、帶 BOM，Excel 才不會把中文讀亂。每一列有台北時間、狀態（accepted 或 blocked）、文字、顏色、字級、動畫、匿名的瀏覽器 id。
- 畫面上有在線人數和最近的留言。

留言紀錄只放在伺服器記憶體。重新啟動、重新部署，或 Render 休眠醒來之後，紀錄會清空。要留檔就在關掉之前按 **匯出留言 CSV**。

選單列的 **登入時自動開啟** 預設是關的。

| 快捷鍵 | 作用 |
| --- | --- |
| Command Shift C | 打開控制台 |
| Command Shift H | 顯示或隱藏整個疊加 |
| Command Shift J | 顯示或隱藏 QR |
| Command Shift R | 重新載入疊加 |
| Command Shift Q | 結束 |

視窗使用 `screen-saver` 層級，`visibleOnFullScreen`，並且隱藏 Dock 圖示。Keynote 自己的全螢幕空間仍可能把疊加藏住。比較穩的做法是把簡報視窗最大化。

## 自己打包

要在 Mac 上做，成品未簽署。GitHub Actions（`.github/workflows/mac-app.yml`）會在 push 到 `main` 時做同樣的事：universal `.dmg`，以及 arm64 和 x64 的 `.zip`，並發到 Releases。

```bash
cd mac-overlay
npm install
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:dmg
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:zip
```
