import React, { useState, useEffect } from 'react';
import { auth, db, signInWithGoogle, logOut } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { LogIn, LogOut, User as UserIcon, Coins, Sparkles, Loader2, X, MessageCircle, CreditCard, Settings, Search, Save, AlertCircle, Moon, Sun, RefreshCw } from 'lucide-react';
import { handleFirestoreError, OperationType } from './lib/firestore-errors';
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

// 管理員面板組件
function AdminPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [searchEmail, setSearchEmail] = useState('');
  const [foundUser, setFoundUser] = useState<any>(null);
  const [newQuota, setNewQuota] = useState<number>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState('');

  const handleSearch = async () => {
    if (!searchEmail) return;
    setIsSearching(true);
    setMessage('');
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
        setMessage('找不到該使用者');
      }
    } catch (error) {
      console.error(error);
      setMessage('搜尋發生錯誤');
    } finally {
      setIsSearching(false);
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
      setMessage('更新失敗');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-200/60 dark:border-slate-800">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
            <Settings size={20} />
            <h3 className="font-black text-lg dark:text-slate-50">VoxFlow 管理員後台</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 dark:text-slate-400 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 space-y-8 overflow-y-auto">
          <div className="space-y-4">
            <label className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">搜尋使用者 Email</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="email" 
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-slate-50 dark:placeholder-slate-500"
                />
              </div>
              <button 
                onClick={handleSearch}
                disabled={isSearching}
                className="px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all"
              >
                {isSearching ? <Loader2 className="animate-spin" size={20} /> : '搜尋'}
              </button>
            </div>
          </div>

          {message && (
            <div className={`p-4 rounded-2xl text-sm font-bold text-center ${message.includes('成功') ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
              {message}
            </div>
          )}

          {foundUser && (
            <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-6 animate-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center gap-4">
                <img src={foundUser.photoURL} className="w-12 h-12 rounded-full border-2 border-white dark:border-slate-700 shadow-sm" />
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-50">{foundUser.displayName}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{foundUser.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">目前額度</p>
                  <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{foundUser.quota} <span className="text-xs font-medium">min</span></p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">修改額度</p>
                  <input 
                    type="number" 
                    value={newQuota}
                    onChange={(e) => setNewQuota(parseInt(e.target.value) || 0)}
                    className="w-full text-2xl font-black text-slate-900 dark:text-slate-50 bg-transparent outline-none"
                  />
                </div>
              </div>

              <button 
                onClick={handleUpdate}
                disabled={isUpdating}
                className="w-full py-4 bg-slate-900 dark:bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 dark:hover:bg-indigo-700 disabled:opacity-50 transition-all"
              >
                {isUpdating ? <Loader2 className="animate-spin" size={20} /> : <><Save size={20} /> 儲存更新</>}
              </button>
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
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const isAdmin = user?.email === 'theoder@gmail.com';

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
                    {v === 'V1' ? 'Stable' : 'Bilingual'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-[600px]">
              {activeVersion === 'V1' && <StableV1 user={user} onOpenQuotaModal={() => setIsQuotaModalOpen(true)} />}
              {/* {activeVersion === 'V2' && <HistoryV2 user={user} onOpenQuotaModal={() => setIsQuotaModalOpen(true)} />} */}
              {activeVersion === 'V3' && <BilingualV3 user={user} onOpenQuotaModal={() => setIsQuotaModalOpen(true)} />}
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
