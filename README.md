# Tampermonkey Scripts

個人維護的 Tampermonkey Userscripts。這是公開原始碼儲存庫，不是個人資料或瀏覽器設定的備份空間。

## 專案

- `scripts/threads-video-downloader.user.js`：Threads 圖片及影片下載按鈕，改寫自 Manolo Zocco 的 MIT 授權腳本。
- 上游來源：https://greasyfork.org/zh-TW/scripts/526791-threads-video-downloader
- 原作者：Manolo Zocco / P0L1T3。請保留原作者資訊與 MIT 授權。

## 隱私與安全原則

1. 不提交密碼、Cookie、Session、Token、API Key、個人紀錄、HAR、真實瀏覽器匯出資料。
2. 僅允許腳本執行於需要的 Threads 網域；禁止 `@match *://*/*`。
3. 不載入第三方 `@require`、遠端程式碼、分析或追蹤服務。
4. 不主動讀取、蒐集或附加登入 Cookie。使用者點擊下載按鈕時僅對允許的 Threads 媒體主機發起請求；瀏覽器可能依既有規則自動附帶該主機的 Cookie。
5. v2 Beta 在 `GM_download` 失敗後才嘗試使用 `GM_xmlhttpRequest` 備援，僅對 Threads／Meta 媒體網域連線。禁止 `@connect *`，權限異動必須在 PR 說明。
6. 所有功能修改走 Pull Request；確認程式碼與瀏覽器實測後才合併至 `main`。
7. 自動更新只追蹤 `main`；沒有經過檢查的分支不得作為更新來源。
8. GitHub Public Repository 的提交者資訊和歷史是公開的。請使用 GitHub noreply 提交信箱。

詳細規範請見 [SECURITY.md](SECURITY.md)。

## 安裝

目前可直接安裝尚未經 Chrome 實際測試的 v2.0.0-beta.2（只適合測試，腳本內已停用自動更新）：

**Beta 2 故障排查：** 開啟 threads.com 並重新整理，頁面右下角應顯示「Threads DL · Beta 2」；若沒有，先到 Tampermonkey Dashboard 確認腳本已安裝並啟用。單純打開 raw 程式碼連結不等於安裝。若已安裝 Beta 1，需重新由此連結手動安裝 Beta 2（此階段沒有自動更新）。滑鼠移到貼文的影片或大型圖片上，才會浮現 Download 按鈕。

https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/refs/heads/feat/threads-downloader-privacy-first/scripts/threads-video-downloader.user.js

在版本完成瀏覽器實測且 PR 合併後，再從 `main` 分支取得正式版：

https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/main/scripts/threads-video-downloader.user.js

注意：測試版位於獨立分支，尚未宣告可供日常使用。安裝新版前請先停用原本 Greasy Fork 的同功能腳本，以免按鈕重複出現。

## 更新機制

- Tampermonkey 使用 `@version` 檢查新版。
- Beta 的 `@updateURL` 與 `@downloadURL` 設為 `none`，不會自動安裝任何後續版本。
- 正式版經驗證後，才將 `@updateURL` 與 `@downloadURL` 指向上述 `main` 正式版。
- 發布前需通過程式碼權限檢查與手動下載測試。
- 建議初期只開啟更新檢查，不開啟自動安裝。

## 限制

此專案目前尚未在使用者的 Chrome / Tampermonkey 環境實測，尤其需確認 Threads 動態載入的影片來源與瀏覽器下載權限。不能僅憑程式碼審查保證在所有貼文有效。
