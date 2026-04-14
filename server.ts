import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import OpenAI from "openai";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as OpenCC from 'opencc-js';
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenCC converter (Simplified to Taiwan Traditional)
const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

function translateToTraditionalChinese(segments: any[]) {
  if (segments.length === 0) return segments;
  
  return segments.map(seg => ({
    ...seg,
    text: converter(seg.text)
  }));
}

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

const upload = multer({ dest: "uploads/" });

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  let baseURL = process.env.OPENAI_BASE_URL?.trim();
  
  // 只有當 Base URL 是原本那個失效的預設 Worker 時，才進行自動修正
  const isOldDefaultWorker = baseURL && (baseURL.includes('winfred-api-gpt.theoder.workers.dev') || baseURL.includes('voxflow-proxy.theoder.workers.dev'));
  
  if (apiKey && (!baseURL || isOldDefaultWorker)) {
    baseURL = undefined; // 使用官方 OpenAI API
  } else if (!apiKey && !baseURL) {
    baseURL = "https://voxflow-proxy.theoder.workers.dev/v1";
  }
  
  const finalApiKey = apiKey || "dummy-key-for-proxy";
  
  if (baseURL && !baseURL.startsWith('http')) {
    baseURL = `https://${baseURL}`;
  }
  
  if (baseURL && baseURL.endsWith('/')) {
    baseURL = baseURL.slice(0, -1);
  }

  console.log(`[OpenAI Init] baseURL: "${baseURL || "official"}"`);

  return new OpenAI({
    apiKey: finalApiKey,
    baseURL: baseURL,
  });
}

