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

const upload = multer({ dest: "uploads/" });

let openaiClient: OpenAI | null = null;

function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY || "dummy-key-for-proxy";
    let baseURL = process.env.OPENAI_BASE_URL || "https://winfred-api-gpt.theoder.workers.dev/v1";
    
    // Ensure baseURL has a protocol
    if (baseURL && !baseURL.startsWith('http')) {
      baseURL = `https://${baseURL}`;
    }
    
    // Remove trailing slash if present to avoid double slashes in SDK
    if (baseURL && baseURL.endsWith('/')) {
      baseURL = baseURL.slice(0, -1);
    }

    console.log(`Initializing OpenAI with baseURL: ${baseURL}`);

    openaiClient = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL,
    });
  }
  return openaiClient;
}

async function startServer() {
  // API routes
  app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

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
      console.error("Transcription error:", error);
      res.status(500).json({ error: error.message || "Transcription failed" });
    }
  });

  // Vite middleware for development
  const isProd = process.env.NODE_ENV === "production" || fs.existsSync(path.join(process.cwd(), "dist", "index.html"));
  
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
