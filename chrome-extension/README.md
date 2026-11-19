# YouTube Slides Extractor — Chrome Extension v0.3.2 (Cloud Alpha)

## 安裝與連接

1. 下載此分支 ZIP，解壓縮。停用舊 Tampermonkey 腳本（不要移除資料）。
2. 此測試版已內建專案 OAuth Client ID，不需要 setup.html 或個別設定。Chrome 的 chrome://extensions → 開發人員模式 → 載入未封裝項目 → 選 chrome-extension 資料夾。
3. 如果已載入舊 Alpha，直接覆蓋原擴充套件資料夾中的檔案並按重新載入；不要卸載以免清除離線資料。
4. 點擴充套件圖示或 YouTube 面板「Google Drive 設定」。新資料夾模式僅請求 drive.file；既有資料夾模式需完整 Drive scope 並輸入專用 YouTube Slides 資料夾的網址。Google Auth Platform 應設定相關 scope 及測試使用者。
5. 授權後重整 YouTube，點歷史紀錄的「更新索引」。

固定擴充套件 ID：kbghnfojpidgmkfmjnajikpnhgcpphan

## v0.3.2
- 簡化登入畫面與 Google Drive 同步儀表板，提供綁定資料夾連結、待同步數量、最近成功上傳時間、連線檢查及重新授權。
- YouTube 面板顯示待同步數量；狀態只在面板開啟時定期讀取本機資料庫，不會因此讀取雲端圖片。
- 新增手動檢查 GitHub 版本：僅在主動點擊時請求選用的 GitHub 讀取權限，下載更新仍須覆蓋原資料夾並重新載入。
- 既有 OAuth Client ID、固定擴充套件 ID、資料庫及綁定設定不變。

## Alpha 限制
- v0.3.1 已由使用者回報成功登入與同步；v0.3.2 尚待實際 Chrome 端驗證。
- 不會移動或刪除舊版 Drive PNG。刪除功能暫停。
- 本機離線擷取不需要 OAuth；同步需 Google 帳號授權，測試版需列為測試使用者。離線待上傳 PNG 保存在擴充套件 IndexedDB；成功上傳後本機備份仍保留，可能占用磁碟。雲端既有圖片需連線讀取，非全量離線副本。
- 單張傳輸上限 24 MiB（超過須匯出 ZIP）。卸載擴充套件之前請先確定同步完成／匯出備份；同一安裝綁定一個帳號與資料夾。
- 部分歷史索引可能保留在 Drive 外部刪除的項目，以免默默遺失資料。跨裝置索引請按「更新索引」。
- Chrome OAuth token 留在 service worker，沒有外部伺服器。不需 Google Drive 桌面 App、n8n 或 Google Client Secret。不應把 Client Secret 或 token 放進 GitHub。
- Google Cloud 外部 Testing 應用可能需要重新授權。這是未上架的私人測試版本。
