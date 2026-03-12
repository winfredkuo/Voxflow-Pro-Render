# VoxFlow Pro - AI 語音轉錄與翻譯系統

VoxFlow Pro 是一個專業級的 AI 語音轉錄與翻譯生態系統，結合了 OpenAI Whisper 的高精度辨識能力與 Google Gemini 的專業翻譯引擎。

## 🚀 核心功能

- **V1 Stable**: 使用 OpenAI Whisper 進行極速、精準的單語轉錄，生成標準 SRT 字幕。
- **V3 Bilingual**: 雙語轉錄模式。先由 Whisper 進行語音辨識，再由 Gemini 進行專業翻譯，一鍵生成原文與譯文兩份 SRT 檔案。
- **無縫字幕銜接 (Gapless)**: 自動優化時間碼，確保字幕在播放時流暢連續，無明顯間斷。
- **專業級翻譯**: 利用 Gemini 3 系列模型進行上下文感知的翻譯，確保譯文「信、雅、達」。
- **額度管理系統**: 整合 Firebase Auth 與 Firestore，實現基於分鐘數的額度扣除與管理。
- **Cloudflare Worker 支援**: 支援透過自定義 Base URL 呼叫 OpenAI API，增強安全性與靈活性。

## 🛠️ 技術棧

- **Frontend**: React 19, Tailwind CSS, Lucide React, Motion.
- **Backend**: Express (Node.js), Multer (檔案處理).
- **AI Models**: 
  - OpenAI Whisper (語音辨識)
  - Google Gemini 3 (翻譯與邏輯處理)
- **Database/Auth**: Firebase (Authentication, Firestore).

## ⚙️ 環境設定

請在專案根目錄建立 `.env` 檔案，並參考以下設定：

```env
# Google Gemini API Key
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# OpenAI API Key (可選，若使用代理則可不填)
OPENAI_API_KEY="YOUR_OPENAI_API_KEY"

# OpenAI Base URL (選填，用於 Cloudflare Worker 代理)
# 預設: https://winfred-api-gpt.theoder.workers.dev/v1
OPENAI_BASE_URL="https://your-proxy-url.com/v1"

# Firebase Config (請從 Firebase Console 獲取)
VITE_FIREBASE_API_KEY="..."
VITE_FIREBASE_AUTH_DOMAIN="..."
VITE_FIREBASE_PROJECT_ID="..."
VITE_FIREBASE_STORAGE_BUCKET="..."
VITE_FIREBASE_MESSAGING_SENDER_ID="..."
VITE_FIREBASE_APP_ID="..."
```

## 📦 安裝與啟動

1. 安裝依賴：
   ```bash
   npm install
   ```

2. 啟動開發伺服器：
   ```bash
   npm run dev
   ```

3. 建置生產版本：
   ```bash
   npm run build
   ```

## 📝 授權

© 2024 VoxFlow Pro Lab • Professional Transcription Ecosystem