async function startServer() {
  // API routes
  app.get("/api/health", (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const envBaseUrl = process.env.OPENAI_BASE_URL?.trim();
    const isOldDefaultWorker = envBaseUrl && (envBaseUrl.includes('winfred-api-gpt.theoder.workers.dev') || envBaseUrl.includes('voxflow-proxy.theoder.workers.dev'));
    
    let actualBaseUrl = envBaseUrl || "official";
    if (apiKey && (!envBaseUrl || isOldDefaultWorker)) {
      actualBaseUrl = "official (overridden)";
    }

    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      hasApiKey: !!apiKey,
      envBaseUrl: envBaseUrl || "not set",
      actualBaseUrl: actualBaseUrl
    });
  });

  app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
    const openai = getOpenAIClient();
    console.log(`[${new Date().toISOString()}] Transcription Request. Client baseURL: ${openai.baseURL}`);
    console.log(`[Headers]`, JSON.stringify(req.headers, null, 2));
    
    try {
      if (!req.file) {
        console.error("No file in request");
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log(`Processing file: ${req.file.originalname}, size: ${req.file.size}`);

      // Multer saves files without extensions. OpenAI Whisper requires an extension to recognize the format.
      const ext = path.extname(req.file.originalname) || ".mp3";
      const filePathWithExt = `${req.file.path}${ext}`;
      fs.renameSync(req.file.path, filePathWithExt);

      const { language } = req.body;

      const openai = getOpenAIClient();
      const options: any = {
        file: fs.createReadStream(filePathWithExt),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["segment", "word"], // 請求字級時間戳
      };

      if (language && language !== 'auto') {
        options.language = language;
      }

      const transcription = await openai.audio.transcriptions.create(options);
      const detectedLanguage = (transcription as any).language;

      // Clean up uploaded file
      if (fs.existsSync(filePathWithExt)) {
        fs.unlinkSync(filePathWithExt);
      }

      // 處理斷句邏輯：如果一段超過 15 個字，根據字級時間戳進行精確切分
      const rawSegments = (transcription as any).segments || [];
      const processedSegments: any[] = [];

      rawSegments.forEach((seg: any) => {
        const text = seg.text.trim();
        // 如果字數超過 15 個字且有字級資料，進行切分
        if (text.length > 15 && seg.words && seg.words.length > 0) {
          let currentWords: any[] = [];
          let currentLength = 0;

          seg.words.forEach((wordObj: any) => {
            const wordText = wordObj.word;
            // 判斷加入這個字後是否超過 15 字
            if (currentLength + wordText.length > 15 && currentWords.length > 0) {
              // 儲存當前累積的片段
              processedSegments.push({
                start: currentWords[0].start,
                end: currentWords[currentWords.length - 1].end,
                text: currentWords.map(w => w.word).join('').trim()
              });
              // 重置累積器
              currentWords = [wordObj];
              currentLength = wordText.length;
            } else {
              currentWords.push(wordObj);
              currentLength += wordText.length;
            }
          });

          // 處理最後剩下的字
          if (currentWords.length > 0) {
            processedSegments.push({
              start: currentWords[0].start,
              end: currentWords[currentWords.length - 1].end,
              text: currentWords.map(w => w.word).join('').trim()
            });
          }
        } else {
          // 不超過 15 字，直接加入
          processedSegments.push({
            start: seg.start,
            end: seg.end,
            text: text
          });
        }
      });

      // 只有當偵測到是中文 (chinese) 時才進行繁體轉換
      const finalSegments = (detectedLanguage === 'chinese') 
        ? translateToTraditionalChinese(processedSegments)
        : processedSegments;

      res.json(finalSegments);
    } catch (error: any) {
      console.error("Full Transcription Error Object:", JSON.stringify(error, null, 2));
      console.error("Transcription error stack:", error.stack);
      
      const status = error.status || 500;
      const message = error.message || "Transcription failed";
      const details = error.response?.data || error.cause || null;
      
      res.status(status).json({ 
        error: message,
        details: details,
        status: status,
        source: "OpenAI SDK",
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  app.post("/api/translate", express.json(), async (req, res) => {
    const { segments, targetLang } = req.body;
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    let baseURL = process.env.GEMINI_BASE_URL?.trim();

    // 僅記錄日誌，不再強制擋住，讓 API 自己報錯或通過
    console.log(`[Gemini] Using API Key starting with: ${apiKey?.substring(0, 4)}... length: ${apiKey?.length}`);
    if (baseURL) console.log(`[Gemini] Using Proxy Base URL: ${baseURL}`);

    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: "無效的片段資料" });
    }

    // 處理 Base URL 格式
    if (baseURL) {
      // 確保有 https://
      if (!baseURL.startsWith('http')) {
        baseURL = `https://${baseURL}`;
      }
      // 徹底移除結尾的所有斜線和版本號，讓 SDK 自己處理路徑
      baseURL = baseURL.trim().replace(/\/+$/, '');
      baseURL = baseURL.replace(/\/(v1|v1beta)$/, '');
    }

    if (!apiKey) {
      return res.status(500).json({ error: "伺服器未設定 GEMINI_API_KEY。請在 Secrets 面板中設定。" });
    }

    try {
      // 確保原文也是繁體
      const originalWithTraditional = segments.map(seg => ({
        ...seg,
        text: converter(seg.text || '')
      }));

      const promptText = `你是一位專業的影視字幕翻譯師。以下是音訊的轉錄內容。
請將每一段內容翻譯為 ${targetLang}。

要求：
1. 保持結構：回傳 JSON 陣列，包含 start, end, original, translated 欄位。
2. original 欄位請填入我提供的文字。
3. translated 欄位請填入翻譯後的 ${targetLang}。
4. 如果目標語言是繁體中文，請務必使用台灣用語。

轉錄內容：
${JSON.stringify(originalWithTraditional.map(s => ({ start: s.start, end: s.end, text: s.text })), null, 2)}`;

      // 直接使用 axios 呼叫 Proxy，避免 SDK 的路徑問題
      const proxyUrl = baseURL || 'https://generativelanguage.googleapis.com';
      
      // 如果是佔位符且有 Proxy，就不在網址帶 Key，交給 Proxy 處理
      const isPlaceholder = apiKey === "MY_GEMINI_API_KEY" || apiKey === "\"MY_GEMINI_API_KEY\"";
      const finalUrl = (isPlaceholder && baseURL) 
        ? `${proxyUrl}/v1beta/models/gemini-1.5-flash:generateContent`
        : `${proxyUrl}/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

      console.log(`[Gemini] Requesting: ${finalUrl.split('?')[0]}`);

      const response = await axios.post(finalUrl, {
        contents: [{ parts: [{ text: promptText }] }]
      }, {
        headers: { 
          'Content-Type': 'application/json',
          // 如果不是佔位符，也帶上 Header
          ...(isPlaceholder ? {} : { 'x-goog-api-key': apiKey })
        },
        validateStatus: () => true // 讓 axios 不要直接拋出錯誤，我們自己處理
      });

      if (response.status !== 200) {
        console.error("[Gemini] API Error:", response.status, JSON.stringify(response.data));
        return res.status(response.status).json({ 
          error: `Google API 錯誤 (${response.status})`,
          details: response.data 
        });
      }

      const responseData = response.data;
      const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      if (!text) throw new Error("Gemini 未回傳內容");

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("無法解析 JSON 結果");

      let translatedSegments = JSON.parse(jsonMatch[0]);
      
      // 如果目標語言是繁體中文，最後再跑一次 OpenCC 確保譯文也是台灣繁體
      if (targetLang.includes('Chinese')) {
        translatedSegments = translatedSegments.map((seg: any) => ({
          ...seg,
          translated: converter(seg.translated || '')
        }));
      }
      
      res.json(translatedSegments);
    } catch (error: any) {
      console.error("Translation error:", error);
      const keyHint = apiKey ? ` (Key 開頭: ${apiKey.substring(0, 4)}..., 長度: ${apiKey.length})` : "";
      res.status(500).json({ error: (error.message || "翻譯過程發生錯誤") + keyHint });
    }
  });

  // Vite middleware for development
  const isProd = process.env.NODE_ENV === "production";
  
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  // Catch-all for 404s to help debugging
  app.use((req, res, next) => {
    console.warn(`[404] Not Found: ${req.method} ${req.url}`);
    res.status(404).json({ error: "Not Found", path: req.url, method: req.method });
  });

  const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
  
  app.listen(portNumber, "0.0.0.0", () => {
    console.log(`Server running on port ${portNumber}`);
    console.log(`Environment Check:`);
    console.log(`- OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'Present (starts with ' + process.env.OPENAI_API_KEY.substring(0, 3) + '...)' : 'Missing'}`);
    console.log(`- OPENAI_BASE_URL: ${process.env.OPENAI_BASE_URL || 'Missing'}`);
  });
}

startServer();
