import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { Upload, FileAudio, Download, Loader2, CheckCircle2, AlertCircle, Trash2, Clock, Languages, History as HistoryIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { db } from '../lib/firebase';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { User } from 'firebase/auth';

interface SubtitleSegment { start: string; end: string; original: string; translated: string; }
interface HistoryItem { id: string; filename: string; date: string; originalSrt: string; translatedSrt: string; targetLang: string; }

const TARGET_LANGUAGES = [
  { label: '英文 (English)', value: 'English' },
  { label: '日文 (Japanese)', value: 'Japanese' },
  { label: '繁體中文 (Traditional Chinese)', value: 'Traditional Chinese' },
  { label: '韓文 (Korean)', value: 'Korean' },
  { label: '法文 (French)', value: 'French' },
  { label: '德文 (German)', value: 'German' },
];

export default function BilingualV3({ user, onOpenQuotaModal }: { user: User | null; onOpenQuotaModal: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('English');
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<{ original: string; translated: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedHistory = localStorage.getItem('voxflow_history_v3');
    if (savedHistory) try { setHistory(JSON.parse(savedHistory)); } catch (e) { console.error(e); }
  }, []);

  const saveToHistory = (filename: string, original: string, translated: string, lang: string) => {
    const newItem = { id: Date.now().toString(), filename, date: new Date().toLocaleString(), originalSrt: original, translatedSrt: translated, targetLang: lang };
    const updatedHistory = [newItem, ...history].slice(0, 10);
    setHistory(updatedHistory);
    localStorage.setItem('voxflow_history_v3', JSON.stringify(updatedHistory));
  };

  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      audio.onloadedmetadata = () => resolve(Math.ceil(audio.duration / 60));
    });
  };

  const processAudio = async () => {
    if (!file || !user) return;
    setIsProcessing(true);
    setError(null);

    if (file.size > 25 * 1024 * 1024) {
      setError("檔案大小超過 25MB 限制。請壓縮音檔後再試。");
      setIsProcessing(false);
      return;
    }

    setProgress('檢查額度...');
    try {
      const userDocRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(userDocRef);
      const currentQuota = docSnap.data()?.quota || 0;
      const durationSeconds = await new Promise<number>((resolve) => {
        const audio = new Audio();
        audio.src = URL.createObjectURL(file);
        audio.onloadedmetadata = () => resolve(audio.duration);
      });
      const durationMinutes = Math.ceil(durationSeconds / 60);
      
      if (currentQuota < durationMinutes) {
        onOpenQuotaModal();
        throw new Error(`額度不足。需 ${durationMinutes} 分鐘，剩餘 ${currentQuota} 分鐘。`);
      }

      setProgress(`正在辨識 (使用高精度 AI 引擎)...`);
      
      const formData = new FormData();
      formData.append('audio', file);

      const transcribeResponse = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      const responseText = await transcribeResponse.text();
      let transcriptionResult;
      try {
        transcriptionResult = JSON.parse(responseText);
      } catch (e) {
        let errMsg = `伺服器連線中斷或超時。這通常是因為音檔過大或處理時間過長。請嘗試上傳較短的音檔。`;
        if (responseText.includes('Cookie check') || responseText.includes('AI Studio Logo')) {
          errMsg = `⚠️ 瀏覽器阻擋了安全驗證！請點擊右上角的「在新分頁中開啟 (Open in new tab)」來使用此功能。`;
          console.error("Cookie check intercepted the request. Please open in a new tab.");
        } else {
          console.error("Invalid JSON response from server (truncated):", responseText.substring(0, 100));
        }
        throw new Error(errMsg);
      }

      if (!transcribeResponse.ok) {
        let errMsg = transcriptionResult.error || '辨識失敗';
        if (errMsg.includes('Unexpected token') || errMsg.includes('is not valid JSON') || errMsg.includes('The page c')) {
          errMsg = `OpenAI 代理伺服器錯誤：連線超時或無效回應。這通常是因為音檔過長導致處理超時。請嘗試上傳較短的音檔。`;
        }
        throw new Error(errMsg);
      }

      setProgress(`正在翻譯為 ${targetLang} (使用專業翻譯引擎)...`);

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";

      const translationResponse = await ai.models.generateContent({
        model: model,
        contents: [{
          role: "user",
          parts: [
            { text: `你是一位專業的影視字幕翻譯師。以下是音訊的轉錄內容（包含時間戳）。
請將每一段內容翻譯為 ${targetLang}。

轉錄內容：
${JSON.stringify(transcriptionResult, null, 2)}

核心規則：
1. **信雅達**：翻譯必須自然流暢，符合影視字幕風格。
2. **保持結構**：請回傳與輸入相同結構的 JSON 陣列，但增加 "original" 和 "translated" 欄位。
3. **嚴格 JSON**：只回傳 JSON 陣列，不要有其他文字。` }
          ]
        }],
        config: {
          systemInstruction: `你是一個專業的影視字幕翻譯引擎。你必須精確地將轉錄內容翻譯為目標語言，並保持原有的時間戳結構。`,
          responseMimeType: "application/json",
          temperature: 0,
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
                original: { type: Type.STRING },
                translated: { type: Type.STRING }
              },
              required: ["start", "end", "original", "translated"]
            }
          }
        }
      });

      const textResult = translationResponse.text;
      if (!textResult) throw new Error("翻譯失敗");
      
      let segments: any[];
      try {
        segments = JSON.parse(textResult);
      } catch (e) {
        console.error("Gemini 回傳了非 JSON 格式:", textResult);
        throw new Error("翻譯結果格式錯誤，請重試。");
      }

      await updateDoc(userDocRef, { quota: increment(-durationMinutes) });

      // 輔助函數：將秒數轉換為 HH:MM:SS,mmm
      const formatTime = (seconds: any) => {
        let s = parseFloat(seconds);
        if (isNaN(s)) {
          // 嘗試解析 HH:MM:SS 格式
          if (typeof seconds === 'string' && seconds.includes(':')) {
            const parts = seconds.split(':').map(parseFloat);
            if (parts.length === 3) s = parts[0] * 3600 + parts[1] * 60 + parts[2];
            else if (parts.length === 2) s = parts[0] * 60 + parts[1];
          }
        }
        if (isNaN(s) || s < 0) s = 0;

        const date = new Date(0);
        date.setMilliseconds(s * 1000);
        try {
          const timeString = date.toISOString().substr(11, 12);
          return timeString.replace('.', ',');
        } catch (e) {
          return "00:00:00,000";
        }
      };

      // 格式化為標準 SRT (實作連續時間碼：結尾接下一句開頭)
      const formatSrt = (segments: any[], type: 'original' | 'translated') => {
        return segments.map((seg, index) => {
          const start = formatTime(Number(seg.start));
          // 如果不是最後一句，結尾等於下一句的開頭，實現無縫銜接
          const endTime = (index < segments.length - 1) ? Number(segments[index + 1].start) : Number(seg.end);
          const end = formatTime(endTime);
          const text = type === 'original' ? seg.original : seg.translated;
          return `${index + 1}\r\n${start} --> ${end}\r\n${text}\r\n`;
        }).join('\r\n');
      };

      const originalSrt = '\ufeff' + formatSrt(segments, 'original');
      const translatedSrt = '\ufeff' + formatSrt(segments, 'translated');
      
      setResults({ original: originalSrt, translated: translatedSrt });
      saveToHistory(file.name, originalSrt, translatedSrt, targetLang);
      setProgress('完成！');
    } catch (err: any) { setError(err.message || "發生錯誤。"); } finally { setIsProcessing(false); }
  };

  const downloadFile = (content: string, filename: string) => {
    // 加入 UTF-8 BOM (\ufeff) 確保剪輯軟體正確識別編碼
    const blob = new Blob(["\ufeff", content], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-12">
      <header className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold uppercase tracking-wider"><Languages size={14} /><span>VoxFlow V3 Bilingual</span></div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900">VoxFlow <span className="text-indigo-600">Bilingual</span></h1>
        <p className="text-slate-500 text-lg max-w-md mx-auto">專業版：支援雙語分離轉錄，一鍵生成兩種語言的 SRT 檔案。</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">1. 選擇目標語言</label><select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all">{TARGET_LANGUAGES.map(lang => (<option key={lang.value} value={lang.value}>{lang.label}</option>))}</select></div>
              <div className="space-y-2"><label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">2. 上傳音檔</label><div onClick={() => !isProcessing && fileInputRef.current?.click()} className={cn("cursor-pointer rounded-xl border-2 border-dashed transition-all px-4 py-2 flex items-center gap-3", file ? "border-indigo-600 bg-indigo-50/30" : "border-slate-200 hover:border-indigo-400 hover:bg-slate-50", isProcessing && "opacity-50 cursor-not-allowed")}><input type="file" ref={fileInputRef} onChange={(e) => setFile(e.target.files?.[0] || null)} accept="audio/*" className="hidden" /><FileAudio size={20} className={file ? "text-indigo-600" : "text-slate-400"} /><p className="font-bold text-slate-900 text-sm truncate">{file ? file.name : "點擊上傳"}</p></div></div>
            </div>
            {error && <div className="p-4 rounded-xl bg-red-50 text-red-600 text-sm flex items-center gap-2"><AlertCircle size={18} /> {error}</div>}
            <button onClick={processAudio} disabled={!file || isProcessing} className={cn("w-full py-4 rounded-2xl font-bold text-white transition-all flex items-center justify-center gap-2", !file || isProcessing ? "bg-slate-200 text-slate-400" : "bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100")}>{isProcessing ? <><Loader2 className="animate-spin" size={20} /> {progress}</> : <><Languages size={20} /> 開始雙語轉錄</>}</button>
          </section>
          {results && (
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60 animate-in slide-in-from-bottom-4 space-y-6">
              <div className="flex items-center gap-4"><div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center"><CheckCircle2 size={20} /></div><div><p className="font-bold">雙語轉錄完成</p><p className="text-xs text-slate-400">已生成原始語言與 {targetLang} 翻譯</p></div></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onClick={() => downloadFile(results.original, `${file?.name.split('.')[0]}_Original.srt`)} className="p-4 bg-slate-900 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all"><Download size={18} /> 下載原始語言 SRT</button>
                <button onClick={() => downloadFile(results.translated, `${file?.name.split('.')[0]}_${targetLang}.srt`)} className="p-4 bg-indigo-600 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all"><Download size={18} /> 下載 {targetLang} SRT</button>
              </div>
            </section>
          )}
        </div>
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-2"><HistoryIcon size={18} className="text-slate-400" /><h3 className="font-bold text-slate-900">雙語紀錄 (V3)</h3></div>
          <div className="space-y-3">
            {history.length === 0 ? (<div className="bg-slate-50 rounded-2xl p-8 text-center border border-slate-100"><p className="text-slate-400 text-sm font-medium">尚無雙語紀錄</p></div>) : (history.map((item) => (
              <div key={item.id} className="group bg-white rounded-2xl p-4 border border-slate-200/60 hover:border-indigo-200 transition-all shadow-sm"><div className="flex flex-col gap-2"><p className="font-bold text-slate-900 text-sm truncate pr-6">{item.filename}</p><div className="flex items-center justify-between"><p className="text-[10px] text-slate-400 font-medium">{item.date}</p><span className="text-[9px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold">{item.targetLang}</span></div><div className="grid grid-cols-2 gap-2 mt-2"><button onClick={() => downloadFile(item.originalSrt, `${item.filename.split('.')[0]}_Original.srt`)} className="py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1"><Download size={12} /> 原文</button><button onClick={() => downloadFile(item.translatedSrt, `${item.filename.split('.')[0]}_${item.targetLang}.srt`)} className="py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1"><Download size={12} /> 譯文</button></div><button onClick={() => { const updated = history.filter(h => h.id !== item.id); localStorage.setItem('voxflow_history_v3', JSON.stringify(updated)); }} className="mt-1 self-end text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={12} /></button></div></div>
            )))}
          </div>
        </div>
      </div>
    </div>
  );
}
