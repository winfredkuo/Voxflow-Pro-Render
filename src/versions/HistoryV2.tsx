import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { Upload, FileAudio, Download, Loader2, CheckCircle2, AlertCircle, FileText, Trash2, Clock, History as HistoryIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface Subtitle {
  start: string;
  end: string;
  text: string;
}

interface HistoryItem {
  id: string;
  filename: string;
  date: string;
  srtContent: string;
}

export default function HistoryV2() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('voxflow_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Save history whenever it changes
  const saveToHistory = (filename: string, content: string) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      filename,
      date: new Date().toLocaleString(),
      srtContent: content
    };
    const updatedHistory = [newItem, ...history].slice(0, 10); // Keep last 10 items
    setHistory(updatedHistory);
    localStorage.setItem('voxflow_history', JSON.stringify(updatedHistory));
  };

  const deleteHistoryItem = (id: string) => {
    const updatedHistory = history.filter(item => item.id !== id);
    setHistory(updatedHistory);
    localStorage.setItem('voxflow_history', JSON.stringify(updatedHistory));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 25 * 1024 * 1024) {
        setError("檔案太大。請上傳 25MB 以下的音檔。");
        return;
      }
      setFile(selectedFile);
      setError(null);
      setSrtContent(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const timeToMs = (timeStr: string): number => {
    const [time, ms] = timeStr.split(',');
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600000 + m * 60000 + s * 1000 + Number(ms);
  };

  const convertToSrt = (subtitles: Subtitle[]): string => {
    return subtitles.map((sub, index) => {
      return `${index + 1}\n${sub.start} --> ${sub.end}\n${sub.text}\n`;
    }).join('\n');
  };

  const processAudio = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProgress('正在讀取音檔...');

    try {
      const base64Data = await fileToBase64(file);
      setProgress('正在辨識語音...');

      // 改用 Cloudflare Worker 代理
      const workerUrl = "https://odd-sky-f30e.theoder.workers.dev";
      
      const payload = {
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: file.type || 'audio/mpeg', data: base64Data } },
              { text: "請精確轉錄這段音檔。輸出格式必須為 JSON 陣列，包含 'start' (HH:MM:SS,mmm), 'end' (HH:MM:SS,mmm), 和 'text' 欄位。每條字幕的 'text' 長度絕對不能超過 15 個字。請「絕對不要」包含任何標點符號。" }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.STRING },
                end: { type: Type.STRING },
                text: { type: Type.STRING }
              },
              required: ["start", "end", "text"]
            }
          }
        }
      };

      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!workerResponse.ok) throw new Error("代理伺服器回應錯誤");
      const data = await workerResponse.json();
      const textResult = data.candidates[0].content.parts[0].text;
      let result: Subtitle[] = JSON.parse(textResult);

      setProgress('優化間隙...');

      for (let i = 0; i < result.length - 1; i++) {
        const currentEndMs = timeToMs(result[i].end);
        const nextStartMs = timeToMs(result[i + 1].start);
        const gap = nextStartMs - currentEndMs;
        if (gap > 0 && gap <= 2000) {
          result[i].end = result[i + 1].start;
        }
      }

      const srt = convertToSrt(result);
      setSrtContent(srt);
      saveToHistory(file.name, srt);
      setProgress('完成！');
    } catch (err: any) {
      setError(err.message || "發生錯誤。");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadSrt = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.srt') ? filename : `${filename.split('.')[0]}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-12">
      <header className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-xs font-bold uppercase tracking-wider">
          <HistoryIcon size={14} />
          <span>VoxFlow V2 History</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900">
          Vox<span className="text-indigo-600">Flow</span> V2
        </h1>
        <p className="text-slate-500 text-lg max-w-md mx-auto">
          進化版：新增本地歷史紀錄，隨時找回之前的轉錄結果。
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Processing Area */}
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60">
            <div className="space-y-6">
              <div 
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                className={cn(
                  "relative group cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-300 p-10",
                  file ? "border-indigo-600 bg-indigo-50/30" : "border-slate-200 hover:border-indigo-400 hover:bg-slate-50",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
                <div className="flex flex-col items-center gap-4">
                  {file ? <FileAudio size={32} className="text-indigo-600" /> : <Upload size={32} className="text-slate-400" />}
                  <p className="font-bold text-slate-900">{file ? file.name : "點擊上傳音檔"}</p>
                </div>
              </div>

              {error && <div className="p-4 rounded-xl bg-red-50 text-red-600 text-sm flex items-center gap-2"><AlertCircle size={18} /> {error}</div>}

              <button
                onClick={processAudio}
                disabled={!file || isProcessing}
                className={cn(
                  "w-full py-4 rounded-2xl font-bold text-white transition-all flex items-center justify-center gap-2",
                  !file || isProcessing ? "bg-slate-200 text-slate-400" : "bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100"
                )}
              >
                {isProcessing ? <><Loader2 className="animate-spin" size={20} /> {progress}</> : <><FileText size={20} /> 開始生成</>}
              </button>
            </div>
          </section>

          {srtContent && (
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60 animate-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center"><CheckCircle2 size={20} /></div>
                  <p className="font-bold">字幕已就緒</p>
                </div>
                <button onClick={() => downloadSrt(srtContent!, file?.name || 'subtitles')} className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl flex items-center gap-2 hover:bg-emerald-700 transition-all">
                  <Download size={18} /> 下載 SRT
                </button>
              </div>
            </section>
          )}
        </div>

        {/* History Sidebar */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <Clock size={18} className="text-slate-400" />
            <h3 className="font-bold text-slate-900">最近紀錄 (本地)</h3>
          </div>
          
          <div className="space-y-3">
            {history.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl p-8 text-center border border-slate-100">
                <p className="text-slate-400 text-sm font-medium">尚無紀錄</p>
              </div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="group bg-white rounded-2xl p-4 border border-slate-200/60 hover:border-indigo-200 transition-all shadow-sm hover:shadow-md">
                  <div className="flex flex-col gap-2">
                    <p className="font-bold text-slate-900 text-sm truncate pr-6">{item.filename}</p>
                    <p className="text-[10px] text-slate-400 font-medium">{item.date}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button 
                        onClick={() => downloadSrt(item.srtContent, item.filename)}
                        className="flex-1 py-2 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1"
                      >
                        <Download size={14} /> 下載
                      </button>
                      <button 
                        onClick={() => deleteHistoryItem(item.id)}
                        className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
