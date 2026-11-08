# Threads.net Media Downloader v5 (Maintained Beta)

本專案是 Threads.net Media Downloader v5 的獨立維護測試版。
原始腳本：https://greasyfork.org/en/scripts/508541-threads-net-media-downloader-v5
原作者（腳本標示）：StevenJon0826；Greasy Fork 發布者：d1 shakeyou；授權：MIT。
與 Manolo Zocco 的 Threads Video Downloader 不同。先前誤用的草稿已從本 PR 移除。

## 目前測試版
- 版本：5.1.0-beta.6
- 安裝網址：https://raw.githubusercontent.com/kevinsmemo/tampermonkey-scripts/refs/heads/feat/threads-downloader-privacy-first/scripts/threads-net-media-downloader-v5.user.js
- Pull Request：https://github.com/kevinsmemo/tampermonkey-scripts/pull/1
- 每則貼文常駐一個灰色 Download 按鈕，位置保留在標頭「⋯」右側。Beta 4 改用緊湊自適應大小，不再硬設最小寬 132px、高 40px、字體 18px；保留貼文內定位，按實際按鈕寬度調整「⋯」的位置。
- 點擊後依序下載該貼文目前可辨識的所有圖片與直接影片。
- 預設不自動按讚、不自動開啟劇透；不使用外部下載站、外部程式碼、追蹤或分析。
- 不使用 GM_xmlhttpRequest，不使用 @connect *。
- 測試版不自動更新。@updateURL 與 @downloadURL 設為 none。

## 安裝
1. 在 Tampermonkey 停用既有的 Threads.net Media Downloader v5 與先前錯誤的 Threads Video Downloader (Privacy-Focused Fork)。
2. 點擊上述安裝網址；若只顯示原始碼，請在 Tampermonkey 的 Utilities / Install from URL 貼上連結。
3. 開啟 https://www.threads.com/ 並重新整理，確認每則貼文右上方的 Download。
4. 先測公開單圖，再測多圖、影片；可能需要同意瀏覽器的多檔下載權限。
5. 如果看不到按鈕，先確認腳本已啟用，Console 應出現 [Threads v5 Maintained] 5.1.0-beta.6 loaded。

## Copy as image 截圖排除
- Beta 5：使用 Threads 分享選單的 Copy as image 時，在原生截圖動作發生前暫時移除所有 Download 按鈕，避免被截進圖片；預覽關閉後再恢復。
- 避免在 role=dialog 的預覽視窗內注入下載按鈕。僅在分享截圖流程觸發，不更改一般貼文 Download 的尺寸或位置。
- 支援滑鼠與鍵盤觸發。若沒有開啟預覽，15 秒後自動復原。
- 目前為靜態檢查通過，實際 Copy as image 截圖仍須於 Threads 瀏覽器實測。

## 多影片輪播修復（Beta 6）
- 舊版只在單一影片時嘗試結構化影片備援；新版依貼文短碼精準配對 carousel_media，逐筆選擇影片的合適 MP4 來源，保留原始輪播順序。
- 當目前頁面只有輪播中正在顯示的部分影片時，使用者按下 Download 後，可再以同源 GET 讀取該貼文頁面所提供的完整媒體資料；沒有引入第三方下載網站或額外 Tampermonkey 權限。
- 過濾其他貼文的媒體、去除重複影音網址；影片若只有 blob: 或 m3u8 串流且缺乏可直接下載的 HTTPS MP4，仍可能部分失敗，介面會顯示部分完成或失敗。
- 已完成 6 組靜態／合成資料檢查（包含兩支影片、三支影片與圖片混合、內層 carousel_media、單片、串流不足、貼文隔離），但仍需在 Threads 實際輪播貼文確認。

## 本次修復
- Beta 3：修正 Beta 2 在較窄 Threads 欄位時，Download 被放在「⋯」右方卻遭到頁面裁切的問題。按鈕不再參與標頭一般排版，改採貼文內定位；同時保留「⋯」位於 Download 左側的順序。

- Beta 4：撤銷之前自行放大的按鈕尺寸，改用較小字體與自適應寬高；新版仍需於實際瀏覽器驗證外觀。

## 已知限制
- 尚未通過 Chrome / Threads 的端到端實測。網站 DOM 改版可能造成特定貼文不顯示按鈕或漏抓媒體。
- 如果影片只有 blob:、HLS 或 DASH 等串流、且沒有安全可辨識的 HTTPS 直連，將顯示影片無法下載；不會把封面冒充影片。
- 動態輪播、引用貼文、私人內容可能無法完整下載；不承諾涵蓋所有影片格式。
- 檔名：Threads-帳號-YYYYMMDD_HHMMSS-序號.副檔名。
- 不要在公開 repository 上傳私人貼文、Cookie、Token、HAR 或任何登入資訊。

## 後續維護
正式版需經瀏覽器回歸測試後才能合併到 main，並開啟受控更新；安全規範見 SECURITY.md。