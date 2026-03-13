import React, { useState, useRef } from 'react';
import { Upload, FileAudio, Download, Loader2, CheckCircle2, AlertCircle, FileText, ShieldCheck, AlignLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { db } from '../lib/firebase';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { User } from 'firebase/auth';

interface Subtitle { start: string; end: string; text: string; }

export default function StableV1({ user, onOpenQuotaModal }: { user: User | null; onOpenQuotaModal: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<string>('auto');
  const [isProcessing, setIsProcessing] = useState(false);
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    setProgress('正在檢查額度...');

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
        throw new Error(`額度不足。此音檔需 ${durationMinutes} 分鐘。`);
      }

      setProgress('正在辨識 (使用高精度 AI 引擎)...');
      
      const formData = new FormData();
      formData.append('audio', file); // Backend expects 'audio' field
      if (language && language !== 'auto') {
        formData.append('language', language);
      }

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
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

      if (!response.ok) {
        let errMsg = result.error || '辨識失敗';
        if (typeof errMsg !== 'string') errMsg = JSON.stringify(errMsg);
        
        // 如果有詳細資訊，也顯示出來
        if (result.details) {
          const details = typeof result.details === 'string' ? result.details : JSON.stringify(result.details);
          errMsg += ` (詳情: ${details})`;
        }

        if (errMsg.includes('Unexpected token') || errMsg.includes('is not valid JSON') || errMsg.includes('The page c')) {
          errMsg = `伺服器錯誤：連線超時或無效回應。這通常是因為音檔過長導致處理超時。請嘗試上傳較短的音檔。`;
        } else if (errMsg.includes('Not found') || response.status === 404) {
          errMsg = `伺服器端點未找到 (404)。請確認您的 Cloudflare Worker 網址設定正確，且包含 /v1。目前設定: ${result.details || '無詳細資訊'}`;
        }
        throw new Error(errMsg);
      }

      await updateDoc(userDocRef, { quota: increment(-durationMinutes) });

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
      const srt = result.map((sub, index) => {
        const start = formatTime(Number(sub.start));
        // 如果不是最後一句，結尾等於下一句的開頭，實現無縫銜接
        const endTime = (index < result.length - 1) ? Number(result[index + 1].start) : Number(sub.end);
        const end = formatTime(endTime);
        return `${index + 1}\r\n${start} --> ${end}\r\n${sub.text}\r\n`;
      }).join('\r\n');

      setSrtContent('\ufeff' + srt);
      setProgress('完成！');
    } catch (err: any) {
      setError(err.message || "發生錯誤。");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadSrt = (content: string, filename: string) => {
    // 加入 UTF-8 BOM (\ufeff) 確保剪輯軟體正確識別編碼
    const blob = new Blob(["\ufeff", content], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTxt = (content: string, filename: string) => {
    // Remove SRT timecodes and sequence numbers to get pure text
    const txtContent = content
      .replace(/^\ufeff/, '') // Remove BOM if present
      .split('\r\n\r\n')
      .map(block => {
        const lines = block.split('\r\n');
        // Skip sequence number (lines[0]) and timecode (lines[1])
        return lines.slice(2).join('\n');
      })
      .filter(text => text.trim() !== '')
      .join('\n');

    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-in fade-in duration-500 max-w-2xl mx-auto space-y-12">
      <header className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider">
          <ShieldCheck size={14} />
          <span>VoxFlow V1 Stable</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-slate-50">VoxFlow <span className="text-indigo-600 dark:text-indigo-400">Stable</span></h1>
        <p className="text-slate-500 dark:text-slate-400 text-lg">基準穩定版：專注於極速、精準的單語轉錄。</p>
      </header>

      <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm border border-slate-200/60 dark:border-slate-800 space-y-8 transition-colors duration-300">
        <div onClick={() => !isProcessing && fileInputRef.current?.click()} className={cn("relative group cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-300 p-12 flex flex-col items-center gap-4", file ? "border-indigo-600 bg-indigo-50/30 dark:bg-indigo-900/20" : "border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/50", isProcessing && "opacity-50 cursor-not-allowed")}>
          <input type="file" ref={fileInputRef} onChange={(e) => setFile(e.target.files?.[0] || null)} accept="audio/*" className="hidden" />
          {file ? <FileAudio size={48} className="text-indigo-600 dark:text-indigo-400" /> : <Upload size={48} className="text-slate-400 dark:text-slate-500" />}
          <div className="text-center">
            <p className="font-bold text-slate-900 dark:text-slate-50 text-lg">{file ? file.name : "點擊上傳音檔"}</p>
            <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">支援 MP3, WAV, M4A (最大 25MB)</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-bold text-slate-700 dark:text-slate-300">選擇音檔語言 (可提高辨識準確度)</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'auto', label: '自動偵測' },
              { id: 'zh', label: '繁體中文' },
              { id: 'en', label: '英文 (English)' }
            ].map((lang) => (
              <button
                key={lang.id}
                onClick={() => setLanguage(lang.id)}
                disabled={isProcessing}
                className={cn(
                  "py-3 rounded-xl text-sm font-bold transition-all border",
                  language === lang.id 
                    ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 shadow-sm" 
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-200 dark:hover:border-indigo-700 hover:bg-slate-50 dark:hover:bg-slate-800/80",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm flex items-center gap-2 border border-red-100 dark:border-red-900/30"><AlertCircle size={18} /> {error}</div>}

        <button onClick={processAudio} disabled={!file || isProcessing} className={cn("w-full py-4 rounded-2xl font-bold text-white transition-all flex items-center justify-center gap-2", !file || isProcessing ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500" : "bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 dark:shadow-none")}>
          {isProcessing ? <><Loader2 className="animate-spin" size={20} /> {progress}</> : <><FileText size={20} /> 開始生成字幕</>}
        </button>
      </section>

      {srtContent && (
        <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm border border-slate-200/60 dark:border-slate-800 animate-in slide-in-from-bottom-4 flex flex-col sm:flex-row items-center justify-between gap-6 transition-colors duration-300">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center shrink-0"><CheckCircle2 size={24} /></div>
            <div>
              <p className="font-bold text-slate-900 dark:text-slate-50 text-lg">字幕已就緒</p>
              <p className="text-slate-400 dark:text-slate-500 text-sm">已自動從額度扣除分鐘數</p>
            </div>
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button 
              onClick={() => downloadTxt(srtContent!, `${file?.name.split('.')[0]}.txt`)} 
              className="flex-1 sm:flex-none px-6 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
            >
              <AlignLeft size={20} /> 純文字
            </button>
            <button 
              onClick={() => downloadSrt(srtContent!, `${file?.name.split('.')[0]}.srt`)} 
              className="flex-1 sm:flex-none px-6 py-4 bg-emerald-600 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 dark:shadow-none"
            >
              <Download size={20} /> SRT
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
