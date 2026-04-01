import React, { useState, useEffect } from 'react';
import { auth, db, signInWithGoogle, logOut } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, getDocs, updateDoc, orderBy, limit } from 'firebase/firestore';
import { LogIn, LogOut, User as UserIcon, Coins, Sparkles, Loader2, X, MessageCircle, CreditCard, Settings, Search, Save, AlertCircle, Moon, Sun, RefreshCw, UserPlus, Send, HelpCircle, CheckCircle2, List, Ticket } from 'lucide-react';
import { handleFirestoreError, OperationType } from './lib/firestore-errors';
import { logUsage, submitSupportTicket } from './lib/usage';
import { cn } from './lib/utils';
import StableV1 from './versions/StableV1';
import HistoryV2 from './versions/HistoryV2';
import BilingualV3 from './versions/BilingualV3';

type Version = 'V1' | 'V2' | 'V3';

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "發生了預期之外的錯誤。";
      let isPermissionError = false;

      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error && (parsedError.error.includes('permission') || parsedError.error.includes('insufficient'))) {
          errorMessage = "權限不足或資料庫存取受限。請確認您的帳號權限。";
          isPermissionError = true;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 max-w-md w-full rounded-3xl shadow-2xl p-8 text-center space-y-6 border border-slate-200 dark:border-slate-800">
            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={40} />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-slate-900 dark:text-slate-50">系統錯誤</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{errorMessage}</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 dark:shadow-none"
            >
              <RefreshCw size={20} />
              重新整理網頁
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// 額度不足彈窗組件
function QuotaModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200/60 dark:border-slate-800">
        <div className="p-8 text-center space-y-6">
          <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <Coins size={40} />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-black text-slate-900 dark:text-slate-50">額度不足</h3>
            <p className="text-slate-500 dark:text-slate-400">您的剩餘分鐘數不足以轉錄此音檔。請購買更多額度以繼續使用專業服務。</p>
          </div>
          
          <div className="grid grid-cols-1 gap-3">
            <a 
              href="mailto:theoder@gmail.com?subject=購買 VoxFlow Pro 額度" 
              className="flex items-center justify-center gap-2 w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none"
            >
              <MessageCircle size={20} />
              聯絡客服購買 (Email)
            </a>
            <button 
              onClick={onClose}
              className="w-full py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
            >
              稍後再說
            </button>
          </div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 text-center border-t border-slate-100 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">VoxFlow Pro • 商業營運模式</p>
        </div>
      </div>
    </div>
  );
}

