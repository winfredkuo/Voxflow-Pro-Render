import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
        timestamp_granularities: ["segment"],
      };

      if (language && language !== 'auto') {
        options.language = language;
      }

      const transcription = await openai.audio.transcriptions.create(options);

      // Clean up uploaded file
      if (fs.existsSync(filePathWithExt)) {
        fs.unlinkSync(filePathWithExt);
      }

      // Map OpenAI segments to our format
      const result = (transcription as any).segments?.map((seg: any) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
      })) || [];

      res.json(result);
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