// 專業版錯誤回報彈窗
function SupportModal({ isOpen, onClose, user, initialErrorCode }: { isOpen: boolean; onClose: () => void; user: User | null; initialErrorCode?: string }) {
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('系統錯誤回報');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSuccess(false);
      setMessage('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !message) return;
    setIsSubmitting(true);
    try {
      await submitSupportTicket({
        uid: user.uid,
        email: user.email || 'unknown',
        subject,
        message,
        errorCode: initialErrorCode,
      });
      setSuccess(true);
      setTimeout(onClose, 2000);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200/60 dark:border-slate-800">
        <div className="p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <HelpCircle size={24} />
              <h3 className="text-xl font-black dark:text-slate-50">聯絡技術支援</h3>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
              <X size={20} className="text-slate-400" />
            </button>
          </div>

          {success ? (
            <div className="py-12 text-center space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} />
              </div>
              <p className="font-bold text-slate-900 dark:text-slate-50">回報已送出！</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">管理員將會盡快處理您的問題。</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">主旨</label>
                <input 
                  type="text" 
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-slate-50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">問題描述</label>
                <textarea 
                  rows={4}
                  placeholder="請詳細描述您遇到的問題..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-slate-50 resize-none"
                  required
                />
              </div>
              {initialErrorCode && (
                <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] text-slate-400 font-mono">錯誤代碼: {initialErrorCode}</p>
                </div>
              )}
              <button 
                type="submit"
                disabled={isSubmitting || !message}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-100 dark:shadow-none"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                送出回報
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// 管理員面板組件
function AdminPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'users' | 'logs' | 'tickets'>('users');
  const [searchEmail, setSearchEmail] = useState('');
  const [manualUid, setManualUid] = useState('');
  const [foundUser, setFoundUser] = useState<any>(null);
  const [newQuota, setNewQuota] = useState<number>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState('');
  
  const [logs, setLogs] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  useEffect(() => {
    if (isOpen && activeTab !== 'users') {
      fetchData();
    }
  }, [isOpen, activeTab]);

  const fetchData = async () => {
    setIsLoadingData(true);
    try {
      if (activeTab === 'logs') {
        const q = query(collection(db, "usage_logs"), orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);
        setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else if (activeTab === 'tickets') {
        const q = query(collection(db, "support_tickets"), orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);
        setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleSearch = async () => {
    if (!searchEmail) return;
    setIsSearching(true);
    setMessage('');
    setFoundUser(null);
    try {
      const q = query(collection(db, "users"), where("email", "==", searchEmail.trim()));
      let querySnapshot;
      try {
        querySnapshot = await getDocs(q);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, "users (query by email)");
        throw err;
      }
      if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        setFoundUser({ id: userDoc.id, ...userDoc.data() });
        setNewQuota(userDoc.data().quota || 0);
      } else {
        setFoundUser(null);
        setMessage('找不到該使用者，您可以嘗試手動建立。');
      }
    } catch (error) {
      console.error(error);
      setMessage('搜尋發生錯誤');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateManual = async () => {
    if (!searchEmail || !manualUid) {
      setMessage('請輸入 Email 與 UID');
      return;
    }
    setIsCreating(true);
    setMessage('');
    try {
      const userDocRef = doc(db, "users", manualUid.trim());
      await setDoc(userDocRef, {
        email: searchEmail.trim(),
        quota: 60,
        createdAt: new Date().toISOString(),
        role: 'user'
      });
      setMessage('手動建立成功！');
      handleSearch();
    } catch (error) {
      console.error(error);
      setMessage('建立失敗：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async () => {
    if (!foundUser) return;
    setIsUpdating(true);
    try {
      const userDocRef = doc(db, "users", foundUser.id);
      try {
        await updateDoc(userDocRef, { quota: newQuota });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${foundUser.id}`);
        throw err;
      }
      setMessage('額度更新成功！');
      setFoundUser({ ...foundUser, quota: newQuota });
    } catch (error) {
      console.error(error);
      setMessage('更新失敗: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsUpdating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200/60 dark:border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center">
              <Settings size={20} />
            </div>
            <h3 className="text-xl font-black dark:text-slate-50">VoxFlow 管理員後台</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex border-b border-slate-100 dark:border-slate-800 shrink-0">
          <button 
            onClick={() => setActiveTab('users')}
            className={cn(
              "flex-1 py-4 text-sm font-bold transition-all border-b-2 flex items-center justify-center gap-2",
              activeTab === 'users' ? "border-indigo-600 text-indigo-600 bg-indigo-50/30 dark:bg-indigo-900/10" : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            )}
          >
            <UserIcon size={18} /> 使用者管理
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            className={cn(
              "flex-1 py-4 text-sm font-bold transition-all border-b-2 flex items-center justify-center gap-2",
              activeTab === 'logs' ? "border-indigo-600 text-indigo-600 bg-indigo-50/30 dark:bg-indigo-900/10" : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            )}
          >
            <List size={18} /> 使用日誌
          </button>
          <button 
            onClick={() => setActiveTab('tickets')}
            className={cn(
              "flex-1 py-4 text-sm font-bold transition-all border-b-2 flex items-center justify-center gap-2",
              activeTab === 'tickets' ? "border-indigo-600 text-indigo-600 bg-indigo-50/30 dark:bg-indigo-900/10" : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            )}
          >
            <Ticket size={18} /> 支援工單
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'users' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">搜尋使用者 (Email)</label>
                <div className="flex gap-2">
                  <input 
                    type="email" 
                    placeholder="example@gmail.com"
                    value={searchEmail}
                    onChange={(e) => setSearchEmail(e.target.value)}
                    className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-slate-50"
                  />
                  <button 
                    onClick={handleSearch}
                    disabled={isSearching}
                    className="px-6 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {isSearching ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                    搜尋
                  </button>
                </div>
              </div>

              {message && (
                <div className={`p-4 rounded-2xl text-sm font-bold text-center ${message.includes('成功') ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                  {message}
                </div>
              )}

              {foundUser ? (
                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-6 animate-in slide-in-from-top-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">使用者資訊</p>
                      <h4 className="text-lg font-black dark:text-slate-50">{foundUser.email}</h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-1">UID: {foundUser.id}</p>
                    </div>
                    <div className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-bold">
                      {foundUser.role || 'user'}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">剩餘額度 (分鐘)</label>
                      <input 
                        type="number" 
                        value={newQuota}
                        onChange={(e) => setNewQuota(parseInt(e.target.value) || 0)}
                        className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-slate-50"
                      />
                    </div>
                    <div className="flex items-end">
                      <button 
                        onClick={handleUpdate}
                        disabled={isUpdating}
                        className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isUpdating ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        儲存更新
                      </button>
                    </div>
                  </div>
                </div>
              ) : !isSearching && searchEmail && message.includes('找不到') && (
                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in slide-in-from-top-4">
                  <p className="text-sm font-bold text-slate-500">手動建立使用者紀錄 (當 Auth 有人但 Firestore 沒人時)</p>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">輸入使用者 UID</label>
                      <input 
                        type="text" 
                        placeholder="jOJ2k..."
                        value={manualUid}
                        onChange={(e) => setManualUid(e.target.value)}
                        className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-slate-50"
                      />
                    </div>
                    <button 
                      onClick={handleCreateManual}
                      disabled={isCreating || !manualUid}
                      className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isCreating ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                      建立 Firestore 紀錄
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <h4 className="font-black dark:text-slate-50">最近 50 筆使用日誌</h4>
                <button onClick={fetchData} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400">
                  <RefreshCw size={16} className={isLoadingData ? "animate-spin" : ""} />
                </button>
              </div>
              
              {isLoadingData ? (
                <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-400">
                  <Loader2 className="animate-spin" size={40} />
                  <p className="font-bold">載入中...</p>
                </div>
              ) : logs.length === 0 ? (
                <div className="py-20 text-center text-slate-400">尚無日誌紀錄</div>
              ) : (
                <div className="space-y-3">
                  {logs.map(log => (
                    <div key={log.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                            log.status === 'success' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                          )}>
                            {log.status}
                          </span>
                          <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full uppercase">
                            {log.version}
                          </span>
                          <span className="text-xs font-bold dark:text-slate-300 truncate">{log.email}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 truncate">{log.fileName} ({log.duration} min)</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-400 font-mono">{new Date(log.timestamp).toLocaleString()}</p>
                        {log.error && <p className="text-[9px] text-red-500 mt-1 truncate max-w-[200px]">{log.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'tickets' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <h4 className="font-black dark:text-slate-50">最近 50 筆支援工單</h4>
                <button onClick={fetchData} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400">
                  <RefreshCw size={16} className={isLoadingData ? "animate-spin" : ""} />
                </button>
              </div>

              {isLoadingData ? (
                <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-400">
                  <Loader2 className="animate-spin" size={40} />
                  <p className="font-bold">載入中...</p>
                </div>
              ) : tickets.length === 0 ? (
                <div className="py-20 text-center text-slate-400">尚無工單紀錄</div>
              ) : (
                <div className="space-y-4">
                  {tickets.map(ticket => (
                    <div key={ticket.id} className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="font-black text-indigo-600 dark:text-indigo-400">{ticket.subject}</h5>
                        <p className="text-[10px] text-slate-400 font-mono">{new Date(ticket.timestamp).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserIcon size={14} className="text-slate-400" />
                        <span className="text-xs font-bold dark:text-slate-300">{ticket.email}</span>
                        {ticket.errorCode && <span className="text-[9px] bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded font-mono">Code: {ticket.errorCode}</span>}
                      </div>
                      <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                        {ticket.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NoticeBanner() {
  const isInIframe = window.self !== window.top;
  
  return (
    <div className="space-y-4 mb-8">
      {isInIframe && (
        <div className="bg-amber-50/80 dark:bg-amber-900/40 border border-amber-100 dark:border-amber-800/60 rounded-2xl p-5 flex items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-4">
            <div className="bg-amber-100 dark:bg-amber-800/60 text-amber-600 dark:text-amber-300 p-2 rounded-xl shrink-0">
              <AlertCircle size={24} />
            </div>
            <div className="text-sm text-amber-800 dark:text-amber-100">
              <p className="font-black text-base text-amber-900 dark:text-amber-50">⚠️ 偵測到內嵌視窗模式</p>
              <p className="opacity-90">為了確保 Google 登入與 Cookie 正常運作，建議點擊右側按鈕在新分頁開啟。</p>
            </div>
          </div>
          <a 
            href={window.location.href} 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold text-sm hover:bg-amber-700 transition-all whitespace-nowrap"
          >
            在新分頁開啟
          </a>
        </div>
      )}
      
      <div className="bg-blue-50/80 dark:bg-blue-900/40 border border-blue-100 dark:border-blue-800/60 rounded-2xl p-5 flex items-start gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="bg-blue-100 dark:bg-blue-800/60 text-blue-600 dark:text-blue-300 p-2 rounded-xl shrink-0">
          <AlertCircle size={24} />
        </div>
        <div className="text-sm text-blue-800 dark:text-blue-100 space-y-2">
          <p className="font-black text-base text-blue-900 dark:text-blue-50">💡 系統使用須知</p>
          <ul className="list-disc list-inside space-y-1 ml-1 opacity-90">
            <li><strong className="text-blue-900 dark:text-blue-50">啟動時間：</strong>本站使用免費伺服器，若超過 15 分鐘無人使用會進入休眠。首次開啟或上傳時，可能需要等待約 1 分鐘喚醒伺服器。</li>
            <li><strong className="text-blue-900 dark:text-blue-50">隱私保護：</strong>為保護您的隱私與節省空間，音檔在處理完成後會<strong className="text-blue-900 dark:text-blue-50">立即永久刪除</strong>，不會保留在伺服器上。</li>
            <li><strong className="text-blue-900 dark:text-blue-50">資料保存：</strong>產生的 SRT 字幕檔請務必<strong className="text-blue-900 dark:text-blue-50">盡快下載保存</strong>。若重新整理網頁或離開，未下載的字幕資料將會消失。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeVersion, setActiveVersion] = useState<Version>('V3');
  const [user, setUser] = useState<User | null>(null);
  const [quota, setQuota] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportErrorCode, setSupportErrorCode] = useState<string | undefined>(undefined);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const isAdmin = user?.email === 'theoder@gmail.com';

  const openSupport = (code?: string) => {
    setSupportErrorCode(code);
    setIsSupportModalOpen(true);
  };

  useEffect(() => {
    // Initialize dark mode from localStorage or system preference
    const savedTheme = localStorage.getItem('voxflow_theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleDarkMode = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);
    
    if (newDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('voxflow_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('voxflow_theme', 'light');
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await initializeUserProfile(currentUser);
        const userDocRef = doc(db, "users", currentUser.uid);
        const unsubSnapshot = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) setQuota(docSnap.data().quota || 0);
        }, (err) => {
          handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}`);
        });
        setLoading(false);
        return () => unsubSnapshot();
      } else {
        setQuota(0);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const initializeUserProfile = async (currentUser: User) => {
    const userDocRef = doc(db, "users", currentUser.uid);
    let docSnap;
    try {
      docSnap = await getDoc(userDocRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}`);
      throw err;
    }
    if (!docSnap.exists()) {
      try {
        await setDoc(userDocRef, {
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          quota: 60,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`);
        throw err;
      }
    }
  };

  const handleLogin = async () => {
    try { await signInWithGoogle(); } catch (error) { console.error(error); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-50 font-sans transition-colors duration-300">
      <QuotaModal isOpen={isQuotaModalOpen} onClose={() => setIsQuotaModalOpen(false)} />
      <AdminPanel isOpen={isAdminPanelOpen} onClose={() => setIsAdminPanelOpen(false)} />
      
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800 px-6 py-4 transition-colors duration-300">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none">
              <Sparkles className="text-white" size={18} />
            </div>
            <span className="text-xl font-black tracking-tight">VoxFlow <span className="text-indigo-600 dark:text-indigo-400">Pro</span></span>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={toggleDarkMode} 
              className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
              title="切換深色/淺色模式"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {user ? (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setIsQuotaModalOpen(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-full border border-amber-100 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-all group"
                >
                  <Coins size={14} className="text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-300">剩餘: {quota} 分鐘</span>
                  <div className="w-5 h-5 bg-amber-600 dark:bg-amber-500 text-white dark:text-slate-900 rounded-full flex items-center justify-center text-[12px] font-black group-hover:scale-110 transition-transform shadow-sm">
                    +
                  </div>
                </button>
                
                <div className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-700">
                  {isAdmin && (
                    <button 
                      onClick={() => setIsAdminPanelOpen(true)}
                      className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      title="管理員後台"
                    >
                      <Settings size={20} />
                    </button>
                  )}
                  <img src={user.photoURL || ''} alt="User" className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700" />
                  <button onClick={() => logOut()} className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"><LogOut size={20} /></button>
                </div>
              </div>
            ) : (
              <button onClick={handleLogin} className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-sm hover:bg-slate-800 dark:hover:bg-slate-100 transition-all shadow-lg shadow-slate-200 dark:shadow-none"><LogIn size={18} />Google 登入</button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <NoticeBanner />
        {user ? (
          <div className="space-y-12">
            <div className="flex justify-center">
              <div className="bg-white dark:bg-slate-900 p-1.5 rounded-2xl shadow-sm border border-slate-200/60 dark:border-slate-800 flex gap-1 transition-colors duration-300">
                {(['V1', 'V3'] as Version[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setActiveVersion(v)}
                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      activeVersion === v ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 dark:shadow-none' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {v === 'V1' ? '單語辨識' : '雙語翻譯'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-[600px]">
              {activeVersion === 'V1' && <StableV1 user={user} onOpenQuotaModal={() => setIsQuotaModalOpen(true)} onOpenSupport={openSupport} />}
              {/* {activeVersion === 'V2' && <HistoryV2 user={user} onOpenQuotaModal={() => setIsQuotaModalOpen(true)} />} */}
              {activeVersion === 'V3' && <BilingualV3 user={user} onOpenQuotaModal={() => setIsQuotaModalOpen(true)} onOpenSupport={openSupport} />}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 space-y-8 text-center">
            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-3xl flex items-center justify-center shadow-inner"><UserIcon size={40} /></div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-900 dark:text-slate-50">歡迎來到 VoxFlow Pro</h2>
              <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">請先登入您的帳號，即可開始使用專業的 AI 語音轉錄與翻譯服務。</p>
            </div>
            <button onClick={handleLogin} className="flex items-center gap-3 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 dark:shadow-none"><LogIn size={24} />使用 Google 帳號登入</button>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-slate-200/60 dark:border-slate-800 text-center transition-colors duration-300">
        <p className="text-slate-400 dark:text-slate-500 text-sm font-medium">© 2024 VoxFlow Pro Lab • Professional Transcription Ecosystem</p>
      </footer>

      <QuotaModal isOpen={isQuotaModalOpen} onClose={() => setIsQuotaModalOpen(false)} />
      <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} user={user} initialErrorCode={supportErrorCode} />
      <AdminPanel isOpen={isAdminPanelOpen} onClose={() => setIsAdminPanelOpen(false)} />
    </div>
  );
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
