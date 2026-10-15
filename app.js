// =============================================================================
// WCM SMART SCAN - OFFLINE PDA SCANNING ENGINE (PLAN DỰ PHÒNG KHO)
// Hỗ trợ đầu Nhập (Phân loại CH.x.x) & đầu Xuất (Đếm lô & Chống lẫn hàng)
// =============================================================================

// Application State
let settings = {
    ttsEnabled: true,
    soundEnabled: true,
    vibrateEnabled: true,
    autoFocusEnabled: true,
    preferredVoiceName: "",
    scanMode: "Nhập" // "Nhập" or "Xuất"
};

// Store Dictionary for offline name resolution
let storeMap = {
    byDo: {},      // doNumber -> storeName
    byDoCode: {},  // doNumber -> storeCode (SAP)
    byCh: {},      // chCode -> storeName
    bySap: {},     // sapCode -> storeName
    trips: {}      // tripCode -> { [storeCode]: { storeCode, storeName, totalQty, province } }
};

// Master Dispatch Data from File Kho Tổng Chốt (File mẫu.xlsb / .xlsx / .csv)
let masterDispatch = {
    sourceFile: "File mẫu.xlsb",
    updatedAt: "",
    totalRows: 0,
    records: [],
    byDo: {},      // doNumber -> record
    bySo: {},      // soNumber -> record
    byStore: {},   // storeCode -> { storeCode, storeName, sttCh, province, district, lotCode, bks, tripCode, vehicleLabel, totalPackages, totalPcs, doList: [] }
    bySttCh: {},   // sttCh -> storeCode
    lots: {}       // tripCode -> { tripCode, lotCode, bks, vehicleLabel, totalPackages, stores: {} }
};

// Per-store scanned items memory across switches within the session
let storeProgressMap = {};

// Master store list from Vinmart update 15.8 (5,145 active stores)
let masterStoreList = [];
let selectedProvinceFilter = "ALL_TAY_BAC"; // Default priority: Tây Bắc (Sơn La, Điện Biên, Phú Thọ, Lai Châu)

// Import Mode State (Set of unique package identifiers)
let importScannedKeys = new Set();

// Export Mode State (Hỗ trợ 2 người bắn đồng thời & Tự động khóa theo File Chốt)
let exportState = {
    targetStore: "",      // e.g. "[2AFF] WM+ PTO Khu 5, Xuân Lộc"
    targetStoreCode: "",  // e.g. "2AFF"
    targetQty: 0,         // e.g. 29 (tổng số kiện tất cả DO của cửa hàng)
    tripCode: "",         // e.g. "88B04454" or "19101309"
    vehicleLabel: "",     // e.g. "BKS: 88B04454 • Lot: 19101309"
    sttCh: "",            // e.g. "429"
    doList: [],           // array of DO objects for the active store
    operatorCode: "NV01", // e.g. "NV01"
    scannedItems: [],     // array of scanned package objects on this device
    peerScannedItems: [], // array of package objects scanned by peer device
    isBatchActive: false,
    isBatchCompleted: false,
    completedAt: null
};

// Recent Stores Cache for Outbound Mode
let recentStores = [];
let currentTripStores = [];

// Inbound Reconciliation State (Đầu Nhập Đối Chiếu Theo Chuyến Xuất)
let inboundReconState = {
    isActive: false,
    tripCode: "",
    totalExported: 0,
    manifestList: [],
    manifestMap: new Map(),
    inboundScannedKeys: new Set(),
    missingKeys: new Set(),
    extraScannedList: []
};

// History Log (audit trail of all scans in session)
let scanHistory = [];

// Audio Context for Web Audio API Synth (Zero audio files required)
let audioCtx = null;

// HTML5 QR Scanner instance (Optional camera usage)
let html5QrCode = null;
let activeCameraId = null;

// DOM Element Selectors
const elSyncText = document.getElementById("sync-text");
const elCsvFileInput = document.getElementById("csv-file-input");
const elDispatchInlineFileInput = document.getElementById("dispatch-inline-file-input");
const elDispatchFileName = document.getElementById("dispatch-file-name");
const elDispatchFileStats = document.getElementById("dispatch-file-stats");
const elBtnResetSession = document.getElementById("btn-reset-session");

const elChkTts = document.getElementById("chk-tts");
const elSelectVoice = document.getElementById("select-voice");
const elChkBeep = document.getElementById("chk-beep");
const elChkVibrate = document.getElementById("chk-vibrate");
const elChkAutoFocus = document.getElementById("chk-autofocus");

const elBtnModeImport = document.getElementById("btn-mode-import");
const elBtnModeExport = document.getElementById("btn-mode-export");

const elManualScanInput = document.getElementById("manual-scan-input");
const elBtnSubmitScan = document.getElementById("btn-submit-scan");

// Export Batch Elements
const elExportConfigBox = document.getElementById("export-config-box");
const elExportTripCode = document.getElementById("export-trip-code");
const elExportTripSelect = document.getElementById("export-trip-select");
const elBtnQuickConfigTrips = document.getElementById("btn-quick-config-trips");
const elCustomTripWrapper = document.getElementById("custom-trip-input-wrapper");
const elExportTripCustomInput = document.getElementById("export-trip-custom-input");

// Trip Configuration Modal Elements
const elBtnOpenTripConfig = document.getElementById("btn-open-trip-config");
const elModalTripConfig = document.getElementById("modal-trip-config");
const elBtnCloseTripConfig = document.getElementById("btn-close-trip-config");
const elBtnCancelTripConfig = document.getElementById("btn-cancel-trip-config");
const elTripConfigTextarea = document.getElementById("trip-config-textarea");
const elBtnSaveTripConfig = document.getElementById("btn-save-trip-config");
const elBtnLoadDefaultTrips = document.getElementById("btn-load-default-trips");
const elTripConfigCountBadge = document.getElementById("trip-config-count-badge");

const elExportOperatorCode = document.getElementById("export-operator-code");
const elExportTargetStore = document.getElementById("export-target-store");
const elExportTargetQty = document.getElementById("export-target-qty");
const elBtnSetBatch = document.getElementById("btn-set-batch");
const elBtnClearBatch = document.getElementById("btn-clear-batch");
const elSummaryStore = document.getElementById("summary-store");
const elSummaryVehicle = document.getElementById("summary-vehicle");
const elSummaryQty = document.getElementById("summary-qty");
const elSummaryDoBreakdown = document.getElementById("summary-do-breakdown");
const elExportStatusBadge = document.getElementById("export-status-badge");
const elExportStoreSelect = document.getElementById("export-store-select");
const elBtnEditTargetQty = document.getElementById("btn-edit-target-qty");
const elBtnUndoLastScan = document.getElementById("btn-undo-last-scan");
const elBtnReassignBatch = document.getElementById("btn-reassign-batch");
const elPeerProgressBox = document.getElementById("export-peer-progress-box");
const elPeerMyCount = document.getElementById("peer-my-count");
const elPeerPartnerCount = document.getElementById("peer-partner-count");
const elPeerTripDisplay = document.getElementById("peer-trip-display");

// Phase 3 DOM Elements
const elExportStoreSearch = document.getElementById("export-store-search");
const elBtnClearStoreSearch = document.getElementById("btn-clear-store-search");
const elRecentStoresContainer = document.getElementById("recent-stores-container");
const elRecentStoresList = document.getElementById("recent-stores-list");

const elBtnOpenTripDashboard = document.getElementById("btn-open-trip-dashboard");
const elModalTripDashboard = document.getElementById("modal-trip-dashboard");
const elBtnCloseTripDashboard = document.getElementById("btn-close-trip-dashboard");
const elBtnRefreshTripDashboard = document.getElementById("btn-refresh-trip-dashboard");
const elDashTripsList = document.getElementById("dash-trips-list");
const elDashTotalTrips = document.getElementById("dash-total-trips");
const elDashTotalPkgs = document.getElementById("dash-total-pkgs");
const elDashActiveTrips = document.getElementById("dash-active-trips");

const elModalBatchCompleted = document.getElementById("modal-batch-completed");
const elBtnModalNextBatch = document.getElementById("btn-modal-next-batch");
const elBtnModalStayBatch = document.getElementById("btn-modal-stay-batch");
const elModalCompleteStore = document.getElementById("modal-complete-store");
const elModalCompleteTrip = document.getElementById("modal-complete-trip");
const elModalCompleteQty = document.getElementById("modal-complete-qty");
const elModalCompleteBreakdown = document.getElementById("modal-complete-breakdown");

const elBtnOpenScannedDrawer = document.getElementById("btn-open-scanned-drawer");
const elBtnScannedCountBadge = document.getElementById("btn-scanned-count-badge");
const elModalScannedPackages = document.getElementById("modal-scanned-packages");
const elBtnCloseScannedPackages = document.getElementById("btn-close-scanned-packages");
const elInputFilterBatchPkgs = document.getElementById("input-filter-batch-pkgs");
const elBatchPkgsCountTag = document.getElementById("batch-pkgs-count-tag");
const elBatchPkgsList = document.getElementById("batch-pkgs-list");

// Camera Elements
const elCameraWrapper = document.getElementById("camera-wrapper");
const elCameraVideo = document.getElementById("camera-video");
const elCameraSelect = document.getElementById("camera-select");
const elBtnToggleCamera = document.getElementById("btn-toggle-camera");
const elBtnToggleTorch = document.getElementById("btn-toggle-torch");
const elScannerStatus = document.getElementById("scanner-status");

// Import Result View Elements
const elImportResultView = document.getElementById("import-result-view");
const elInboundTripSelect = document.getElementById("inbound-trip-select");
const elBtnInboundSubFree = document.getElementById("btn-inbound-sub-free");
const elBtnInboundSubRecon = document.getElementById("btn-inbound-sub-recon");
const elInboundReconBox = document.getElementById("inbound-recon-box");
const elReconTripCode = document.getElementById("recon-trip-code");
const elBtnLoadTripManifest = document.getElementById("btn-load-trip-manifest");
const elReconSummaryGrid = document.getElementById("recon-summary-grid");
const elReconValTotal = document.getElementById("recon-val-total");
const elReconValReceived = document.getElementById("recon-val-received");
const elReconValMissing = document.getElementById("recon-val-missing");
const elBtnToggleMissingDrawer = document.getElementById("btn-toggle-missing-drawer");
const elMissingDrawer = document.getElementById("missing-drawer");
const elMissingDrawerCount = document.getElementById("missing-drawer-count");
const elMissingPkgsList = document.getElementById("missing-pkgs-list");

const elImportChuteBox = document.getElementById("import-chute-box");
const elImportChuteCode = document.getElementById("import-chute-code");
const elImportStoreName = document.getElementById("import-store-name");
const elImportDoNumber = document.getElementById("import-do-number");
const elImportPkgProgress = document.getElementById("import-pkg-progress");
const elImportPkgCode = document.getElementById("import-pkg-code");
const elImportTripCode = document.getElementById("import-trip-code");
const elImportVerdict = document.getElementById("import-verdict");

// Export Result View Elements
const elExportResultView = document.getElementById("export-result-view");
const elExportStoreCard = document.getElementById("export-store-card");
const elExportActiveStoreDisplay = document.getElementById("export-active-store-display");
const elExportActiveVehicleDisplay = document.getElementById("export-active-vehicle-display");
const elExportActiveDoList = document.getElementById("export-active-do-list");
const elExportProgressText = document.getElementById("export-progress-text");
const elExportProgressBar = document.getElementById("export-progress-bar");
const elExportVerdict = document.getElementById("export-verdict");
const elExportLastPkgStore = document.getElementById("export-last-pkg-store");
const elExportLastPkgDo = document.getElementById("export-last-pkg-do");
const elExportLastPkgIdx = document.getElementById("export-last-pkg-idx");

// History Table Elements
const elHistoryLogBody = document.getElementById("history-log-body");
const elBtnExport = document.getElementById("btn-export");
const elBtnClearHistory = document.getElementById("btn-clear-history");

// Floating Feedback Toast for Operator Notifications
function showToast(message, type = "info", duration = 3000) {
    const existing = document.getElementById("wcm-app-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "wcm-app-toast";
    toast.className = `wcm-toast ${type === "warning" ? "toast-warning" : ""}`;
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translate(-50%, 10px)";
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
// Live Scanner Top Alert & Camera HUD Elements (Zero Scrolling)
const elScannerLiveAlert = document.getElementById("scanner-live-alert");
const elLiveAlertIcon = document.getElementById("live-alert-icon");
const elLiveAlertTitle = document.getElementById("live-alert-title");
const elLiveAlertSub = document.getElementById("live-alert-sub");
const elCameraHudAlert = document.getElementById("camera-hud-alert");
const elCameraHudIcon = document.getElementById("camera-hud-icon");
const elCameraHudText = document.getElementById("camera-hud-text");

function setScannerLiveAlert({ type = "idle", title = "", subtitle = "", icon = "⚡" }) {
    if (!elScannerLiveAlert) return;

    elScannerLiveAlert.className = `scanner-live-alert alert-${type}`;
    if (elLiveAlertIcon) elLiveAlertIcon.textContent = icon;
    if (elLiveAlertTitle) elLiveAlertTitle.innerHTML = title;
    if (elLiveAlertSub) elLiveAlertSub.innerHTML = subtitle;

    // Update Camera HUD if camera is active
    if (elCameraHudAlert) {
        if (type === "idle") {
            elCameraHudAlert.style.display = "none";
        } else {
            elCameraHudAlert.style.display = "flex";
            elCameraHudAlert.className = `camera-hud-alert hud-${type}`;
            if (elCameraHudIcon) elCameraHudIcon.textContent = icon;
            const plainTitle = title.replace(/<[^>]*>/g, '').trim();
            if (elCameraHudText) elCameraHudText.textContent = plainTitle.substring(0, 36);
        }
    }

    // Auto-scroll to top smoothly if operator was scrolled far down
    if (type !== "idle") {
        const rect = elScannerLiveAlert.getBoundingClientRect();
        if (rect.top < 0) {
            elScannerLiveAlert.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }
}
window.setScannerLiveAlert = setScannerLiveAlert;

// =============================================================================
// INITIALIZATION
// =============================================================================
window.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadRecentStores();
    loadStoredState();
    loadMasterDispatch();
    loadMasterStores();
    initEventListeners();
    initSpeechSynthesis();
    tryPreloadLocalSheet();
    extractQueryTripList();
    renderRecentStoreChips();
    if (window.WCM_AUTH) {
        window.WCM_AUTH.applyRoleUI();
    }
    triggerFocus();

    // Dismiss Bootstrap Splash Screen smoothly
    setTimeout(() => {
        const splash = document.getElementById("app-splash-screen");
        if (splash) {
            splash.style.opacity = "0";
            splash.style.visibility = "hidden";
            setTimeout(() => splash.remove(), 400);
        }
    }, 350);
});

// Load settings from LocalStorage
function loadSettings() {
    const saved = localStorage.getItem("wcm_backup_settings");
    if (saved) {
        try { settings = { ...settings, ...JSON.parse(saved) }; } catch (e) {}
    }
    elChkTts.checked = settings.ttsEnabled;
    elChkBeep.checked = settings.soundEnabled;
    elChkVibrate.checked = settings.vibrateEnabled;
    elChkAutoFocus.checked = settings.autoFocusEnabled;
    
    switchMode(settings.scanMode || "Nhập", false);
}

function saveSettings() {
    localStorage.setItem("wcm_backup_settings", JSON.stringify(settings));
}

// Load session state & store mappings
function loadStoredState() {
    // 1. Synchronous read from localStorage for instant render
    const savedDict = localStorage.getItem("wcm_store_dictionary");
    if (savedDict) {
        try {
            storeMap = JSON.parse(savedDict);
            const count = Object.keys(storeMap.byDo || {}).length;
            if (count > 0) {
                elSyncText.textContent = `Offline: Đã nạp ${count} đơn chốt`;
            }
        } catch (e) {}
    }

    const savedStoreProg = localStorage.getItem("wcm_store_progress_map");
    if (savedStoreProg) {
        try { storeProgressMap = JSON.parse(savedStoreProg) || {}; } catch (e) { storeProgressMap = {}; }
    }

    const savedImport = localStorage.getItem("wcm_import_keys");
    if (savedImport) {
        try { importScannedKeys = new Set(JSON.parse(savedImport)); } catch (e) {}
    }

    let restoredExport = false;
    const savedExport = localStorage.getItem("wcm_export_state");
    if (savedExport) {
        try {
            const parsedExport = JSON.parse(savedExport);
            const ageMs = Date.now() - (parsedExport.lastActiveAt || 0);
            // If session is older than 12 hours and had active batch, prompt operator
            if (parsedExport.isBatchActive && ageMs > 12 * 3600 * 1000) {
                setTimeout(() => {
                    if (confirm(`Phát hiện lô xuất [${parsedExport.targetStore || 'Đang quét'}] từ ca trước (>12h). Bạn muốn tiếp tục quét lô này không?\n\n(Bấm OK để tiếp tục, Cancel để bắt đầu lô mới)`)) {
                        exportState = { ...exportState, ...parsedExport };
                        updateExportUI();
                        showToast("↩️ Đã khôi phục lô xuất trước đó", "info");
                    } else {
                        clearExportBatch();
                        showToast("✨ Đã tạo phiên làm việc mới", "info");
                    }
                }, 400);
            } else {
                exportState = { ...exportState, ...parsedExport };
                updateExportUI();
                if (exportState.isBatchActive) restoredExport = true;
            }
        } catch (e) {}
    }

    // Load Inbound Reconciliation State
    let restoredInbound = false;
    const savedRecon = localStorage.getItem("wcm_inbound_recon_state");
    if (savedRecon) {
        try {
            const parsedRecon = JSON.parse(savedRecon);
            if (parsedRecon && parsedRecon.isActive) {
                inboundReconState.isActive = true;
                inboundReconState.tripCode = parsedRecon.tripCode || "";
                inboundReconState.totalExported = parsedRecon.totalExported || 0;
                inboundReconState.manifestList = parsedRecon.manifestList || [];
                inboundReconState.manifestMap = new Map(parsedRecon.manifestMap || []);
                inboundReconState.inboundScannedKeys = new Set(parsedRecon.inboundScannedKeys || []);
                inboundReconState.missingKeys = new Set(parsedRecon.missingKeys || []);
                inboundReconState.extraScannedList = parsedRecon.extraScannedList || [];

                if (elInboundReconBox) elInboundReconBox.style.display = "block";
                if (elBtnInboundSubRecon) elBtnInboundSubRecon.classList.add("active");
                if (elBtnInboundSubFree) elBtnInboundSubFree.classList.remove("active");
                if (elReconTripCode) elReconTripCode.value = parsedRecon.tripCode;
                updateInboundReconUI();
                restoredInbound = true;
            }
        } catch (e) {}
    }

    const savedHistory = localStorage.getItem("wcm_backup_history");
    if (savedHistory) {
        try { scanHistory = JSON.parse(savedHistory); } catch (e) {}
    }
    renderHistory();

    if (restoredExport || restoredInbound) {
        setTimeout(() => showToast("↩️ Đã khôi phục phiên làm việc trước đó", "info"), 500);
    }

    // 2. Asynchronous restoration from persistent IndexedDB (in case browser cleared localStorage)
    if (window.WCM_DB && window.WCM_DB.getAppState) {
        Promise.all([
            window.WCM_DB.getAppState("wcm_store_dictionary"),
            window.WCM_DB.getAppState("wcm_import_keys"),
            window.WCM_DB.getAppState("wcm_export_state"),
            window.WCM_DB.getAppState("wcm_inbound_recon_state"),
            window.WCM_DB.getAppState("wcm_backup_history"),
            window.WCM_DB.getAppState("wcm_store_progress_map")
        ]).then(([idbDict, idbImport, idbExport, idbRecon, idbHistory, idbStoreProg]) => {
            let needsRerender = false;
            if (idbDict && Object.keys(storeMap.byDo || {}).length === 0) {
                storeMap = idbDict;
                const count = Object.keys(storeMap.byDo || {}).length;
                if (count > 0) elSyncText.textContent = `Offline (IDB): Đã nạp ${count} đơn chốt`;
            }
            if (idbStoreProg && Object.keys(storeProgressMap).length === 0) {
                storeProgressMap = idbStoreProg || {};
            }
            if (idbImport && importScannedKeys.size === 0 && Array.isArray(idbImport)) {
                importScannedKeys = new Set(idbImport);
            }
            if (idbExport && !exportState.targetStore && idbExport.targetStore) {
                exportState = { ...exportState, ...idbExport };
                updateExportUI();
            }
            if (idbRecon && !inboundReconState.isActive && idbRecon.isActive) {
                inboundReconState.isActive = true;
                inboundReconState.tripCode = idbRecon.tripCode || "";
                inboundReconState.totalExported = idbRecon.totalExported || 0;
                inboundReconState.manifestList = idbRecon.manifestList || [];
                inboundReconState.manifestMap = new Map(idbRecon.manifestMap || []);
                inboundReconState.inboundScannedKeys = new Set(idbRecon.inboundScannedKeys || []);
                inboundReconState.missingKeys = new Set(idbRecon.missingKeys || []);
                inboundReconState.extraScannedList = idbRecon.extraScannedList || [];
                if (elInboundReconBox) elInboundReconBox.style.display = "block";
                if (elBtnInboundSubRecon) elBtnInboundSubRecon.classList.add("active");
                if (elBtnInboundSubFree) elBtnInboundSubFree.classList.remove("active");
                if (elReconTripCode) elReconTripCode.value = idbRecon.tripCode;
                updateInboundReconUI();
            }
            if (idbHistory && scanHistory.length === 0 && Array.isArray(idbHistory)) {
                scanHistory = idbHistory;
                needsRerender = true;
            }
            if (needsRerender) {
                renderHistory();
            }
        }).catch(() => {});
    }
}

function saveStoredState() {
    exportState.lastActiveAt = Date.now();
    if (exportState.targetStoreCode) {
        storeProgressMap[exportState.targetStoreCode] = exportState.scannedItems || [];
    }
    const importKeysArr = Array.from(importScannedKeys);
    localStorage.setItem("wcm_import_keys", JSON.stringify(importKeysArr));
    localStorage.setItem("wcm_export_state", JSON.stringify(exportState));
    localStorage.setItem("wcm_backup_history", JSON.stringify(scanHistory));
    localStorage.setItem("wcm_store_progress_map", JSON.stringify(storeProgressMap));

    // Serialize inboundReconState if active
    let serializedRecon = null;
    if (inboundReconState.isActive) {
        serializedRecon = {
            isActive: true,
            tripCode: inboundReconState.tripCode,
            totalExported: inboundReconState.totalExported,
            manifestList: inboundReconState.manifestList,
            manifestMap: Array.from(inboundReconState.manifestMap.entries()),
            inboundScannedKeys: Array.from(inboundReconState.inboundScannedKeys),
            missingKeys: Array.from(inboundReconState.missingKeys),
            extraScannedList: inboundReconState.extraScannedList,
            lastActiveAt: Date.now()
        };
        localStorage.setItem("wcm_inbound_recon_state", JSON.stringify(serializedRecon));
    } else {
        localStorage.removeItem("wcm_inbound_recon_state");
    }

    // Dual-write to IndexedDB for persistent storage
    if (window.WCM_DB && window.WCM_DB.setAppState) {
        window.WCM_DB.setAppState("wcm_import_keys", importKeysArr);
        window.WCM_DB.setAppState("wcm_export_state", exportState);
        window.WCM_DB.setAppState("wcm_backup_history", scanHistory);
        window.WCM_DB.setAppState("wcm_store_progress_map", storeProgressMap);
        if (serializedRecon) {
            window.WCM_DB.setAppState("wcm_inbound_recon_state", serializedRecon);
        }
    }
}

// =============================================================================
// MASTER DISPATCH ENGINE (FILE KHO TỔNG CHỐT: File mẫu.xlsb / .xlsx / .csv)
// =============================================================================
async function loadMasterDispatch() {
    let loadedPayload = null;

    // 1. Check localStorage / IndexedDB for previously uploaded Master Dispatch
    try {
        const savedStr = localStorage.getItem("wcm_master_dispatch_data");
        if (savedStr) {
            const parsed = JSON.parse(savedStr);
            if (parsed && Array.isArray(parsed.records) && parsed.records.length > 0) {
                loadedPayload = parsed;
            }
        }
    } catch (e) {}

    if (!loadedPayload && window.WCM_DB && window.WCM_DB.getAppState) {
        try {
            const idbData = await window.WCM_DB.getAppState("wcm_master_dispatch_data");
            if (idbData && Array.isArray(idbData.records) && idbData.records.length > 0) {
                loadedPayload = idbData;
            }
        } catch (e) {}
    }

    // 2. Fetch built-in master_dispatch_data.json (generated from File mẫu.xlsb)
    if (!loadedPayload) {
        try {
            const res = await fetch("master_dispatch_data.json?v=" + Date.now());
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.records) && data.records.length > 0) {
                    loadedPayload = data;
                }
            }
        } catch (err) {
            console.warn("[MasterDispatch] Không thể tải master_dispatch_data.json:", err);
        }
    }

    if (loadedPayload) {
        buildMasterDispatchIndex(loadedPayload, false);
    }

    // 3. Check Google Sheets in background for any newer Master Dispatch uploaded by Admin
    if (window.OnlineSync && window.OnlineSync.fetchMasterDispatch && navigator.onLine) {
        window.OnlineSync.fetchMasterDispatch().then(remoteDispatch => {
            const remoteRecords = remoteDispatch ? (remoteDispatch.records || remoteDispatch.rows) : null;
            if (remoteDispatch && Array.isArray(remoteRecords) && remoteRecords.length > 0) {
                const localTime = masterDispatch.updatedAt ? new Date(masterDispatch.updatedAt).getTime() : 0;
                const remoteTime = remoteDispatch.updatedAt ? new Date(remoteDispatch.updatedAt).getTime() : 0;
                if (remoteTime > localTime || masterDispatch.totalRows === 0) {
                    buildMasterDispatchIndex({
                        sourceFile: remoteDispatch.sourceFile || remoteDispatch.fileName || "File Kho Tổng Chốt (Cloud)",
                        updatedAt: remoteDispatch.updatedAt,
                        records: remoteRecords
                    }, true);
                    showToast(`📲 Đã tự động đồng bộ File Kho Tổng Chốt: ${remoteDispatch.sourceFile || remoteDispatch.fileName || 'Mới nhất'} (${remoteRecords.length} DO)`, "success");
                }
            }
        }).catch(() => {});
    }
}

function buildMasterDispatchIndex(payload, persist = true) {
    const records = payload ? (payload.records || payload.rows) : null;
    if (!Array.isArray(records) || records.length === 0) return;

    const byDo = {};
    const bySo = {};
    const byStore = {};
    const bySttCh = {};
    const lots = {};
    let totalAllPackages = 0;

    storeMap.byDo = storeMap.byDo || {};
    storeMap.byDoCode = storeMap.byDoCode || {};
    storeMap.bySap = storeMap.bySap || {};
    storeMap.byCh = storeMap.byCh || {};
    storeMap.trips = {};

    records.forEach(rec => {
        const doNum = String(rec.doNumber || "").trim().replace(/\.0$/, "");
        const soNum = String(rec.soNumber || "").trim().toUpperCase();
        const storeCode = String(rec.storeCode || "").trim().toUpperCase();
        const storeName = String(rec.storeName || "").trim();
        const pkgCount = Math.max(1, parseInt(rec.pkgCount !== undefined ? rec.pkgCount : rec.packages, 10) || 1);
        const pcsQty = parseInt(rec.pcsQty !== undefined ? rec.pcsQty : rec.qtyPcs, 10) || 0;
        const lotCode = String(rec.lotCode || "").trim().replace(/\.0$/, "");
        const bks = String(rec.bks || "").trim().toUpperCase();
        const driver = String(rec.driver || "").trim();
        const tonnage = String(rec.tonnage || "").trim();
        const sttCh = String(rec.sttCh || "").trim().replace(/\.0$/, "");
        const province = String(rec.province || "").trim();
        const district = String(rec.district || "").trim();
        const note = String(rec.note || "").trim();

        const tripCode = bks || lotCode || "CHUNG";
        const vehicleLabel = bks && lotCode
            ? `${bks} (Lot ${lotCode})`
            : (bks ? `${bks}` : (lotCode ? `Lot ${lotCode}` : "Chuyến kho tổng"));

        const cleanRec = {
            doNumber: doNum,
            soNumber: soNum,
            storeCode: storeCode,
            storeName: storeName,
            pkgCount: pkgCount,
            packages: pkgCount,
            pcsQty: pcsQty,
            qtyPcs: pcsQty,
            lotCode: lotCode,
            bks: bks,
            driver: driver,
            tonnage: tonnage,
            tripCode: tripCode,
            vehicleLabel: vehicleLabel,
            sttCh: sttCh,
            province: province,
            district: district,
            note: note
        };

        totalAllPackages += pkgCount;

        if (doNum) {
            byDo[doNum] = cleanRec;
            if (storeName) storeMap.byDo[doNum] = storeName;
            if (storeCode) storeMap.byDoCode[doNum] = storeCode;
        }
        if (soNum) {
            bySo[soNum] = cleanRec;
        }

        if (storeCode) {
            if (storeName) {
                storeMap.bySap[storeCode] = storeName;
                storeMap.byCh[`CH.${storeCode}`] = storeName;
            }

            if (!byStore[storeCode]) {
                byStore[storeCode] = {
                    storeCode: storeCode,
                    storeName: storeName,
                    sttCh: sttCh,
                    province: province,
                    district: district,
                    lotCode: lotCode,
                    bks: bks,
                    driver: driver,
                    tonnage: tonnage,
                    tripCode: tripCode,
                    vehicleLabel: vehicleLabel,
                    totalPackages: 0,
                    totalPcs: 0,
                    totalDos: 0,
                    doList: [],
                    dos: []
                };
            }
            const stObj = byStore[storeCode];
            if (!stObj.bks && bks) {
                stObj.bks = bks;
                stObj.tripCode = bks;
                stObj.vehicleLabel = lotCode ? `${bks} (Lot ${lotCode})` : `${bks}`;
            }
            stObj.totalPackages += pkgCount;
            stObj.totalPcs += pcsQty;
            const doEntry = {
                doNumber: doNum,
                soNumber: soNum,
                pkgCount: pkgCount,
                packages: pkgCount,
                pcsQty: pcsQty,
                qtyPcs: pcsQty,
                note: note
            };
            stObj.doList.push(doEntry);
            stObj.dos.push(doEntry);
            stObj.totalDos = stObj.dos.length;

            if (sttCh) {
                bySttCh[sttCh] = stObj;
                bySttCh[`CH.${sttCh}`] = stObj;
                bySttCh[`STT.${sttCh}`] = stObj;
                if (storeName) storeMap.byCh[`CH.${sttCh}`] = storeName;
            }

            // Populate trip stores map
            if (tripCode) {
                storeMap.trips[tripCode] = storeMap.trips[tripCode] || {};
                storeMap.trips[tripCode][storeCode] = {
                    storeCode: storeCode,
                    storeName: storeName,
                    totalQty: stObj.totalPackages,
                    totalPackages: stObj.totalPackages,
                    province: province,
                    district: district,
                    sttCh: sttCh,
                    bks: stObj.bks,
                    lotCode: stObj.lotCode,
                    vehicleLabel: stObj.vehicleLabel
                };

                if (!lots[tripCode]) {
                    lots[tripCode] = {
                        tripCode: tripCode,
                        lotCode: lotCode,
                        bks: bks,
                        vehicleLabel: stObj.vehicleLabel,
                        totalPackages: 0,
                        stores: {}
                    };
                }
                lots[tripCode].totalPackages += pkgCount;
                lots[tripCode].stores[storeCode] = stObj;
            }
        }
    });

    masterDispatch = {
        sourceFile: payload.sourceFile || payload.fileName || "File mẫu.xlsb",
        updatedAt: payload.updatedAt || new Date().toISOString(),
        totalRows: records.length,
        totalPackages: totalAllPackages,
        records: records,
        byDo: byDo,
        bySo: bySo,
        byStore: byStore,
        bySttCh: bySttCh,
        lots: lots
    };

    const storeCount = Object.keys(byStore).length;
    const lotCount = Object.keys(lots).length;

    if (elDispatchFileName) {
        elDispatchFileName.textContent = masterDispatch.sourceFile;
    }
    if (elDispatchFileStats) {
        elDispatchFileStats.textContent = `(${records.length} DO • ${storeCount} CH • ${totalAllPackages} kiện • ${lotCount} chuyến)`;
    }
    if (elSyncText) {
        elSyncText.textContent = `File Chốt: ${records.length} DO / ${storeCount} CH`;
    }

    if (persist) {
        const toSave = {
            sourceFile: masterDispatch.sourceFile,
            updatedAt: masterDispatch.updatedAt,
            totalRows: masterDispatch.totalRows,
            records: records
        };
        try {
            localStorage.setItem("wcm_master_dispatch_data", JSON.stringify(toSave));
            localStorage.setItem("wcm_store_dictionary", JSON.stringify(storeMap));
        } catch (e) {}
        if (window.WCM_DB && window.WCM_DB.setAppState) {
            window.WCM_DB.setAppState("wcm_master_dispatch_data", toSave);
            window.WCM_DB.setAppState("wcm_store_dictionary", storeMap);
        }
    }

    // Refresh active export batch if currently locked to a store in masterDispatch
    let activeDispatchStore = (exportState.targetStoreCode && byStore[exportState.targetStoreCode]) || null;
    if (!activeDispatchStore && exportState.targetStoreCode) {
        const cleanCode = exportState.targetStoreCode.replace(/^ch[\.\s_]*/i, "");
        if (byStore[cleanCode]) activeDispatchStore = byStore[cleanCode];
        else if (bySttCh && bySttCh[cleanCode]) activeDispatchStore = bySttCh[cleanCode];
        else if (bySttCh && bySttCh[exportState.targetStoreCode]) activeDispatchStore = bySttCh[exportState.targetStoreCode];
    }
    if (!activeDispatchStore && exportState.sttCh && bySttCh && bySttCh[exportState.sttCh]) {
        activeDispatchStore = bySttCh[exportState.sttCh];
    }

    if (exportState.isBatchActive && activeDispatchStore) {
        exportState.targetStore = activeDispatchStore.storeCode ? `[${activeDispatchStore.storeCode}] ${activeDispatchStore.storeName}` : activeDispatchStore.storeName;
        exportState.targetStoreCode = activeDispatchStore.storeCode;
        exportState.targetStoreName = activeDispatchStore.storeName;
        exportState.targetQty = activeDispatchStore.totalPackages;
        exportState.tripCode = activeDispatchStore.tripCode || exportState.tripCode;
        exportState.vehicleLabel = activeDispatchStore.vehicleLabel || exportState.vehicleLabel;
        exportState.sttCh = activeDispatchStore.sttCh;
        exportState.storeDos = activeDispatchStore.dos;
        updateExportUI();
    }

    updateStoreDropdown(exportState.tripCode);
    console.log(`[MasterDispatch] Đã nạp ${records.length} DO, ${storeCount} cửa hàng, ${totalAllPackages} kiện từ ${masterDispatch.sourceFile}`);
}

// Parse 2D array of rows from SheetJS (.xlsb / .xlsx / .xls / .csv) into Master Dispatch records
function parseMasterDispatchRows(rows, fileName) {
    if (!rows || rows.length < 2) return null;

    // Detect header row
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
        const rowStr = (rows[i] || []).map(c => String(c || "").toLowerCase()).join("|");
        if (rowStr.includes("số do") || rowStr.includes("mã siêu thị") || rowStr.includes("tên siêu thị") || rowStr.includes("mã ch") || rowStr.includes("tổng kiện")) {
            headerRowIdx = i;
            break;
        }
    }

    const headers = (rows[headerRowIdx] || []).map(h => String(h || "").trim().toLowerCase());
    const isStandardFullSheet = headers.length >= 15;
    let soIdx = isStandardFullSheet ? 2 : -1;
    let doIdx = isStandardFullSheet ? 3 : -1;
    let storeCodeIdx = isStandardFullSheet ? 4 : -1;
    let storeNameIdx = isStandardFullSheet ? 5 : -1;
    let pcsIdx = isStandardFullSheet ? 6 : -1;
    let pkgCountIdx = isStandardFullSheet ? 7 : -1;
    let provinceIdx = isStandardFullSheet ? 10 : -1;
    let districtIdx = isStandardFullSheet ? 11 : -1;
    let lotIdx = isStandardFullSheet ? 12 : -1;
    let tonnageIdx = isStandardFullSheet ? 16 : -1;
    let siteTinhIdx = isStandardFullSheet ? 17 : -1;
    let siteDoIdx = isStandardFullSheet ? 18 : -1;
    let sttChIdx = isStandardFullSheet ? 19 : -1;
    let noteIdx = isStandardFullSheet ? 21 : -1;
    let bksIdx = isStandardFullSheet ? 29 : -1;
    let driverIdx = isStandardFullSheet ? 30 : -1;

    headers.forEach((h, i) => {
        if (!h) return;
        if (h === "số so" || h === "so" || h.includes("số so") || h.includes("so number")) soIdx = i;
        else if (h === "số do" || h === "do" || h.includes("số do") || h.includes("do number")) doIdx = i;
        else if (h.includes("mã siêu thị") || h.includes("mã ch") || h.includes("mã cửa hàng") || h === "mã st" || h === "sap" || h === "store_code") storeCodeIdx = i;
        else if (h.includes("tên siêu thị") || h.includes("tên cửa hàng") || h.includes("tên ch") || h === "store_name") storeNameIdx = i;
        else if (h === "qty" || (h.includes("pcs") && !h.includes("tổng pcs")) || h === "số lượng") pcsIdx = i;
        else if ((h.includes("tổng pcs") || h.includes("số kiện") || h.includes("tổng kiện") || h.includes("tổng số kiện") || h.includes("số lượng kiện") || h === "kiện" || h === "kien" || h.includes("packages")) && !h.includes("tổng số kiện xe")) pkgCountIdx = i;
        else if ((h === "tỉnh" || h === "tỉnh") && !h.includes("site") && !h.includes("pcs")) provinceIdx = i;
        else if (h.includes("quận") || h.includes("quận") || h.includes("huyện")) districtIdx = i;
        else if (h.includes("mã giờ")) lotIdx = i;
        else if (h.includes("trọng tải")) tonnageIdx = i;
        else if (h.includes("site tỉnh") || h.includes("site tỉnh")) siteTinhIdx = i;
        else if (h.includes("site do")) siteDoIdx = i;
        else if (h.includes("số thứ tự") || h.includes("số thứ tự")) sttChIdx = i;
        else if (h.includes("ghi chú 2")) noteIdx = i;
        else if (h === "bks" || h.includes("biển số")) bksIdx = i;
        else if (h.includes("tài xế") || h.includes("lái xe")) driverIdx = i;
    });

    const cleanVal = (v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "number") {
            return Number.isInteger(v) ? String(v) : String(v);
        }
        return String(v).trim().replace(/\.0$/, "");
    };

    const records = [];
    let currentLot = "";
    let currentBks = "";
    let currentDriver = "";
    let currentTonnage = "";

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 2) continue;

        const soNum = soIdx >= 0 ? cleanVal(r[soIdx]) : "";
        const doNum = doIdx >= 0 ? cleanVal(r[doIdx]) : "";
        const storeCode = storeCodeIdx >= 0 ? cleanVal(r[storeCodeIdx]).toUpperCase() : "";
        const storeName = storeNameIdx >= 0 ? cleanVal(r[storeNameIdx]) : "";
        if (!doNum && !storeCode) continue;

        const pcsQty = pcsIdx >= 0 ? (parseInt(String(r[pcsIdx]).replace(/,/g, ""), 10) || 0) : 0;
        const pkgCount = pkgCountIdx >= 0 ? Math.max(1, parseInt(String(r[pkgCountIdx]).replace(/,/g, ""), 10) || 1) : 1;
        const prov = provinceIdx >= 0 ? cleanVal(r[provinceIdx]) : "";
        const dist = districtIdx >= 0 ? cleanVal(r[districtIdx]) : "";
        const lotCode = lotIdx >= 0 ? cleanVal(r[lotIdx]) : "";
        const tonnage = tonnageIdx >= 0 ? cleanVal(r[tonnageIdx]) : "";
        const siteTinh = siteTinhIdx >= 0 ? cleanVal(r[siteTinhIdx]) : "";
        const siteDo = siteDoIdx >= 0 ? cleanVal(r[siteDoIdx]) : "";
        const sttCh = sttChIdx >= 0 ? cleanVal(r[sttChIdx]) : "";
        const note = noteIdx >= 0 ? cleanVal(r[noteIdx]) : "";
        const rowBks = bksIdx >= 0 ? cleanVal(r[bksIdx]).toUpperCase() : "";
        const rowDriver = driverIdx >= 0 ? cleanVal(r[driverIdx]) : "";

        if (lotCode !== currentLot) {
            currentLot = lotCode;
            currentBks = rowBks;
            currentDriver = rowDriver;
            currentTonnage = tonnage;
        } else {
            if (rowBks) {
                currentBks = rowBks;
                currentDriver = rowDriver;
            }
            if (tonnage) {
                currentTonnage = tonnage;
            }
        }

        records.push({
            soNumber: soNum,
            doNumber: doNum,
            storeCode: storeCode,
            storeName: storeName,
            pcsQty: pcsQty,
            pkgCount: pkgCount,
            province: prov,
            district: dist,
            lotCode: lotCode,
            tonnage: currentTonnage,
            siteTinh: siteTinh,
            siteDo: siteDo,
            sttCh: sttCh,
            note: note,
            bks: currentBks,
            driver: currentDriver
        });
    }

    if (records.length === 0) return null;

    return {
        sourceFile: fileName || "File Kho Tổng Chốt",
        updatedAt: new Date().toISOString(),
        totalRows: records.length,
        records: records
    };
}

function applyParsedMasterDispatchPayload(payload, fileName) {
    if (payload && Array.isArray(payload.records) && payload.records.length > 0) {
        buildMasterDispatchIndex(payload, true);
        if (window.OnlineSync && window.OnlineSync.uploadMasterDispatch) {
            window.OnlineSync.uploadMasterDispatch(payload);
        }
        const storeCount = Object.keys(masterDispatch.byStore).length;
        const lotCount = Object.keys(masterDispatch.lots).length;
        showToast(`✅ Đã nạp ${payload.records.length} DO (${storeCount} CH) từ ${fileName}`, "success");
        speakText(`Đã nạp file kho tổng chốt, gồm ${storeCount} cửa hàng`);
        alert(`✅ ĐÃ NẠP FILE KHO TỔNG CHỐT THÀNH CÔNG!\n\n📄 Tên file: ${fileName}\n📦 Tổng số đơn (DO): ${payload.records.length} đơn\n🏪 Tổng số cửa hàng: ${storeCount} siêu thị\n🔢 Tổng số kiện: ${masterDispatch.totalPackages} kiện\n🚛 Số chuyến / Lot: ${lotCount} chuyến\n\n👉 Bây giờ nhân viên chỉ cần BẮN THẲNG MÃ KIỆN, hệ thống sẽ tự động khóa Cửa hàng + Xe + Tổng số kiện!`);
    } else {
        alert("Không tìm thấy dữ liệu đơn hàng hợp lệ (Số DO / Mã siêu thị) trong file đã chọn.");
    }
}

function ensureXlsxLibraryReady() {
    if (typeof XLSX !== "undefined") return Promise.resolve(true);
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "xlsx.full.min.js?v=20261013_fix";
        script.onload = () => resolve(typeof XLSX !== "undefined");
        script.onerror = () => {
            const cdnScript = document.createElement("script");
            cdnScript.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            cdnScript.onload = () => resolve(typeof XLSX !== "undefined");
            cdnScript.onerror = () => resolve(false);
            document.head.appendChild(cdnScript);
        };
        document.head.appendChild(script);
    });
}

async function parseMasterDispatchOnMainThread(arrayBuffer, fileName) {
    try {
        const ready = await ensureXlsxLibraryReady();
        if (!ready || typeof XLSX === "undefined") {
            throw new Error("Không thể tải thư viện đọc file Excel (XLSX). Vui lòng tải lại trang (Ctrl + F5)!");
        }
        const data = new Uint8Array(arrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const targetSheetName = wb.SheetNames.find(n => n.toLowerCase() === "total") || wb.SheetNames[0];
        const sheet = wb.Sheets[targetSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const payload = parseMasterDispatchRows(rows, fileName);
        applyParsedMasterDispatchPayload(payload, fileName);
    } catch (err) {
        console.error("[MasterDispatch] Lỗi đọc file:", err);
        alert("Lỗi đọc file kho tổng chốt: " + err.message);
    }
}

function handleMasterDispatchFileUpload(file) {
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();

    if (elDispatchFileStats) {
        elDispatchFileStats.textContent = "(⏳ Đang xử lý file trên luồng ngầm...)";
    }

    if (typeof XLSX !== "undefined" || typeof Worker !== "undefined") {
        const reader = new FileReader();
        reader.onload = (event) => {
            const buffer = event.target.result;
            // Try Web Worker first (Software Architect recommendation: non-blocking UI)
            if (typeof Worker !== "undefined" && location.protocol !== "file:") {
                try {
                    const worker = new Worker("xlsb-worker.js");
                    const fallbackCopy = buffer.slice(0);
                    worker.onmessage = (e) => {
                        worker.terminate();
                        const res = e.data || {};
                        if (res.status === "SUCCESS" && res.payload) {
                            console.log(`[XLSB-Worker] Phân tích hoàn tất trong ${res.elapsedMs}ms`);
                            applyParsedMasterDispatchPayload(res.payload, file.name);
                        } else {
                            parseMasterDispatchOnMainThread(fallbackCopy, file.name);
                        }
                    };
                    worker.onerror = () => {
                        worker.terminate();
                        parseMasterDispatchOnMainThread(fallbackCopy, file.name);
                    };
                    worker.postMessage({
                        action: "PARSE_XLSB_BUFFER",
                        buffer: buffer,
                        fileName: file.name
                    }, [buffer]);
                    return;
                } catch (wErr) {
                    console.warn("[MasterDispatch] Web Worker fallback:", wErr);
                }
            }
            parseMasterDispatchOnMainThread(buffer, file.name);
        };
        reader.readAsArrayBuffer(file);
    } else if (ext === "csv") {
        const reader = new FileReader();
        reader.onload = (event) => {
            parseCSVIntoDictionary(event.target.result);
            alert(`Đã nạp danh mục CSV thành công! Nhận diện ${Object.keys(storeMap.byDo).length} đơn/cửa hàng.`);
        };
        reader.readAsText(file, "utf-8");
    } else {
        alert("Thư viện đọc Excel (.xlsb/.xlsx) chưa sẵn sàng. Vui lòng tải lại trang!");
    }
}

// Try reading local sheet.csv if served by local server (optional fallback)
function tryPreloadLocalSheet() {
    if (location.protocol === "file:") return;
    if (masterDispatch.totalRows > 0 || Object.keys(storeMap.byDo).length > 0) return;

    fetch("sheet.csv?t=" + Date.now())
        .then(res => res.ok ? res.text() : Promise.reject("no local file"))
        .then(csvText => {
            if (masterDispatch.totalRows === 0) {
                parseCSVIntoDictionary(csvText);
            }
        })
        .catch(() => {});
}

// Nạp danh mục 5.145 cửa hàng từ stores_data.json (Vinmart update 15.8)
async function loadMasterStores() {
    try {
        let stores = null;
        if (window.WCM_DB && window.WCM_DB.getAppState) {
            stores = await window.WCM_DB.getAppState("wcm_master_stores");
        }

        if (!stores || !Array.isArray(stores) || stores.length === 0) {
            const res = await fetch("stores_data.json?v=15.8");
            if (res.ok) {
                stores = await res.json();
                if (window.WCM_DB && window.WCM_DB.setAppState) {
                    window.WCM_DB.setAppState("wcm_master_stores", stores);
                }
            }
        }

        if (stores && Array.isArray(stores) && stores.length > 0) {
            masterStoreList = stores;
            storeMap.bySap = storeMap.bySap || {};
            stores.forEach(s => {
                if (s.code && s.name) {
                    storeMap.bySap[s.code] = s.name;
                }
            });
            console.log(`[WCM] Đã nạp ${masterStoreList.length} cửa hàng Master (Vinmart update 15.8)`);
            updateStoreDropdown(exportState.tripCode);
        }
    } catch (err) {
        console.warn("[WCM] Không thể tải stores_data.json:", err);
    }
}

// Lấy danh sách cửa hàng theo bộ lọc tỉnh / khu vực
function getStoresForProvinceFilter(filter) {
    if (!masterStoreList || masterStoreList.length === 0) return [];
    if (filter === "ALL_VN") {
        return masterStoreList;
    }
    if (filter === "ALL_TAY_BAC") {
        return masterStoreList.filter(s => s.isTayBac || (s.prio && s.prio <= 7));
    }
    return masterStoreList.filter(s => s.province === filter);
}

const PRESET_TRIP_STORES = {
    "1392": [
        { storeCode: "2AFF", storeName: "WM+ PTO Khu 5, Xuân Lộc", totalQty: 50 },
        { storeCode: "2AIU", storeName: "WM+ PTO Khu 14, Đào Xá", totalQty: 50 },
        { storeCode: "2APX", storeName: "WM+ PTO Khu Phố, TT Thanh Thủy", totalQty: 50 },
        { storeCode: "2AKU", storeName: "WM+ PTO Khu 10, Tu Vũ", totalQty: 52 },
        { storeCode: "2BO6", storeName: "WM+ PTO Khu 1, Hoàng Xá", totalQty: 50 },
        { storeCode: "2BWV", storeName: "WM+ PTO Khu 3, Sơn Thủy", totalQty: 50 },
        { storeCode: "2ALI", storeName: "WM+ PTO Khu 8, Hoàng Xá", totalQty: 50 }
    ],
    "1405": [
        { storeCode: "3B12", storeName: "WM+ VPH Đầm Vạc, Vĩnh Yên", totalQty: 40 },
        { storeCode: "3B88", storeName: "WM+ VPH Phúc Yên", totalQty: 35 },
        { storeCode: "3C04", storeName: "WM+ VPH Tam Đảo", totalQty: 45 }
    ],
    "1420": [
        { storeCode: "HNI01", storeName: "WM+ HNI Cầu Giấy", totalQty: 60 },
        { storeCode: "HNI02", storeName: "WM+ HNI Nam Từ Liêm", totalQty: 55 }
    ]
};

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const DEFAULT_TRIP_LIST = [
    { code: "14H-020.61", label: "14H-020.61" },
    { code: "29K-079.63", label: "29K-079.63" },
    { code: "29H-958.93", label: "29H-958.93" },
    { code: "88H-053.31", label: "88H-053.31" },
    { code: "88B-044.54", label: "88B-044.54" },
    { code: "88H-029.27", label: "88H-029.27" },
    { code: "29K-136.74", label: "29K-136.74" },
    { code: "29E-107.37", label: "29E-107.37" },
    { code: "19H-206.14", label: "19H-206.14" },
    { code: "88H-014.82", label: "88H-014.82" },
    { code: "88H-006.07", label: "88H-006.07" }
];

const STORAGE_KEY_TRIP_LIST = "wcm_custom_trip_list";

function getCustomTripList() {
    const baseList = (window.WCM_CONFIG && Array.isArray(window.WCM_CONFIG.MASTER_TRIP_LIST) && window.WCM_CONFIG.MASTER_TRIP_LIST.length > 0)
        ? window.WCM_CONFIG.MASTER_TRIP_LIST
        : DEFAULT_TRIP_LIST;

    try {
        const stored = localStorage.getItem(STORAGE_KEY_TRIP_LIST);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // If stored is still the obsolete mock list (1392, 1393, 1394, 1405, 1420), upgrade to master list
                const isObsoleteMock = parsed.every(p => ["1392", "1393", "1394", "1405", "1420"].includes(p.code));
                if (isObsoleteMock) {
                    localStorage.setItem(STORAGE_KEY_TRIP_LIST, JSON.stringify(baseList));
                    return baseList.slice();
                }
                return parsed;
            }
        }
    } catch (e) {
        console.warn("[Trips] Không thể đọc danh sách xe từ LocalStorage:", e);
    }
    return baseList.slice();
}

function saveCustomTripList(trips) {
    try {
        localStorage.setItem(STORAGE_KEY_TRIP_LIST, JSON.stringify(trips));
    } catch (e) {
        console.warn("[Trips] Không thể lưu danh sách xe vào LocalStorage:", e);
    }
}

// Auto-detect & auto-store vehicle list from URL query param ?trips=... or ?set_trips=...
function extractQueryTripList() {
    try {
        const params = new URLSearchParams(window.location.search);
        const tripsParam = params.get('trips') || params.get('set_trips');
        if (tripsParam) {
            const decoded = decodeURIComponent(tripsParam);
            const parsed = parseTripsFromText(decoded.replace(/\|/g, '\n').replace(/;/g, '\n'));
            if (parsed.length > 0) {
                saveCustomTripList(parsed);
                showToast(`📲 Đã nhận ${parsed.length} xe xuất hàng từ liên kết!`, 'success');
                try {
                    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
                } catch(e) {}
                return parsed;
            }
        }
    } catch(e) {}
    return null;
}

function parseTripsFromText(rawText) {
    if (!rawText) return [];
    const lines = rawText.split(/\r?\n/);
    const result = [];
    const seen = new Set();

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith("//")) continue;

        let code = "";
        let label = line;

        // Matches: "1392 - Tuyến Phú Thọ", "1392: Tuyến Phú Thọ", "1392 | Phú Thọ", "1392\tPhú Thọ", "1392, Phú Thọ"
        // Avoid splitting hyphenated vehicle codes like XE-01, 29C-12345 by requiring whitespace around "-"
        const match = line.match(/^([^\s\:\t\|,]+)\s*(?:[\:\t\|]|\s+-\s*|\s*,\s*)\s*(.*)$/);
        if (match && match[2] && match[2].trim()) {
            code = match[1].trim();
            const desc = match[2].trim();
            label = `${code} - ${desc}`;
        } else {
            code = line.split(/\s+/)[0].trim();
            label = line;
        }

        const normKey = code.toUpperCase();
        if (code && !seen.has(normKey)) {
            seen.add(normKey);
            result.push({ code, label });
        }
    }
    return result;
}

function formatTripsToText(trips) {
    return (trips || []).map(t => t.label || t.code).join("\n");
}

function renderTripOptions(selectedTrip) {
    if (!elExportTripSelect) return;
    const trips = getCustomTripList();
    const cleanSelected = (selectedTrip || exportState.tripCode || "").trim();

    let html = `<option value="">-- Bấm chọn chuyến xe / biển số xe --</option>`;
    let found = false;

    trips.forEach(t => {
        const isMatch = cleanSelected && (t.code.toUpperCase() === cleanSelected.toUpperCase());
        if (isMatch) found = true;
        html += `<option value="${escapeHtml(t.code)}"${isMatch ? " selected" : ""}>🚛 ${escapeHtml(t.label)}</option>`;
    });

    html += `<option value="__CUSTOM__"${(!found && cleanSelected) ? " selected" : ""}>➕ Nhập mã xe khác...</option>`;
    elExportTripSelect.innerHTML = html;

    if (!found && cleanSelected) {
        if (elCustomTripWrapper) elCustomTripWrapper.style.display = "block";
        if (elExportTripCustomInput) elExportTripCustomInput.value = cleanSelected;
        if (elExportTripSelect) elExportTripSelect.value = "__CUSTOM__";
    } else if (elExportTripSelect && elExportTripSelect.value === "__CUSTOM__") {
        if (elCustomTripWrapper) elCustomTripWrapper.style.display = "block";
    } else {
        if (elCustomTripWrapper) elCustomTripWrapper.style.display = "none";
    }
}

function isCurrentUserAdmin() {
    if (window.WCM_AUTH) {
        if (typeof window.WCM_AUTH.isAdmin === "function") {
            return window.WCM_AUTH.isAdmin();
        }
        if (typeof window.WCM_AUTH.isSuperAdmin === "function") {
            return window.WCM_AUTH.isSuperAdmin();
        }
    }
    return true;
}

function openTripConfigModal() {
    if (!isCurrentUserAdmin()) {
        alert("⚠️ Giới hạn quyền: Chỉ Quản lý / Admin mới có quyền cài đặt danh sách xe xuất hàng.");
        return;
    }
    if (!elModalTripConfig) return;
    const trips = getCustomTripList();
    if (elTripConfigTextarea) {
        elTripConfigTextarea.value = formatTripsToText(trips);
    }
    updateTripCountBadge();
    elModalTripConfig.style.display = "flex";
    if (elTripConfigTextarea) elTripConfigTextarea.focus();
}

function closeTripConfigModal() {
    if (!elModalTripConfig) return;
    elModalTripConfig.style.display = "none";
}

function updateTripCountBadge() {
    if (!elTripConfigCountBadge || !elTripConfigTextarea) return;
    const list = parseTripsFromText(elTripConfigTextarea.value);
    elTripConfigCountBadge.textContent = `${list.length} xe`;
}

function saveTripConfigFromModal() {
    if (!isCurrentUserAdmin()) {
        alert("⚠️ Giới hạn quyền: Chỉ Quản lý / Admin mới có quyền lưu danh sách xe.");
        return;
    }
    if (!elTripConfigTextarea) return;
    const parsedTrips = parseTripsFromText(elTripConfigTextarea.value);
    if (parsedTrips.length === 0) {
        alert("Vui lòng nhập ít nhất 1 mã chuyến xe hoặc biển số xe.");
        return;
    }

    saveCustomTripList(parsedTrips);
    closeTripConfigModal();

    // Select the first trip or keep current if still valid
    const currentCode = exportState.tripCode || "";
    const exists = parsedTrips.some(t => t.code.toUpperCase() === currentCode.toUpperCase());
    const newActiveCode = exists ? currentCode : parsedTrips[0].code;

    renderTripOptions(newActiveCode);
    onTripChanged(newActiveCode);

    showToast(`Đã lưu thành công ${parsedTrips.length} xe xuất hàng!`);
}

function removeVietnameseTones(str) {
    if (!str) return "";
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    return str.toLowerCase().trim();
}

function loadRecentStores() {
    try {
        const saved = localStorage.getItem("wcm_recent_stores");
        if (saved) recentStores = JSON.parse(saved);
    } catch(e) {
        recentStores = [];
    }
}

function saveRecentStores() {
    try {
        localStorage.setItem("wcm_recent_stores", JSON.stringify(recentStores.slice(0, 5)));
        if (window.WCM_DB && window.WCM_DB.setAppState) {
            window.WCM_DB.setAppState("wcm_recent_stores", recentStores.slice(0, 5));
        }
    } catch(e) {}
}

function addRecentStore(storeCode, storeName, qty) {
    if (!storeCode) return;
    recentStores = recentStores.filter(s => s.storeCode !== storeCode);
    recentStores.unshift({ storeCode, storeName, qty: qty || 50, timestamp: Date.now() });
    if (recentStores.length > 5) recentStores.length = 5;
    saveRecentStores();
    renderRecentStoreChips();
}

function renderRecentStoreChips() {
    if (!elRecentStoresContainer || !elRecentStoresList) return;
    if (!recentStores || recentStores.length === 0) {
        elRecentStoresContainer.style.display = "none";
        return;
    }

    elRecentStoresList.innerHTML = "";
    recentStores.slice(0, 3).forEach(s => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "recent-store-chip";
        chip.innerHTML = `<span>⚡ CH.${s.storeCode} (${s.qty}k)</span>`;
        chip.title = `${s.storeName} (${s.qty} kiện)`;
        chip.addEventListener("click", () => {
            selectStoreAndApply(s.storeCode, s.storeName, s.qty);
        });
        elRecentStoresList.appendChild(chip);
    });
    elRecentStoresContainer.style.display = "flex";
}

function selectStoreAndApply(storeCode, storeName, qty) {
    const cleanCode = (storeCode || "").trim().toUpperCase();
    const dispatchStore = (masterDispatch && masterDispatch.byStore && cleanCode) ? masterDispatch.byStore[cleanCode] : null;

    if (dispatchStore) {
        lockStoreBatch(dispatchStore, { announce: true });
        addRecentStore(dispatchStore.storeCode, dispatchStore.storeName, dispatchStore.totalPackages);
        return;
    }

    const fullStoreName = cleanCode ? `[${cleanCode}] ${storeName}` : storeName;
    if (elExportTargetStore) elExportTargetStore.value = fullStoreName;
    if (elExportTargetQty) elExportTargetQty.value = qty || 50;

    if (elExportStoreSelect && cleanCode) {
        for (let i = 0; i < elExportStoreSelect.options.length; i++) {
            if (elExportStoreSelect.options[i].value === cleanCode) {
                elExportStoreSelect.selectedIndex = i;
                break;
            }
        }
    }

    addRecentStore(cleanCode, storeName, qty);
    applyExportBatch();
}

function renderStoreOptions(storeList, headerNote) {
    if (!elExportStoreSelect) return;
    const note = headerNote || "Bấm chọn Cửa Hàng";
    const countText = (storeList && storeList.length > 0 && !note.includes(" CH)")) ? ` (${storeList.length} CH)` : "";
    elExportStoreSelect.innerHTML = `<option value="">-- ${note}${countText} (Tự động nạp Xe & Số kiện) --</option>`;

    if (!storeList || storeList.length === 0) return;

    // Fast render limit for mobile PDA
    const displayLimit = 250;
    const displayItems = storeList.slice(0, displayLimit);

    let currentGroup = null;
    let lastProv = null;

    displayItems.forEach(st => {
        const code = st.storeCode || st.code || "";
        const name = st.storeName || st.name || "";
        const prov = st.province || "";
        const dist = st.district ? ` - ${st.district}` : "";
        const qty = st.totalPackages || st.totalQty || 50;
        const bksInfo = st.bks ? ` • Xe ${st.bks}` : (st.lotCode ? ` • Lot ${st.lotCode}` : "");
        const sttInfo = st.sttCh ? ` [CH.${st.sttCh}]` : "";

        if (prov && prov !== lastProv && storeList.length > 15) {
            lastProv = prov;
            currentGroup = document.createElement("optgroup");
            currentGroup.label = `📍 ${prov}`;
            elExportStoreSelect.appendChild(currentGroup);
        }

        const opt = document.createElement("option");
        opt.value = code;
        opt.dataset.name = name;
        opt.dataset.qty = qty;
        opt.dataset.province = prov;
        const qtySuffix = (st.totalPackages || st.totalQty) ? ` (${st.totalPackages || st.totalQty} kiện${bksInfo})` : "";
        opt.textContent = `[${code}]${sttInfo} ${name}${dist}${qtySuffix}`;

        if (currentGroup) {
            currentGroup.appendChild(opt);
        } else {
            elExportStoreSelect.appendChild(opt);
        }
    });

    if (storeList.length > displayLimit) {
        const moreOpt = document.createElement("option");
        moreOpt.disabled = true;
        moreOpt.textContent = `... còn ${storeList.length - displayLimit} CH (gõ ô tìm kiếm phía trên để lọc nhanh)`;
        elExportStoreSelect.appendChild(moreOpt);
    }
}

function getMasterDispatchStoreArray() {
    if (!masterDispatch || !masterDispatch.byStore) return [];
    return Object.values(masterDispatch.byStore);
}

function filterStoreDropdown(filterText) {
    const cleanQuery = removeVietnameseTones(filterText || "");

    if (!cleanQuery) {
        updateStoreDropdown(exportState.tripCode);
        return currentTripStores;
    }

    const dispatchStores = getMasterDispatchStoreArray();
    const sourceList = dispatchStores.length > 0
        ? dispatchStores
        : ((masterStoreList && masterStoreList.length > 0) ? masterStoreList : currentTripStores);
    
    const matched = sourceList.filter(st => {
        const code = removeVietnameseTones(st.code || st.storeCode || "");
        const name = removeVietnameseTones(st.name || st.storeName || "");
        const prov = removeVietnameseTones(st.province || "");
        const dist = removeVietnameseTones(st.district || "");
        const stt = String(st.sttCh || "").toLowerCase();
        const bks = String(st.bks || st.lotCode || "").toLowerCase();
        return code.includes(cleanQuery) || name.includes(cleanQuery) || dist.includes(cleanQuery) || prov.includes(cleanQuery) || stt === cleanQuery || bks.includes(cleanQuery);
    });

    matched.sort((a, b) => {
        const aCode = (a.code || a.storeCode || "").toLowerCase();
        const bCode = (b.code || b.storeCode || "").toLowerCase();
        if (aCode === cleanQuery && bCode !== cleanQuery) return -1;
        if (bCode === cleanQuery && aCode !== cleanQuery) return 1;
        const aPrio = a.prio || 99;
        const bPrio = b.prio || 99;
        if (aPrio !== bPrio) return aPrio - bPrio;
        return (a.name || a.storeName || "").localeCompare(b.name || b.storeName || "");
    });

    currentTripStores = matched;
    renderStoreOptions(matched, `Tìm thấy ${matched.length} CH khớp "${filterText}"`);
    return matched;
}

function updateStoreDropdown(tripCode) {
    if (!elExportStoreSelect) return;
    const cleanTrip = (tripCode || "").trim();

    // Ưu tiên danh sách cửa hàng trong File Kho Tổng Chốt nếu đã nạp
    const dispatchStores = getMasterDispatchStoreArray();
    if (dispatchStores.length > 0) {
        let filteredDispatch = dispatchStores;
        let headerTitle = `File Kho Tổng Chốt (${dispatchStores.length} CH)`;
        if (selectedProvinceFilter && selectedProvinceFilter !== "ALL_TAY_BAC" && selectedProvinceFilter !== "ALL_VN") {
            const provClean = removeVietnameseTones(selectedProvinceFilter.replace(/^T\.\s*/, ''));
            filteredDispatch = dispatchStores.filter(s => removeVietnameseTones(s.province || "").includes(provClean));
            headerTitle = `${selectedProvinceFilter.replace(/^T\.\s*/, '')} - File Tổng Chốt (${filteredDispatch.length} CH)`;
        }
        currentTripStores = filteredDispatch;
        if (elExportStoreSearch) elExportStoreSearch.value = "";
        if (elBtnClearStoreSearch) elBtnClearStoreSearch.style.display = "none";
        renderStoreOptions(filteredDispatch, headerTitle);
        renderRecentStoreChips();
        return;
    }

    // 1. Get stores according to the active province filter
    const provinceStores = getStoresForProvinceFilter(selectedProvinceFilter);

    // 2. Get stores for current trip if any
    let tripStores = [];
    if (cleanTrip) {
        if (storeMap.trips && storeMap.trips[cleanTrip]) {
            tripStores = Object.values(storeMap.trips[cleanTrip]);
        } else if (PRESET_TRIP_STORES[cleanTrip]) {
            tripStores = PRESET_TRIP_STORES[cleanTrip];
        }
    }

    let combinedList = [];
    let headerTitle = "Bấm chọn Cửa Hàng";

    if (selectedProvinceFilter === "ALL_TAY_BAC") {
        headerTitle = `Khu vực Tây Bắc (${provinceStores.length || 323} CH)`;
        if (provinceStores.length > 0) {
            combinedList = provinceStores;
        } else if (tripStores.length > 0) {
            combinedList = tripStores;
        }
    } else if (selectedProvinceFilter === "ALL_VN") {
        headerTitle = "Toàn quốc (5.145 CH)";
        combinedList = (masterStoreList && masterStoreList.length > 0) ? masterStoreList : provinceStores;
    } else {
        // Specific province: Sơn La, Điện Biên, Phú Thọ, Lai Châu
        const provClean = selectedProvinceFilter.replace(/^T\.\s*/, '');
        headerTitle = `${provClean} (${provinceStores.length} CH)`;
        combinedList = provinceStores;
    }

    // Fallback if masterStoreList hasn't finished loading yet
    if (combinedList.length === 0 && tripStores.length > 0) {
        combinedList = tripStores;
        headerTitle = `Chuyến xe ${cleanTrip}`;
    }

    currentTripStores = combinedList;
    if (elExportStoreSearch) {
        elExportStoreSearch.value = "";
    }
    if (elBtnClearStoreSearch) {
        elBtnClearStoreSearch.style.display = "none";
    }

    renderStoreOptions(combinedList, headerTitle);
    renderRecentStoreChips();
}

function onTripChanged(tripCode) {
    const clean = (tripCode || "").trim();
    exportState.tripCode = clean;
    if (elExportTripCode) elExportTripCode.value = clean;
    if (window.OnlineSync) window.OnlineSync.setTripCode(clean);

    // Sync dropdown selection and custom input
    if (elExportTripSelect) {
        const trips = getCustomTripList();
        const found = trips.some(t => t.code.toUpperCase() === clean.toUpperCase());
        if (found) {
            elExportTripSelect.value = clean;
            if (elCustomTripWrapper) elCustomTripWrapper.style.display = "none";
        } else if (clean) {
            elExportTripSelect.value = "__CUSTOM__";
            if (elCustomTripWrapper) elCustomTripWrapper.style.display = "block";
            if (elExportTripCustomInput && elExportTripCustomInput.value !== clean) {
                elExportTripCustomInput.value = clean;
            }
        } else {
            elExportTripSelect.value = "";
            if (elCustomTripWrapper) elCustomTripWrapper.style.display = "none";
        }
    }

    document.querySelectorAll(".trip-chip-btn").forEach(chip => {
        if (chip.getAttribute("data-trip") === clean) {
            chip.classList.add("active");
        } else {
            chip.classList.remove("active");
        }
    });

    updateStoreDropdown(clean);
}

// =============================================================================
// EVENT LISTENERS & HARDWARE SCANNER INTEGRATION
// =============================================================================
function initEventListeners() {
    // Settings toggles
    elChkTts.addEventListener("change", (e) => {
        settings.ttsEnabled = e.target.checked;
        saveSettings();
    });

    elSelectVoice.addEventListener("change", (e) => {
        settings.preferredVoiceName = e.target.value;
        saveSettings();
        speakText("Giọng đọc đã sẵn sàng");
    });

    elChkBeep.addEventListener("change", (e) => {
        settings.soundEnabled = e.target.checked;
        saveSettings();
    });

    elChkVibrate.addEventListener("change", (e) => {
        settings.vibrateEnabled = e.target.checked;
        saveSettings();
        triggerVibrate([80]);
    });

    elChkAutoFocus.addEventListener("change", (e) => {
        settings.autoFocusEnabled = e.target.checked;
        saveSettings();
        if (settings.autoFocusEnabled) triggerFocus();
    });

    // Reset session
    elBtnResetSession.addEventListener("click", () => {
        unlockAudio();
        if (confirm("Bạn có chắc muốn XÓA DỮ LIỆU phiên quét hiện tại (tiến độ nhập/xuất của tất cả cửa hàng)? Lịch sử quét sẽ được giữ lại.")) {
            importScannedKeys.clear();
            storeProgressMap = {};
            clearExportBatch(true);
            saveStoredState();
            updateExportUI();
            resetImportVisuals();
            alert("Đã xóa dữ liệu phiên làm việc!");
        }
    });

    // File Kho Tổng Chốt upload (.xlsb, .xlsx, .xls, .csv) — Header button
    if (elCsvFileInput) {
        elCsvFileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                handleMasterDispatchFileUpload(file);
                e.target.value = "";
            }
        });
    }

    // File Kho Tổng Chốt upload (.xlsb, .xlsx, .xls, .csv) — Inline button in Export Config Box
    if (elDispatchInlineFileInput) {
        elDispatchInlineFileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                handleMasterDispatchFileUpload(file);
                e.target.value = "";
            }
        });
    }

    // Mode Switcher Buttons
    elBtnModeImport.addEventListener("click", () => {
        unlockAudio();
        switchMode("Nhập");
    });

    elBtnModeExport.addEventListener("click", () => {
        unlockAudio();
        switchMode("Xuất");
    });

    // Export Batch Buttons
    elBtnSetBatch.addEventListener("click", () => {
        unlockAudio();
        applyExportBatch();
    });

    elBtnClearBatch.addEventListener("click", () => {
        unlockAudio();
        if (exportState.isBatchActive && exportState.scannedItems.length > 0 && exportState.scannedItems.length < exportState.targetQty) {
            if (!confirm(`Cửa hàng [${exportState.targetStore}] hiện mới quét ${exportState.scannedItems.length}/${exportState.targetQty} kiện (Chưa đủ 100%).\n\nBạn có chắc muốn MỞ KHÓA để chuyển sang xếp cửa hàng tiếp theo? (Tiến độ ${exportState.scannedItems.length} kiện đã quét vẫn được lưu lại)`)) {
                return;
            }
        }
        clearExportBatch(false);
        showToast("🔓 Đã mở khóa! Hãy bắn kiện hàng của cửa hàng tiếp theo.");
        speakText("Đã mở khóa. Mời quét cửa hàng tiếp theo");
    });

    if (elExportOperatorCode) {
        if (window.OnlineSync) {
            elExportOperatorCode.value = window.OnlineSync.getOperatorCode();
        }
        elExportOperatorCode.addEventListener("input", () => {
            const val = elExportOperatorCode.value.trim();
            if (val && window.OnlineSync) {
                window.OnlineSync.setOperatorCode(val);
            }
        });
    }

    // Vehicle Selection Dropdown & Custom Trip Input
    if (elExportTripSelect) {
        elExportTripSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            if (val === "__CUSTOM__") {
                if (elCustomTripWrapper) elCustomTripWrapper.style.display = "block";
                if (elExportTripCustomInput) {
                    elExportTripCustomInput.focus();
                    if (elExportTripCustomInput.value.trim()) {
                        onTripChanged(elExportTripCustomInput.value.trim());
                    }
                }
            } else {
                if (elCustomTripWrapper) elCustomTripWrapper.style.display = "none";
                onTripChanged(val);
            }
        });
    }

    if (elExportTripCustomInput) {
        const handleCustomInput = () => {
            const customVal = elExportTripCustomInput.value.trim();
            if (elExportTripCode) elExportTripCode.value = customVal;
            exportState.tripCode = customVal;
            if (window.OnlineSync) window.OnlineSync.setTripCode(customVal);
            updateStoreDropdown(customVal);
        };
        elExportTripCustomInput.addEventListener("input", handleCustomInput);
        elExportTripCustomInput.addEventListener("change", handleCustomInput);
    }

    // Trip Configuration Modal Events
    if (elBtnOpenTripConfig) {
        elBtnOpenTripConfig.addEventListener("click", openTripConfigModal);
    }
    if (elBtnQuickConfigTrips) {
        elBtnQuickConfigTrips.addEventListener("click", openTripConfigModal);
    }
    if (elBtnCloseTripConfig) {
        elBtnCloseTripConfig.addEventListener("click", closeTripConfigModal);
    }
    if (elBtnCancelTripConfig) {
        elBtnCancelTripConfig.addEventListener("click", closeTripConfigModal);
    }
    if (elModalTripConfig) {
        elModalTripConfig.addEventListener("click", (e) => {
            if (e.target === elModalTripConfig) {
                closeTripConfigModal();
            }
        });
    }
    if (elBtnSaveTripConfig) {
        elBtnSaveTripConfig.addEventListener("click", saveTripConfigFromModal);
    }
    const elBtnShareTripsLink = document.getElementById("btn-share-trips-link");
    if (elBtnShareTripsLink) {
        elBtnShareTripsLink.addEventListener("click", () => {
            const currentText = elTripConfigTextarea ? elTripConfigTextarea.value : "";
            const trips = parseTripsFromText(currentText);
            if (trips.length === 0) {
                alert("Vui lòng nhập ít nhất 1 mã xe để chia sẻ.");
                return;
            }
            const tripText = trips.map(t => t.label || t.code).join("|");
            const shareUrl = `${window.location.origin}${window.location.pathname}?trips=${encodeURIComponent(tripText)}`;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    alert(`✅ ĐÃ SAO CHÉP LIÊN KẾT NẠP XE!\n\nLink:\n${shareUrl}\n\n👉 Bạn hãy gửi link này vào Zalo nhóm kho hoặc mở trên điện thoại. Ứng dụng điện thoại sẽ tự động nạp đủ ${trips.length} xe xuất hàng!`);
                }).catch(() => {
                    prompt("Sao chép liên kết này để mở trên điện thoại / gửi Zalo:", shareUrl);
                });
            } else {
                prompt("Sao chép liên kết này để mở trên điện thoại / gửi Zalo:", shareUrl);
            }
        });
    }
    if (elBtnLoadDefaultTrips) {
        elBtnLoadDefaultTrips.addEventListener("click", () => {
            if (elTripConfigTextarea) {
                const baseList = (window.WCM_CONFIG && Array.isArray(window.WCM_CONFIG.MASTER_TRIP_LIST) && window.WCM_CONFIG.MASTER_TRIP_LIST.length > 0)
                    ? window.WCM_CONFIG.MASTER_TRIP_LIST
                    : DEFAULT_TRIP_LIST;
                elTripConfigTextarea.value = formatTripsToText(baseList);
                updateTripCountBadge();
            }
        });
    }
    if (elTripConfigTextarea) {
        elTripConfigTextarea.addEventListener("input", updateTripCountBadge);
        elTripConfigTextarea.addEventListener("keydown", (e) => {
            e.stopPropagation();
        });
        elTripConfigTextarea.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    }

    // Legacy Trip Selectors (Chips & Input fallback)
    document.querySelectorAll(".trip-chip-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const trip = btn.getAttribute("data-trip");
            onTripChanged(trip);
        });
    });

    if (elExportTripCode) {
        elExportTripCode.addEventListener("change", () => {
            onTripChanged(elExportTripCode.value);
        });
    }

    // Smart Store Dropdown Selection (Auto fills store and target qty)
    // Smart Store Dropdown Selection (Auto fills store and target qty)
    if (elExportStoreSelect) {
        elExportStoreSelect.addEventListener("change", (e) => {
            const sel = e.target;
            const opt = sel.options[sel.selectedIndex];
            if (opt && opt.value) {
                const storeCode = opt.value;
                const storeName = opt.dataset.name || "";
                const qty = parseInt(opt.dataset.qty, 10) || 50;
                selectStoreAndApply(storeCode, storeName, qty);
            }
        });
    }

    // Quick Northwest Province Filter Chips
    document.querySelectorAll(".province-chip-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".province-chip-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            selectedProvinceFilter = btn.getAttribute("data-province");
            if (elExportStoreSearch) elExportStoreSearch.value = "";
            if (elBtnClearStoreSearch) elBtnClearStoreSearch.style.display = "none";
            updateStoreDropdown(exportState.tripCode);
        });
    });

    // Instant Store Search Input
    if (elExportStoreSearch) {
        elExportStoreSearch.addEventListener("input", (e) => {
            const val = e.target.value;
            if (elBtnClearStoreSearch) {
                elBtnClearStoreSearch.style.display = val ? "block" : "none";
            }
            filterStoreDropdown(val);
        });

        elExportStoreSearch.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const matched = filterStoreDropdown(elExportStoreSearch.value);
                if (matched && matched.length === 1) {
                    const st = matched[0];
                    selectStoreAndApply(st.storeCode, st.storeName, st.totalQty);
                } else if (matched && matched.length > 1) {
                    if (elExportStoreSelect) elExportStoreSelect.focus();
                }
            }
        });
    }

    if (elBtnClearStoreSearch) {
        elBtnClearStoreSearch.addEventListener("click", () => {
            if (elExportStoreSearch) {
                elExportStoreSearch.value = "";
                elExportStoreSearch.focus();
            }
            elBtnClearStoreSearch.style.display = "none";
            filterStoreDropdown("");
        });
    }

    // Error Recovery 1: Sửa số kiện kế hoạch của lô
    if (elBtnEditTargetQty) {
        elBtnEditTargetQty.addEventListener("click", () => {
            const current = exportState.targetQty || 0;
            const input = prompt(`Sửa số kiện kế hoạch của lô [${exportState.targetStore || ''}]:\n(Hiện tại: ${current} kiện | Đã quét: ${exportState.scannedItems.length} kiện)`, current);
            if (input !== null) {
                const val = parseInt(input.trim(), 10);
                if (!isNaN(val) && val > 0) {
                    exportState.targetQty = val;
                    saveStoredState();
                    updateExportUI();
                    speakText(`Đã đổi kế hoạch thành ${val} kiện`);
                }
            }
        });
    }

    // Error Recovery 2: Hoàn tác kiện vừa quét (Có xác nhận hoặc 1-chạm từ thanh Thumb-Zone)
    function executeUndoLastScan(skipConfirm = false) {
        if (!exportState.scannedItems || exportState.scannedItems.length === 0) return;
        const lastItem = exportState.scannedItems[exportState.scannedItems.length - 1];
        if (!skipConfirm) {
            if (!confirm(`Bạn có chắc muốn HOÀN TÁC (hủy) kiện vừa quét:\n${lastItem.uniqueKey} (${lastItem.storeName || (lastItem.pkg && lastItem.pkg.storeName) || ''})?`)) {
                return;
            }
        }
        exportState.scannedItems.pop();
        exportState.isBatchCompleted = false;
        saveCurrentStoreProgress();
        saveStoredState();
        updateExportUI();
        speakText("Đã hoàn tác kiện vừa quét");
        showToast(`↩️ Đã hoàn tác kiện: ${lastItem.uniqueKey}`);

        if (window.WCM_ERGONOMICS && window.WCM_ERGONOMICS.hideQuickUndoBar) {
            window.WCM_ERGONOMICS.hideQuickUndoBar();
        }

        if (window.OnlineSync && window.OnlineSync.undoScan) {
            window.OnlineSync.undoScan({
                tripCode: exportState.tripCode,
                packageCode: lastItem.uniqueKey
            });
        }
        triggerFocus();
    }

    window.quickUndoLastScanNoConfirm = () => executeUndoLastScan(true);

    if (elBtnUndoLastScan) {
        elBtnUndoLastScan.addEventListener("click", () => executeUndoLastScan(false));
    }

    // Bulk Undo: Scanned Packages Drawer
    if (elBtnOpenScannedDrawer) {
        elBtnOpenScannedDrawer.addEventListener("click", () => {
            openScannedPackagesDrawer();
        });
    }

    if (elBtnCloseScannedPackages) {
        elBtnCloseScannedPackages.addEventListener("click", () => {
            closeScannedPackagesDrawer();
        });
    }

    if (elInputFilterBatchPkgs) {
        elInputFilterBatchPkgs.addEventListener("input", (e) => {
            renderScannedPackagesList(e.target.value);
        });
    }

    if (elModalScannedPackages) {
        elModalScannedPackages.addEventListener("click", (e) => {
            if (e.target === elModalScannedPackages) {
                closeScannedPackagesDrawer();
            }
        });
    }

    // Trip Dashboard Modal Controls
    if (elBtnOpenTripDashboard) {
        elBtnOpenTripDashboard.addEventListener("click", () => {
            openTripDashboard();
        });
    }

    if (elBtnCloseTripDashboard) {
        elBtnCloseTripDashboard.addEventListener("click", () => {
            closeTripDashboard();
        });
    }

    if (elBtnRefreshTripDashboard) {
        elBtnRefreshTripDashboard.addEventListener("click", () => {
            fetchAndRenderTripDashboard();
        });
    }

    if (elModalTripDashboard) {
        elModalTripDashboard.addEventListener("click", (e) => {
            if (e.target === elModalTripDashboard) {
                closeTripDashboard();
            }
        });
    }

    // Batch Completion Modal Actions
    if (elBtnModalNextBatch) {
        elBtnModalNextBatch.addEventListener("click", () => {
            closeBatchCompletedModal();
            clearExportBatch(false);
            showToast("🚚 Đã mở khóa! Hãy bắn kiện đầu tiên của cửa hàng tiếp theo.");
            speakText("Mời bắn kiện đầu tiên của cửa hàng tiếp theo");
            triggerFocus();
        });
    }

    if (elBtnModalStayBatch) {
        elBtnModalStayBatch.addEventListener("click", () => {
            closeBatchCompletedModal();
            triggerFocus();
        });
    }

    if (elModalBatchCompleted) {
        elModalBatchCompleted.addEventListener("click", (e) => {
            if (e.target === elModalBatchCompleted) {
                closeBatchCompletedModal();
            }
        });
    }

    // Error Recovery 3: Điều chuyển toàn bộ kiện sang xe / cửa hàng khác
    if (elBtnReassignBatch) {
        elBtnReassignBatch.addEventListener("click", () => {
            const count = exportState.scannedItems.length;
            if (count === 0) {
                alert("Lô hiện tại chưa có kiện nào được quét để chuyển!");
                return;
            }
            const newStore = prompt(`Lô hiện tại đang có ${count} kiện đã quét cho [${exportState.targetStore}].\n\nNhập TÊN hoặc MÃ CỬA HÀNG MỚI muốn chuyển toàn bộ ${count} kiện sang:`, exportState.targetStore);
            if (newStore && newStore.trim() && newStore.trim() !== exportState.targetStore) {
                const oldStore = exportState.targetStore;
                exportState.targetStore = newStore.trim();
                exportState.scannedItems.forEach(item => item.storeName = newStore.trim());
                saveStoredState();
                updateExportUI();
                speakText(`Đã chuyển toàn bộ ${count} kiện sang ${newStore}`);

                if (window.OnlineSync && window.OnlineSync.getScriptUrl()) {
                    fetch(window.OnlineSync.getScriptUrl(), {
                        method: "POST",
                        mode: "no-cors",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "reassign_batch",
                            oldTripCode: exportState.tripCode,
                            oldStore: oldStore,
                            newStore: newStore.trim(),
                            newStoreName: newStore.trim()
                        })
                    }).catch(() => {});
                }
            }
        });
    }

    // Manual input button & Enter key
    elManualScanInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            processManualInput();
        }
    });

    elBtnSubmitScan.addEventListener("click", () => {
        unlockAudio();
        processManualInput();
    });

    // Camera and Torch Controls
    elBtnToggleCamera.addEventListener("click", () => {
        unlockAudio();
        toggleCamera();
    });

    if (elBtnToggleTorch) {
        elBtnToggleTorch.addEventListener("click", () => {
            toggleTorch();
        });
    }

    elCameraSelect.addEventListener("change", (e) => {
        const selectedId = e.target.value;
        if (isCameraRunning) {
            startCamera(selectedId);
        }
    });

    // History controls
    elBtnExport.addEventListener("click", () => exportScanReportCSV());
    elBtnClearHistory.addEventListener("click", () => {
        if (confirm("Bạn có chắc muốn xóa sạch toàn bộ lịch sử quét?")) {
            scanHistory = [];
            saveStoredState();
            renderHistory();
        }
    });

    // Inbound Trip Selector & Manifest Refresh Listener
    if (elInboundTripSelect) {
        elInboundTripSelect.addEventListener("change", () => {
            unlockAudio();
            const trip = elInboundTripSelect.value;
            loadTripManifestForInbound(trip);
        });
    }

    if (elBtnLoadTripManifest) {
        elBtnLoadTripManifest.addEventListener("click", () => {
            unlockAudio();
            const trip = elInboundTripSelect ? elInboundTripSelect.value : "ALL";
            loadTripManifestForInbound(trip);
        });
    }

    if (elBtnToggleMissingDrawer && elMissingDrawer) {
        elBtnToggleMissingDrawer.addEventListener("click", () => {
            const isShown = elMissingDrawer.style.display !== "none";
            elMissingDrawer.style.display = isShown ? "none" : "block";
        });
    }

    // OnlineSync Peer Updates Listener (Bắn 2 người cùng 1 lúc)
    if (window.OnlineSync) {
        window.OnlineSync.onPeerUpdate((data) => {
            if (exportState.isBatchActive && exportState.tripCode) {
                const myOp = window.OnlineSync.getOperatorCode();
                const peerScans = (data.peerScansList || []).filter(item => item.operator !== myOp);
                exportState.peerScannedItems = peerScans.map(item => ({ uniqueKey: item.packageCode, ...item }));
                updateExportProgress();
            }
        });
    }

    // =========================================================================
    // PDA HARDWARE SCANNER INTEGRATION (GLOBAL KEYSTROKE LISTENER)
    // =========================================================================
    // Even if user touches outside or input is blurred, bóp cò PDA still works 100%!
    let pdaKeystrokeBuffer = "";
    let lastKeyTimestamp = 0;

    document.addEventListener("keydown", (e) => {
        // 1. If typing inside elManualScanInput, its dedicated listener already processed it; ignore here to prevent double execution
        if (e.target === elManualScanInput) {
            pdaKeystrokeBuffer = "";
            return;
        }

        // 2. Never intercept if user is typing into ANY other input, textarea, select, or editable element
        const targetTag = e.target ? e.target.tagName : "";
        if (targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT" || (e.target && e.target.isContentEditable)) {
            pdaKeystrokeBuffer = "";
            return;
        }

        // 2. Never intercept if any modal, overlay, or dialog is currently open
        const openModal = document.querySelector('.pilot-modal-overlay[style*="display: flex"], .auth-overlay[style*="display: flex"], .auth-card');
        if (openModal) {
            pdaKeystrokeBuffer = "";
            return;
        }

        const now = Date.now();

        if (e.key === "Enter") {
            if (pdaKeystrokeBuffer.trim().length > 0) {
                e.preventDefault();
                unlockAudio();
                const code = pdaKeystrokeBuffer.trim();
                pdaKeystrokeBuffer = "";
                elManualScanInput.value = "";
                handleBarcodeScanned(code);
                triggerFocus();
            }
            return;
        }

        // Only buffer printable single characters (ignore function keys, ctrl, alt, meta)
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (now - lastKeyTimestamp > 500) {
                // New scan sequence initiated
                pdaKeystrokeBuffer = e.key;
            } else {
                pdaKeystrokeBuffer += e.key;
            }
            lastKeyTimestamp = now;
        }
    });

    // Keep focus on scan input for desktop / gun
    document.addEventListener("click", (e) => {
        if (!settings.autoFocusEnabled) return;

        // If click is inside any modal, popup, or overlay, NEVER steal focus!
        if (e.target.closest('.pilot-modal-overlay, .pilot-modal, .auth-overlay, .auth-card, .audio-settings-details, .audio-settings-popover, #modal-trip-config, #modal-trip-dashboard, #modal-scanned-packages, #modal-batch-completed')) {
            return;
        }

        // If clicked on any form field, button, link, or interactive element, NEVER steal focus!
        if (e.target.closest('input, textarea, select, button, label, a, summary, [contenteditable="true"]')) {
            return;
        }

        triggerFocus();
    });
}

// Safely refocus without triggering Android virtual keyboard (inputmode="none")
function triggerFocus() {
    if (!settings.autoFocusEnabled || !elManualScanInput) return;

    // Do NOT steal focus if user is actively typing in another input or textarea
    if (document.activeElement && document.activeElement !== elManualScanInput) {
        const activeTag = document.activeElement.tagName;
        if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT" || document.activeElement.isContentEditable) {
            return;
        }
    }

    // Do NOT steal focus if any modal or overlay is open
    const openModal = document.querySelector('.pilot-modal-overlay[style*="display: flex"], .auth-overlay[style*="display: flex"]');
    if (openModal) {
        return;
    }

    elManualScanInput.focus();
}

// Switch between Nhập (Import) and Xuất (Export) modes
function switchMode(newMode, notify = true) {
    if (window.WCM_AUTH) {
        const isAdmin = typeof window.WCM_AUTH.isAdmin === "function" ? window.WCM_AUTH.isAdmin() : window.WCM_AUTH.isSuperAdmin();
        if (!isAdmin) {
            const role = window.WCM_AUTH.getUserRole();
            if (role === "DAU_XUAT" && newMode === "Nhập") return;
            if (role === "DAU_NHAP" && newMode === "Xuất") return;
            // Nhân viên quyền XUAT_NHAP được chuyển đổi tự do cả 2 chế độ!
        }
    }

    settings.scanMode = newMode;
    saveSettings();

    if (newMode === "Xuất") {
        elBtnModeExport.classList.add("active");
        elBtnModeImport.classList.remove("active");
        elExportConfigBox.style.display = "block";
        elImportResultView.style.display = "none";
        elExportResultView.style.display = "block";
        if (notify) speakText("Chế độ đầu xuất. Đang đối chiếu lô hàng");
    } else {
        elBtnModeImport.classList.add("active");
        elBtnModeExport.classList.remove("active");
        elExportConfigBox.style.display = "none";
        elImportResultView.style.display = "block";
        elExportResultView.style.display = "none";
        inboundReconState.isActive = true;
        if (notify) speakText("Chế độ đầu nhập. Đối chiếu xuất và phân loại");
        loadTripManifestForInbound(elInboundTripSelect ? elInboundTripSelect.value : "ALL");
    }
    triggerFocus();
}
window.switchMode = switchMode;

function processManualInput() {
    const text = elManualScanInput.value.trim();
    if (text) {
        handleBarcodeScanned(text);
        elManualScanInput.value = "";
    }
    triggerFocus();
}

// =============================================================================
// CSV DICTIONARY PARSER (Lightweight, zero external libraries)
// =============================================================================
function parseCSVIntoDictionary(csvText) {
    if (!csvText) return;
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return;

    // Simple line splitter that respects quoted cells
    function splitCSVRow(line) {
        const result = [];
        let insideQuote = false;
        let cell = "";
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                insideQuote = !insideQuote;
            } else if (char === ',' && !insideQuote) {
                result.push(cell.trim().replace(/^"|"$/g, ''));
                cell = "";
            } else {
                cell += char;
            }
        }
        result.push(cell.trim().replace(/^"|"$/g, ''));
        return result;
    }

    const headers = splitCSVRow(lines[0]).map(h => h.toLowerCase());
    let doIdx = 7;
    let storeCodeIdx = 8;
    let storeNameIdx = 9;
    let qtyIdx = 10;
    let provinceIdx = 14;
    let tripIdx = 21;
    let chIdx = 24;

    for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (h === "số do" || h === "do") doIdx = i;
        else if (h.includes("mã siêu thị") || h.includes("mã ch") || h.includes("mã sap")) storeCodeIdx = i;
        else if (h.includes("tên siêu thị") || h.includes("tên cửa hàng")) storeNameIdx = i;
        else if (h === "qty" || h.includes("số kiện")) qtyIdx = i;
        else if (h.includes("tỉnh") || h.includes("tỉnh")) provinceIdx = i;
        else if (h.includes("mã chuyến") || h.includes("chuyến xe") || h === "ghi chú") tripIdx = i;
        else if (h.includes("ghi chú 2")) chIdx = i;
    }

    let loadedCount = 0;
    storeMap.byDo = storeMap.byDo || {};
    storeMap.byDoCode = storeMap.byDoCode || {};
    storeMap.byCh = storeMap.byCh || {};
    storeMap.bySap = storeMap.bySap || {};
    storeMap.trips = storeMap.trips || {};

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = splitCSVRow(lines[i]);
        const doNum = cols[doIdx] ? cols[doIdx].trim() : "";
        const storeCode = cols[storeCodeIdx] ? cols[storeCodeIdx].trim() : "";
        const storeName = cols[storeNameIdx] ? cols[storeNameIdx].trim() : "";
        const qty = cols[qtyIdx] ? parseInt(cols[qtyIdx].trim(), 10) : 0;
        const prov = cols[provinceIdx] ? cols[provinceIdx].trim() : "";
        const trip = cols[tripIdx] ? cols[tripIdx].trim() : "";
        const chCode = cols[chIdx] ? cols[chIdx].trim() : "";

        if (doNum && storeName) {
            storeMap.byDo[doNum] = storeName;
            if (storeCode) storeMap.byDoCode[doNum] = storeCode;
            loadedCount++;
        }
        if (storeCode && storeName) {
            storeMap.bySap[storeCode] = storeName;
        }
        if (chCode && storeName && chCode.startsWith("CH.")) {
            storeMap.byCh[chCode] = storeName;
        }
        if (trip && storeCode && storeName) {
            storeMap.trips[trip] = storeMap.trips[trip] || {};
            if (!storeMap.trips[trip][storeCode]) {
                storeMap.trips[trip][storeCode] = {
                    storeCode: storeCode,
                    storeName: storeName,
                    totalQty: 0,
                    province: prov
                };
            }
            storeMap.trips[trip][storeCode].totalQty += (isNaN(qty) || qty <= 0 ? 1 : qty);
        }
    }

    localStorage.setItem("wcm_store_dictionary", JSON.stringify(storeMap));
    elSyncText.textContent = `Offline: Đã nạp ${loadedCount} đơn điều độ`;
    updateStoreDropdown(exportState.tripCode);
}

// =============================================================================
// QR CODE / BARCODE PARSER
// =============================================================================
// Standard QR format:
// 1392|7079433553|SOWINSAL1372840|PPTD260704SVXZFP|CH.2.24|13/13
function parseQrCode(rawText) {
    const text = (rawText || "").trim();
    const result = {
        raw: text,
        tripCode: "",
        doNumber: "",
        soNumber: "",
        packageCode: "",
        chCode: "",
        storeCode: "",
        storeName: "",
        sttCh: "",
        bks: "",
        lotCode: "",
        driver: "",
        vehicleLabel: "",
        pkgIdx: 1,
        totalPackages: 1,
        doTotalPackages: 0,
        storeTotalPackages: 0,
        storeTotalDos: 0,
        inMasterDispatch: false,
        isBareDoOrSoScan: false,
        isStoreOnlyScan: false
    };

    if (text.includes("|")) {
        const parts = text.split("|").map(p => p.trim());
        result.tripCode = parts[0] || "";
        result.doNumber = parts[1] || "";
        result.soNumber = parts[2] || "";
        result.packageCode = parts[3] || "";

        // Detect CH routing code (e.g. CH.2.24 or CH.429)
        for (let i = 0; i < parts.length; i++) {
            if (/^CH\./i.test(parts[i])) {
                result.chCode = parts[i];
                break;
            }
        }
        if (!result.chCode && parts.length >= 5 && parts[4]) {
            result.chCode = parts[4];
        }

        // Detect package progress (e.g. 13/13 or 1/5)
        for (let i = 0; i < parts.length; i++) {
            const m = parts[i].match(/^(\d+)\/(\d+)$/);
            if (m) {
                result.pkgIdx = parseInt(m[1], 10);
                result.totalPackages = parseInt(m[2], 10);
                break;
            }
        }
    } else {
        // Single barcode scan: could be DO, SO, Store Code, or CH.xxx
        result.doNumber = text;
        result.packageCode = text;
    }

    // 1. Tra cứu ưu tiên trong File Kho Tổng Chốt (masterDispatch)
    if (masterDispatch && masterDispatch.totalRows > 0) {
        let doRec = null;
        let storeRec = null;

        if (result.doNumber && masterDispatch.byDo[result.doNumber]) {
            doRec = masterDispatch.byDo[result.doNumber];
            if (!text.includes("|")) result.isBareDoOrSoScan = true;
        } else if (result.soNumber && masterDispatch.bySo[result.soNumber.toUpperCase()]) {
            doRec = masterDispatch.bySo[result.soNumber.toUpperCase()];
            result.doNumber = doRec.doNumber;
        }

        // Match chute code (chCode) or store code in masterDispatch even if QR contains '|'
        if (!doRec) {
            const searchTerms = [];
            if (result.chCode) {
                const upperCh = result.chCode.toUpperCase();
                const cleanCh = upperCh.replace(/^CH[\.\s_-]*/i, "");
                searchTerms.push(upperCh, cleanCh, `CH.${cleanCh}`);
            }
            if (!text.includes("|")) {
                const upperText = text.toUpperCase();
                const cleanText = upperText.replace(/^CH[\.\s_-]*/i, "");
                searchTerms.push(upperText, cleanText, `CH.${cleanText}`);
                if (masterDispatch.bySo && masterDispatch.bySo[upperText]) {
                    doRec = masterDispatch.bySo[upperText];
                    result.soNumber = doRec.soNumber;
                    result.doNumber = doRec.doNumber;
                    result.isBareDoOrSoScan = true;
                }
            }

            if (!doRec) {
                for (const term of searchTerms) {
                    if (masterDispatch.byStore && masterDispatch.byStore[term]) {
                        storeRec = masterDispatch.byStore[term];
                        if (!text.includes("|")) result.isStoreOnlyScan = true;
                        break;
                    }
                    if (masterDispatch.bySttCh && masterDispatch.bySttCh[term]) {
                        storeRec = masterDispatch.bySttCh[term];
                        if (!text.includes("|")) result.isStoreOnlyScan = true;
                        break;
                    }
                }
            }
        }

        if (doRec) {
            storeRec = masterDispatch.byStore[doRec.storeCode] || null;
            result.inMasterDispatch = true;
            result.storeCode = doRec.storeCode;
            result.storeName = doRec.storeName;
            result.sttCh = doRec.sttCh || (storeRec ? storeRec.sttCh : "");
            result.chCode = result.chCode || (result.sttCh ? `CH.${result.sttCh}` : doRec.storeCode);
            result.bks = doRec.bks || (storeRec ? storeRec.bks : "");
            result.lotCode = doRec.lotCode || (storeRec ? storeRec.lotCode : "");
            result.driver = doRec.driver || (storeRec ? storeRec.driver : "");
            result.vehicleLabel = doRec.vehicleLabel || (storeRec ? storeRec.vehicleLabel : "");
            result.tripCode = result.bks || result.lotCode || result.tripCode || "";
            result.doTotalPackages = doRec.packages || 1;
            result.storeTotalPackages = storeRec ? storeRec.totalPackages : (doRec.packages || 1);
            result.storeTotalDos = storeRec ? storeRec.totalDos : 1;
            if (!text.includes("|")) {
                result.totalPackages = doRec.packages || 1;
            }
        } else if (storeRec) {
            result.inMasterDispatch = true;
            result.storeCode = storeRec.storeCode;
            result.storeName = storeRec.storeName;
            result.sttCh = storeRec.sttCh || "";
            result.chCode = result.chCode || (storeRec.sttCh ? `CH.${storeRec.sttCh}` : storeRec.storeCode);
            result.bks = storeRec.bks || "";
            result.lotCode = storeRec.lotCode || "";
            result.driver = storeRec.driver || "";
            result.vehicleLabel = storeRec.vehicleLabel || "";
            result.tripCode = result.bks || result.lotCode || result.tripCode || "";
            result.storeTotalPackages = storeRec.totalPackages || 1;
            result.storeTotalDos = storeRec.totalDos || 1;
            result.totalPackages = storeRec.totalPackages || 1;
            if (storeRec.dos && storeRec.dos.length === 1) {
                result.doNumber = storeRec.dos[0].doNumber;
                result.doTotalPackages = storeRec.dos[0].packages;
            }
        }
    }

    // 2. Fallback: Tra cứu từ danh mục cửa hàng (storeMap) nếu chưa khớp File Kho Tổng Chốt
    if (!result.storeName) {
        if (result.doNumber && storeMap.byDo && storeMap.byDo[result.doNumber]) {
            result.storeName = storeMap.byDo[result.doNumber];
            if (storeMap.byDoCode && storeMap.byDoCode[result.doNumber]) {
                result.storeCode = storeMap.byDoCode[result.doNumber];
            }
        } else if (result.chCode && storeMap.byCh && storeMap.byCh[result.chCode]) {
            result.storeName = storeMap.byCh[result.chCode];
        } else if (result.chCode && storeMap.bySap) {
            const rawCode = result.chCode.replace(/^ch[\.\s_]*/i, '');
            if (storeMap.bySap[rawCode]) {
                result.storeName = storeMap.bySap[rawCode];
                result.storeCode = rawCode;
            }
        }
    }

    return result;
}

// Clean store name for voice announcements (removes prefix WM+ / DBN if present)
function cleanStoreName(name) {
    if (!name) return "";
    let clean = name.trim();
    if (clean.startsWith("WM+")) {
        const parts = clean.split(/\s+/);
        if (parts.length > 2) return parts.slice(2).join(" ");
    }
    return clean;
}

// =============================================================================
// MAIN BARCODE PROCESSOR
// =============================================================================
let lastGlobalScanCode = "";
let lastGlobalScanTime = 0;
let isScanHandlingActive = false;

function handleBarcodeScanned(rawBarcode) {
    if (!rawBarcode || !rawBarcode.trim()) return;
    const cleanBarcode = rawBarcode.trim();
    const nowMs = Date.now();

    // 1. Chống spam phần cứng / Camera: Bỏ qua nếu cùng 1 mã vạch được kích hoạt liên tiếp trong vòng 2500ms
    if (cleanBarcode === lastGlobalScanCode && (nowMs - lastGlobalScanTime < 2500)) {
        return;
    }

    // 2. Chống gọi lồng nhau khi tác vụ trước chưa xử lý xong
    if (isScanHandlingActive && (nowMs - lastGlobalScanTime < 800)) {
        return;
    }

    lastGlobalScanCode = cleanBarcode;
    lastGlobalScanTime = nowMs;
    isScanHandlingActive = true;

    try {
        const tStartBiz = performance.now();
        const pkg = parseQrCode(cleanBarcode);

        const now = new Date();
        const timestamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')} ${now.toLocaleTimeString("vi-VN")}`;

        let result = "SUCCESS";
        if (settings.scanMode === "Nhập") {
            result = handleImportScan(pkg, timestamp);
        } else {
            result = handleExportScan(pkg, timestamp);
        }
        const tEndBiz = performance.now();

        if (window.__onPilotScanEvent) {
            window.__onPilotScanEvent({
                rawBarcode: cleanBarcode,
                pkg,
                scanResult: result || "SUCCESS",
                businessLatencyMs: Math.round(tEndBiz - tStartBiz),
                decodeTelemetry: window.__lastDecodeTelemetry || null
            });
        }
    } finally {
        setTimeout(() => {
            isScanHandlingActive = false;
        }, 300);
    }
}

// -----------------------------------------------------------------------------
// ĐẦU NHẬP: ĐỐI CHIẾU XUẤT KHO, CHỐNG NHẬP KIỆN CHƯA XUẤT & ĐỒNG BỘ GOOGLE SHEET
// -----------------------------------------------------------------------------

function updateInboundTripDropdown(tripsList, currentSelected) {
    if (!elInboundTripSelect) return;
    const customTrips = typeof getCustomTrips === "function" ? getCustomTrips() : [];
    const tripsMap = new Map();

    if (Array.isArray(tripsList)) {
        tripsList.forEach(t => {
            if (t && t.tripCode) {
                tripsMap.set(t.tripCode, {
                    code: t.tripCode,
                    exportedCount: t.totalExported || 0
                });
            }
        });
    }

    customTrips.forEach(ct => {
        if (!tripsMap.has(ct.code)) {
            tripsMap.set(ct.code, {
                code: ct.code,
                name: ct.name,
                exportedCount: 0
            });
        }
    });

    const activeTrip = currentSelected !== undefined ? currentSelected : (elInboundTripSelect.value || "ALL");
    let html = `<option value="ALL" ${activeTrip === 'ALL' ? 'selected' : ''}>🌐 TẤT CẢ CHUYẾN XE (Tự động nhận diện theo mã QR)</option>`;
    tripsMap.forEach(item => {
        const countText = item.exportedCount > 0 ? ` (${item.exportedCount} kiện xuất)` : '';
        const isSel = (item.code === activeTrip) ? 'selected' : '';
        html += `<option value="${item.code}" ${isSel}>🚛 Chuyến ${item.code}${item.name ? ' - ' + item.name : ''}${countText}</option>`;
    });

    elInboundTripSelect.innerHTML = html;
}

async function loadTripManifestForInbound(targetTripCode) {
    const selectedTrip = targetTripCode !== undefined ? targetTripCode : (elInboundTripSelect ? elInboundTripSelect.value : "ALL");
    const trip = (selectedTrip || "ALL").trim();

    if (elReconTripCode) elReconTripCode.value = trip === "ALL" ? "" : trip;

    if (!window.OnlineSync || !window.OnlineSync.getScriptUrl()) {
        updateInboundTripDropdown();
        updateInboundReconUI();
        return;
    }

    if (elBtnLoadTripManifest) {
        elBtnLoadTripManifest.disabled = true;
        elBtnLoadTripManifest.textContent = "⏳ Đang tải...";
    }

    try {
        const allTrips = await window.OnlineSync.getAllTripsProgress().catch(() => []);
        updateInboundTripDropdown(allTrips, trip);

        inboundReconState.isActive = true;
        inboundReconState.tripCode = trip === "ALL" ? "" : trip;
        inboundReconState.manifestMap = new Map();
        inboundReconState.manifestList = [];
        inboundReconState.inboundScannedKeys = new Set();
        inboundReconState.missingKeys = new Set();
        inboundReconState.extraScannedList = [];

        // Thừa hưởng dữ liệu đã xuất cục bộ trên máy nếu có
        if (exportState && Array.isArray(exportState.scannedItems)) {
            exportState.scannedItems.forEach(item => {
                if (item && item.uniqueKey) {
                    const pkg = item.pkg || {};
                    const key = item.uniqueKey;
                    const expObj = {
                        packageCode: key,
                        tripCode: exportState.tripCode || "CHUA_DAT_TEN",
                        doNumber: pkg.doNumber || "",
                        chCode: pkg.chCode || "",
                        storeName: pkg.storeName || "",
                        pkgIdxText: `${pkg.pkgIdx || 1}/${pkg.totalPackages || 1}`
                    };
                    inboundReconState.manifestMap.set(key, expObj);
                    if (pkg.packageCode) inboundReconState.manifestMap.set(pkg.packageCode, expObj);
                    if (pkg.doNumber) inboundReconState.manifestMap.set(`${pkg.doNumber}_${pkg.pkgIdx}`, expObj);
                }
            });
        }

        const tripsToFetch = (trip && trip !== "ALL") ? [trip] : allTrips.map(t => t.tripCode).filter(Boolean);
        if (tripsToFetch.length === 0 && trip && trip !== "ALL") {
            tripsToFetch.push(trip);
        }

        let totalExp = 0;
        for (const tCode of tripsToFetch) {
            try {
                const data = await window.OnlineSync.fetchTripManifest(tCode);
                if (data && Array.isArray(data.packages)) {
                    data.packages.forEach(pkg => {
                        const key = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}`;
                        pkg.tripCode = pkg.tripCode || tCode;
                        inboundReconState.manifestMap.set(key, pkg);
                        if (pkg.packageCode) inboundReconState.manifestMap.set(pkg.packageCode, pkg);
                        if (pkg.doNumber) inboundReconState.manifestMap.set(`${pkg.doNumber}_${pkg.pkgIdx}`, pkg);
                        inboundReconState.manifestList.push(pkg);
                        totalExp++;

                        if (pkg.inboundScanned) {
                            inboundReconState.inboundScannedKeys.add(key);
                            if (pkg.packageCode) inboundReconState.inboundScannedKeys.add(pkg.packageCode);
                        } else {
                            inboundReconState.missingKeys.add(key);
                        }
                    });
                }
            } catch (errT) {
                console.warn(`[INBOUND] Lỗi tải manifest chuyến ${tCode}:`, errT);
            }
        }

        inboundReconState.totalExported = totalExp > 0 ? totalExp : inboundReconState.manifestMap.size;
        saveStoredState();
        updateInboundReconUI();

        if (totalExp > 0) {
            const tripName = trip === "ALL" ? "tất cả các xe" : `chuyến ${trip}`;
            showToast(`📥 Đã nạp ${totalExp} kiện xuất của ${tripName}`, "success");
        }
    } catch (err) {
        console.warn("[INBOUND] Lỗi tải danh sách chuyến:", err);
    } finally {
        if (elBtnLoadTripManifest) {
            elBtnLoadTripManifest.disabled = false;
            elBtnLoadTripManifest.textContent = "🔄 Đồng bộ xuất";
        }
    }
}

function updateInboundReconUI() {
    if (!elReconValTotal) return;
    const total = inboundReconState.totalExported || inboundReconState.manifestMap.size;
    const received = inboundReconState.inboundScannedKeys.size;
    const missing = Math.max(0, total - received);

    elReconValTotal.textContent = total;
    elReconValReceived.textContent = received;
    elReconValMissing.textContent = missing;

    if (elBtnToggleMissingDrawer) {
        elBtnToggleMissingDrawer.style.display = missing > 0 ? "block" : "none";
        elBtnToggleMissingDrawer.textContent = `⚠️ Xem ${missing} kiện còn thiếu`;
    }

    if (elMissingDrawerCount) {
        elMissingDrawerCount.textContent = `${missing} kiện`;
    }

    if (elMissingPkgsList) {
        if (missing === 0 && total > 0) {
            elMissingPkgsList.innerHTML = `<div style="color:#10b981; text-align:center; padding:0.5rem; font-weight:700;">🎉 Đã nhận đủ toàn bộ ${total} kiện!</div>`;
        } else if (total === 0) {
            elMissingPkgsList.innerHTML = `<div style="color:#94a3b8; text-align:center; padding:0.5rem;">Chưa có dữ liệu kiện xuất kho. Bấm 'Đồng bộ xuất' để nạp.</div>`;
        } else {
            let html = "";
            inboundReconState.missingKeys.forEach(key => {
                const item = inboundReconState.manifestMap.get(key) || {};
                html += `
                    <div class="missing-pkg-item" style="display: flex; justify-content: space-between; padding: 0.35rem 0.5rem; border-bottom: 1px solid #334155; font-size: 0.78rem;">
                        <span><strong>${item.chCode || item.storeName || "Kiện"}</strong> (DO: ${item.doNumber || "-"})</span>
                        <span style="color: #f59e0b;">${item.pkgIdxText || item.packageCode || key}</span>
                    </div>
                `;
            });
            elMissingPkgsList.innerHTML = html;
        }
    }
}

function handleImportScan(pkg, timestamp) {
    const uniqueKey = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}` || pkg.raw;
    const cleanStore = cleanStoreName(pkg.storeName);
    const storeLabel = pkg.storeName ? (pkg.storeCode ? `[${pkg.storeCode}] ${pkg.storeName}` : pkg.storeName) : (pkg.chCode ? `Cửa hàng ${pkg.chCode}` : "Không rõ");

    // 1. TÌM KIẾM THÔNG TIN XUẤT KHO / KHO TỔNG CHỐT CỦA KIỆN HÀNG
    let manifestItem = inboundReconState.manifestMap.get(uniqueKey) ||
                       inboundReconState.manifestMap.get(pkg.packageCode) ||
                       inboundReconState.manifestMap.get(`${pkg.doNumber}_${pkg.pkgIdx}`);

    // Nếu trên máy có quét xuất cục bộ mà chưa có trong manifest
    if (!manifestItem && exportState && Array.isArray(exportState.scannedItems)) {
        const localExp = exportState.scannedItems.find(item => 
            item.uniqueKey === uniqueKey || (item.pkg && item.pkg.packageCode === pkg.packageCode)
        );
        if (localExp) {
            manifestItem = {
                packageCode: localExp.uniqueKey,
                tripCode: exportState.tripCode || "CHUA_DAT_TEN",
                doNumber: (localExp.pkg && localExp.pkg.doNumber) || pkg.doNumber,
                chCode: (localExp.pkg && localExp.pkg.chCode) || pkg.chCode,
                storeName: (localExp.pkg && localExp.pkg.storeName) || pkg.storeName,
                pkgIdxText: localExp.pkg ? `${localExp.pkg.pkgIdx}/${localExp.pkg.totalPackages}` : ""
            };
            inboundReconState.manifestMap.set(uniqueKey, manifestItem);
        }
    }

    // Nếu kiện có trong File Kho Tổng Chốt (masterDispatch) thì cho phép nhận diện & phân loại máng CH ngay
    if (!manifestItem && pkg.inMasterDispatch) {
        manifestItem = {
            packageCode: uniqueKey,
            tripCode: pkg.bks || pkg.lotCode || pkg.tripCode || "KHO_TONG_CHOT",
            doNumber: pkg.doNumber || "",
            chCode: pkg.chCode || (pkg.sttCh ? `CH.${pkg.sttCh}` : pkg.storeCode),
            storeName: pkg.storeName || "",
            pkgIdxText: `${pkg.pkgIdx || 1}/${pkg.totalPackages || 1}`
        };
        inboundReconState.manifestMap.set(uniqueKey, manifestItem);
    }

    // 2. CHẶN LẬP TỨC NẾU KIỆN CHƯA CÓ LOG XUẤT KHO & KHÔNG CÓ TRONG FILE KHO TỔNG CHỐT
    if (!manifestItem) {
        triggerVibrate([300, 100, 300, 100, 500]);
        playSound("wrong_store");
        speakText("Cảnh báo! Kiện chưa xuất kho, không thể nhập!");

        updateImportVisuals(pkg, "duplicate");

        elImportVerdict.innerHTML = `🚨 TỪ CHỐI NHẬP: KIỆN CHƯA CÓ LOG XUẤT KHO!<br><span style="font-size: 0.95rem;">Kiện [<strong>${escapeHtml(uniqueKey)}</strong>] không có trong File Kho Tổng Chốt / chưa từng quét xuất.<br>⚠️ <em>Vi phạm quy trình: Chưa xuất sao lại nhập được! Vui lòng kiểm tra lại đầu xuất.</em></span>`;
        elImportVerdict.className = "verdict-box verdict-wrong-store";

        setScannerLiveAlert({
            type: "danger",
            title: "🚨 TỪ CHỐI NHẬP: CHƯA CÓ LOG XUẤT!",
            subtitle: `Kiện [${uniqueKey}] chưa từng được quét xuất kho. Chưa xuất không thể nhập!`,
            icon: "🚨"
        });

        logHistory({
            timestamp: timestamp,
            mode: "Nhập",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: storeLabel,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "error",
            note: "TỪ CHỐI: Chưa có log xuất kho"
        });
        return "NOT_EXPORTED";
    }

    // 3. KIỂM TRA QUÉT TRÙNG ĐẦU NHẬP
    if (inboundReconState.inboundScannedKeys.has(uniqueKey) || 
        (!pkg.isBareDoOrSoScan && inboundReconState.inboundScannedKeys.has(pkg.packageCode)) || 
        manifestItem.inboundScanned) {

        const nowMs = Date.now();
        const lastAlertTime = inboundReconState.lastDuplicateAlertTime || 0;
        const isSpamDuplicate = (nowMs - lastAlertTime < 3000);

        if (!isSpamDuplicate) {
            inboundReconState.lastDuplicateAlertTime = nowMs;
            triggerVibrate([150, 80, 150]);
            playSound("duplicate");
            speakText("Đã trùng kiện này");

            logHistory({
                timestamp: timestamp,
                mode: "Nhập",
                chCode: pkg.chCode || manifestItem.chCode || "-",
                doNumber: pkg.doNumber || manifestItem.doNumber || "-",
                storeName: storeLabel,
                pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
                status: "warning",
                note: "Kiện trùng khi đối chiếu dỡ hàng"
            });
        }

        updateImportVisuals(pkg, "duplicate");

        elImportVerdict.innerHTML = `⚠️ KIỆN ĐÃ NHẬP TRƯỚC ĐÓ!<br><span style="font-size: 0.95rem;">Kiện [${escapeHtml(uniqueKey)}] đã được quét nhập vào kho rồi.</span>`;
        elImportVerdict.className = "verdict-box verdict-incomplete";

        setScannerLiveAlert({
            type: "warning",
            title: "⚠️ KIỆN ĐÃ NHẬP TRƯỚC ĐÓ!",
            subtitle: `Kiện [${uniqueKey}] đã được quét nhập vào kho rồi.`,
            icon: "⚠️"
        });

        return "DUPLICATE";
    }

    // 4. KIỆN HỢP LỆ (ĐÃ CÓ LOG XUẤT KHO VÀ CHƯA NHẬP)
    inboundReconState.inboundScannedKeys.add(uniqueKey);
    if (pkg.packageCode && !pkg.isBareDoOrSoScan) inboundReconState.inboundScannedKeys.add(pkg.packageCode);
    inboundReconState.missingKeys.delete(uniqueKey);
    if (pkg.packageCode) inboundReconState.missingKeys.delete(pkg.packageCode);

    manifestItem.inboundScanned = true;
    manifestItem.receivedTime = timestamp;

    triggerVibrate([80]);
    playSound("success");

    const finalCh = pkg.chCode || manifestItem.chCode;
    const finalStore = cleanStore || cleanStoreName(manifestItem.storeName);
    if (finalStore && finalCh) {
        speakText(`${finalStore}, phân loại ${finalCh}`);
    } else if (finalCh) {
        speakText(`Phân loại ${finalCh}`);
    } else {
        speakText(`Đúng kiện, thứ ${inboundReconState.inboundScannedKeys.size}`);
    }

    updateImportVisuals(pkg, "success");
    updateInboundReconUI();

    const currentReceived = inboundReconState.inboundScannedKeys.size;
    const totalExp = inboundReconState.totalExported || inboundReconState.manifestMap.size;

    if (totalExp > 0 && currentReceived >= totalExp) {
        triggerVibrate([100, 50, 100, 50, 200]);
        playSound("complete");
        speakText(`Đã dỡ và đối chiếu đủ ${totalExp} kiện!`);
        elImportVerdict.innerHTML = `🎉 ĐÃ ĐỐI CHIẾU ĐỦ ${totalExp}/${totalExp} KIỆN!<br><span style="font-size: 0.95rem;">Toàn bộ kiện xuất đã được nhận đầy đủ không thất lạc.</span>`;
        elImportVerdict.className = "verdict-box verdict-complete";

        setScannerLiveAlert({
            type: "success",
            title: `🎉 ĐÃ ĐỐI CHIẾU ĐỦ ${totalExp}/${totalExp} KIỆN!`,
            subtitle: `Máng ${finalCh || ''} - ${finalStore || ''}. Không thất lạc kiện nào.`,
            icon: "🎉"
        });
    } else {
        elImportVerdict.innerHTML = `✅ NHẬP KHO HỢP LỆ (ĐÃ KHỚP XUẤT KHO): Đã nhận ${currentReceived}${totalExp > 0 ? '/' + totalExp : ''} kiện<br><span style="font-size: 0.9rem;">Còn thiếu ${Math.max(0, totalExp - currentReceived)} kiện chưa dỡ.</span>`;
        elImportVerdict.className = "verdict-box verdict-incomplete";

        setScannerLiveAlert({
            type: "success",
            title: `✅ MÁNG: ${finalCh || 'CH'} - ${finalStore || 'Hợp lệ'}`,
            subtitle: `Khớp xuất kho! Đã nhận ${currentReceived}${totalExp > 0 ? '/' + totalExp : ''} kiện (Còn thiếu ${Math.max(0, totalExp - currentReceived)})`,
            icon: "✅"
        });
    }

    // 5. GỬI ĐỒNG BỘ LÊN GOOGLE SHEETS THỜI GIAN THỰC (TAB NHAP_KHO)
    if (window.OnlineSync) {
        window.OnlineSync.recordScan({
            action: "inbound_scan",
            tripCode: pkg.tripCode || manifestItem.tripCode || inboundReconState.tripCode || "CHUA_DAT_TEN",
            operatorCode: window.OnlineSync.getOperatorCode(),
            packageCode: uniqueKey,
            doNumber: pkg.doNumber || manifestItem.doNumber || "",
            chCode: pkg.chCode || manifestItem.chCode || "",
            storeName: storeLabel || manifestItem.storeName || "",
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "KHỚP ĐÚNG CHUYẾN",
            rawBarcode: pkg.raw,
            timestamp: timestamp
        });
    }

    logHistory({
        timestamp: timestamp,
        mode: "Nhập",
        chCode: pkg.chCode || manifestItem.chCode || "-",
        doNumber: pkg.doNumber || manifestItem.doNumber || "-",
        storeName: storeLabel,
        pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
        status: "success",
        note: `Khớp xuất kho (${currentReceived}/${totalExp || 1})`
    });

    saveStoredState();
    return "SUCCESS";
}

function updateImportVisuals(pkg, status) {
    // Giant Chute display
    elImportChuteCode.textContent = pkg.chCode || "CH.---";
    elImportStoreName.textContent = pkg.storeName || (pkg.chCode ? `Vị trí phân loại: ${pkg.chCode}` : "Chưa có tên cửa hàng");

    elImportDoNumber.textContent = pkg.doNumber || "-";
    elImportPkgProgress.textContent = `${pkg.pkgIdx} / ${pkg.totalPackages}`;
    elImportPkgCode.textContent = pkg.packageCode || "-";
    elImportTripCode.textContent = pkg.tripCode || "-";

    elImportChuteBox.className = "giant-chute-box " + status;

    if (status === "duplicate") {
        elImportVerdict.textContent = "⚠️ CẢNH BÁO: KIỆN NÀY ĐÃ ĐƯỢC QUÉT TRƯỚC ĐÓ!";
        elImportVerdict.className = "verdict-box verdict-incomplete";
    } else {
        elImportVerdict.textContent = `✅ HỢP LỆ: Phân loại vào ${pkg.chCode || 'line hàng'}`;
        elImportVerdict.className = "verdict-box verdict-complete";
    }
}

function resetImportVisuals() {
    elImportChuteCode.textContent = "CHƯA QUÉT";
    elImportStoreName.textContent = "Đang chờ quét kiện đầu tiên...";
    elImportDoNumber.textContent = "-";
    elImportPkgProgress.textContent = "-";
    elImportPkgCode.textContent = "-";
    elImportTripCode.textContent = "-";
    elImportChuteBox.className = "giant-chute-box";
    elImportVerdict.textContent = "Sẵn sàng nhận mã quét nhập kho...";
    elImportVerdict.className = "verdict-box verdict-empty";
    setScannerLiveAlert({
        type: "idle",
        title: "SẴN SÀNG QUÉT MÃ NHẬP KHO",
        subtitle: "Bóp cò PDA hoặc soi camera để kiểm tra kết quả ngay tại đây",
        icon: "⚡"
    });
}

// -----------------------------------------------------------------------------
// ĐẦU XUẤT: TỰ ĐỘNG KHÓA CỬA HÀNG & XE THEO FILE KHO TỔNG CHỐT & CHỐNG LẪN HÀNG
// -----------------------------------------------------------------------------
function saveCurrentStoreProgress() {
    if (exportState.isBatchActive && exportState.targetStoreCode) {
        storeProgressMap[exportState.targetStoreCode] = {
            scannedItems: (exportState.scannedItems || []).slice(),
            isBatchCompleted: !!exportState.isBatchCompleted,
            targetQty: exportState.targetQty,
            storeDos: (exportState.storeDos || []).slice()
        };
    }
}

function lockStoreBatch(storeInfo, options = {}) {
    if (!storeInfo) return;
    saveCurrentStoreProgress();

    const code = (storeInfo.storeCode || "").trim().toUpperCase();
    const name = (storeInfo.storeName || "").trim();
    const fullStore = code ? `[${code}] ${name}` : name;
    const bks = storeInfo.bks || "";
    const lotCode = storeInfo.lotCode || "";
    const sttCh = storeInfo.sttCh || "";
    const trip = bks || lotCode || storeInfo.tripCode || "";
    const vehicleLabel = storeInfo.vehicleLabel || (bks && lotCode ? `${bks} (Lot ${lotCode})` : (bks || (lotCode ? `Lot ${lotCode}` : (trip || "Theo File Tổng Chốt"))));
    const totalQty = storeInfo.totalPackages || storeInfo.totalQty || 1;
    const op = elExportOperatorCode ? (elExportOperatorCode.value.trim() || "NV01") : (exportState.operatorCode || "NV01");

    const prevProgress = (code && storeProgressMap && storeProgressMap[code]) ? storeProgressMap[code] : null;

    exportState.targetStore = fullStore;
    exportState.targetStoreCode = code;
    exportState.targetStoreName = name || fullStore;
    exportState.targetQty = totalQty;
    exportState.tripCode = trip;
    exportState.bks = bks;
    exportState.lotCode = lotCode;
    exportState.sttCh = sttCh;
    exportState.vehicleLabel = vehicleLabel;
    exportState.storeDos = Array.isArray(storeInfo.dos) ? storeInfo.dos.slice() : [];
    exportState.operatorCode = op;
    exportState.scannedItems = (prevProgress && Array.isArray(prevProgress.scannedItems)) ? prevProgress.scannedItems.slice() : [];
    exportState.peerScannedItems = [];
    exportState.isBatchActive = true;
    exportState.isBatchCompleted = prevProgress ? !!prevProgress.isBatchCompleted : false;

    if (prevProgress) {
        if (prevProgress.targetQty && prevProgress.targetQty > exportState.targetQty) {
            exportState.targetQty = prevProgress.targetQty;
        }
        if (Array.isArray(prevProgress.storeDos)) {
            prevProgress.storeDos.forEach(pd => {
                if (pd && pd.doNumber && !exportState.storeDos.some(d => d.doNumber === pd.doNumber)) {
                    exportState.storeDos.push(pd);
                }
            });
        }
    }

    saveStoredState();

    if (window.OnlineSync) {
        if (trip) window.OnlineSync.setTripCode(trip);
        if (op) window.OnlineSync.setOperatorCode(op);
    }

    updateExportUI();

    if (options.announce) {
        speakText(`Đã khóa cửa hàng ${cleanStoreName(name) || code}. Kế hoạch ${totalQty} kiện`);
    }
    triggerFocus();
}

window.forceSwitchToScannedStore = function(storeCode) {
    const cleanCode = (storeCode || "").trim().toUpperCase();
    if (!cleanCode || !masterDispatch || !masterDispatch.byStore || !masterDispatch.byStore[cleanCode]) return;
    const storeInfo = masterDispatch.byStore[cleanCode];
    lockStoreBatch(storeInfo, { announce: true });
    addRecentStore(storeInfo.storeCode, storeInfo.storeName, storeInfo.totalPackages);
    showToast(`🔒 Đã chuyển sang xếp [${storeInfo.storeCode}] ${storeInfo.storeName} (${storeInfo.totalPackages} kiện)`);
};

function applyExportBatch() {
    const store = elExportTargetStore ? elExportTargetStore.value.trim() : "";
    const qty = elExportTargetQty ? parseInt(elExportTargetQty.value, 10) : 0;
    const trip = elExportTripCode ? elExportTripCode.value.trim() : "";
    const op = elExportOperatorCode ? elExportOperatorCode.value.trim() : "NV01";

    if (!store) {
        alert("Vui lòng nhập Cửa hàng / Mã CH cần xuất (hoặc bắn trực tiếp mã kiện để tự động nhận diện)!");
        if (elExportTargetStore) elExportTargetStore.focus();
        return;
    }

    // Kiểm tra xem cửa hàng có trong File Kho Tổng Chốt không
    const codeMatch = store.match(/\[([A-Za-z0-9]+)\]/) || store.match(/^([A-Za-z0-9]{3,7})\b/);
    const extractedCode = codeMatch ? codeMatch[1].toUpperCase() : store.toUpperCase();
    if (masterDispatch && masterDispatch.byStore && masterDispatch.byStore[extractedCode]) {
        const stInfo = masterDispatch.byStore[extractedCode];
        lockStoreBatch(stInfo, { announce: true });
        return;
    }

    if (!qty || qty <= 0) {
        alert("Vui lòng nhập Số kiện kế hoạch của lô lớn hơn 0!");
        if (elExportTargetQty) elExportTargetQty.focus();
        return;
    }

    saveCurrentStoreProgress();

    exportState.targetStore = store;
    exportState.targetStoreCode = extractedCode;
    exportState.targetStoreName = store;
    exportState.targetQty = qty;
    exportState.tripCode = trip;
    exportState.bks = trip;
    exportState.lotCode = "";
    exportState.sttCh = "";
    exportState.vehicleLabel = trip || "Thủ công";
    exportState.storeDos = [];
    exportState.operatorCode = op;
    exportState.isBatchActive = true;
    saveStoredState();

    if (window.OnlineSync) {
        if (trip) window.OnlineSync.setTripCode(trip);
        if (op) window.OnlineSync.setOperatorCode(op);
    }

    updateExportUI();
    speakText(`Bắt đầu xuất cho ${store}. Kế hoạch ${qty} kiện`);
    triggerFocus();
}

function clearExportBatch(wipeStoreProgress = false) {
    if (!wipeStoreProgress) {
        saveCurrentStoreProgress();
    }
    exportState.targetStore = "";
    exportState.targetStoreCode = "";
    exportState.targetStoreName = "";
    exportState.targetQty = 0;
    exportState.tripCode = "";
    exportState.bks = "";
    exportState.lotCode = "";
    exportState.sttCh = "";
    exportState.vehicleLabel = "";
    exportState.storeDos = [];
    exportState.scannedItems = [];
    exportState.peerScannedItems = [];
    exportState.isBatchActive = false;
    exportState.isBatchCompleted = false;
    saveStoredState();

    if (elExportTargetStore) elExportTargetStore.value = "";
    if (elExportTargetQty) elExportTargetQty.value = "";
    if (elExportTripCode) elExportTripCode.value = "";
    if (elExportTripSelect) elExportTripSelect.value = "";
    if (elCustomTripWrapper) elCustomTripWrapper.style.display = "none";
    updateExportUI();
    triggerFocus();
}

// Check if package store matches batch target store
function isStoreMatch(pkg, targetStore) {
    if (!targetStore) return true;

    // 0. Fast exact match on targetStoreCode if available from Master Dispatch
    if (exportState.targetStoreCode && pkg.storeCode) {
        return exportState.targetStoreCode.toUpperCase() === pkg.storeCode.toUpperCase();
    }

    const tgt = targetStore.toLowerCase().replace(/^ch[\.\s_]*/i, '').replace(/\s+/g, '').trim();
    const tgtClean = removeVietnameseTones(targetStore).replace(/\s+/g, '');

    // 1. Compare with CH / Chute code (e.g. CH.2.31 or CH.429)
    if (pkg.chCode) {
        const pkgCh = pkg.chCode.toLowerCase().replace(/^ch[\.\s_]*/i, '').replace(/\s+/g, '').trim();
        if (pkgCh === tgt || pkgCh.includes(tgt) || tgt.includes(pkgCh)) return true;
    }

    // 2. Compare with store name (full, partial, tone-insensitive)
    const store = (pkg.storeName || "").toLowerCase().replace(/\s+/g, '');
    const storeClean = removeVietnameseTones(pkg.storeName || "").replace(/\s+/g, '');
    if (store && (store.includes(tgt) || tgt.includes(store))) return true;
    if (storeClean && tgtClean && (storeClean.includes(tgtClean) || tgtClean.includes(storeClean))) return true;

    // 3. Compare with SAP / Store code (e.g. [6724], 6724, 2AFF)
    const codeMatch = targetStore.match(/\[([A-Za-z0-9]+)\]/) || targetStore.match(/^([A-Za-z0-9]{3,7})\b/);
    if (codeMatch && codeMatch[1]) {
        const targetCode = codeMatch[1].toLowerCase();
        if (pkg.storeCode && pkg.storeCode.toLowerCase() === targetCode) return true;
        if (pkg.chCode && pkg.chCode.toLowerCase().replace(/^ch[\.\s_]*/i, '') === targetCode) return true;
        if (storeMap.byDoCode && pkg.doNumber && (storeMap.byDoCode[pkg.doNumber] || "").toLowerCase() === targetCode) return true;
    }

    // 4. Compare with DO if target is DO
    if (pkg.doNumber && (pkg.doNumber.includes(tgt) || tgt.includes(pkg.doNumber))) return true;

    return false;
}

let lastUnconfiguredWarningTime = 0;

function handleExportScan(pkg, timestamp) {
    let wasAutoLockedOnThisScan = false;

    // 0A. Nếu cửa hàng hiện tại ĐÃ ĐỦ 100% số kiện và nhân viên bắn sang kiện của CỬA HÀNG MỚI -> Tự động chuyển khóa sang cửa hàng mới!
    if (exportState.isBatchActive && exportState.targetQty > 0) {
        const doneCount = exportState.scannedItems.length + (exportState.peerScannedItems ? exportState.peerScannedItems.length : 0);
        if (doneCount >= exportState.targetQty && !isStoreMatch(pkg, exportState.targetStore)) {
            closeBatchCompletedModal();
            saveCurrentStoreProgress();
            exportState.isBatchActive = false;
        }
    }

    // 0B. TỰ ĐỘNG NHẬN DIỆN & KHÓA CỬA HÀNG + XE TỪ FILE KHO TỔNG CHỐT KHI CHƯA KHÓA LÔ
    if (!exportState.isBatchActive || exportState.targetQty <= 0) {
        let dispatchStore = (pkg.storeCode && masterDispatch && masterDispatch.byStore)
            ? masterDispatch.byStore[pkg.storeCode.toUpperCase()]
            : null;

        if (!dispatchStore && masterDispatch && pkg.chCode) {
            const cleanCh = pkg.chCode.toUpperCase().replace(/^CH[\.\s_-]*/i, "");
            if (masterDispatch.byStore && masterDispatch.byStore[pkg.chCode.toUpperCase()]) {
                dispatchStore = masterDispatch.byStore[pkg.chCode.toUpperCase()];
            } else if (masterDispatch.byStore && masterDispatch.byStore[cleanCh]) {
                dispatchStore = masterDispatch.byStore[cleanCh];
            } else if (masterDispatch.bySttCh && masterDispatch.bySttCh[cleanCh]) {
                dispatchStore = masterDispatch.bySttCh[cleanCh];
            } else if (masterDispatch.bySttCh && masterDispatch.bySttCh[pkg.chCode.toUpperCase()]) {
                dispatchStore = masterDispatch.bySttCh[pkg.chCode.toUpperCase()];
            }
        }

        if (dispatchStore) {
            lockStoreBatch(dispatchStore, { announce: false });
            addRecentStore(dispatchStore.storeCode, dispatchStore.storeName, dispatchStore.totalPackages);
            wasAutoLockedOnThisScan = true;

            // Nếu nhân viên chỉ quét mã Cửa hàng / STT CH (VD: "2AFF" hoặc "CH.429") để khóa cửa hàng trước:
            if (pkg.isStoreOnlyScan) {
                triggerVibrate([100, 50, 100]);
                playSound("success");
                speakText(`Đã khóa cửa hàng ${cleanStoreName(dispatchStore.storeName)}, kế hoạch ${dispatchStore.totalPackages} kiện`);

                if (elExportVerdict) {
                    elExportVerdict.innerHTML = `🔒 ĐÃ TỰ ĐỘNG KHÓA CỬA HÀNG: <strong>[${escapeHtml(dispatchStore.storeCode)}] ${escapeHtml(dispatchStore.storeName)}</strong><br><span style="font-size: 0.92rem; font-weight: 500;">🚛 Xe: <strong>${escapeHtml(exportState.vehicleLabel)}</strong> • Tổng kế hoạch: <strong>${dispatchStore.totalPackages} kiện</strong> (${dispatchStore.totalDos} đơn DO). Hãy bắn mã kiện / DO để đếm!</span>`;
                    elExportVerdict.className = "verdict-box verdict-incomplete";
                }

                setScannerLiveAlert({
                    type: "success",
                    title: `🔒 ĐÃ KHÓA: [${dispatchStore.storeCode}] (${dispatchStore.totalPackages} kiện)`,
                    subtitle: `${dispatchStore.storeName} • Xe: ${exportState.vehicleLabel}. Mời bắn kiện hàng!`,
                    icon: "🔒"
                });
                return "LOCKED_STORE_ONLY";
            }
        } else if ((pkg.storeCode || pkg.storeName || pkg.chCode) && pkg.totalPackages > 0 && pkg.raw.includes("|")) {
            // Fallback cho mã QR tiêu chuẩn có sẵn thông tin cửa hàng & số kiện nhưng ngoài danh mục File mẫu
            const fallbackStore = {
                storeCode: pkg.storeCode || pkg.chCode || "QR",
                storeName: pkg.storeName || pkg.chCode || "Cửa hàng QR",
                sttCh: pkg.sttCh || "",
                bks: pkg.tripCode || "",
                lotCode: "",
                vehicleLabel: pkg.tripCode ? `Chuyến ${pkg.tripCode}` : "Theo mã QR",
                totalPackages: pkg.totalPackages || 1,
                totalDos: 1,
                isFallback: true,
                dos: pkg.doNumber ? [{ doNumber: pkg.doNumber, soNumber: pkg.soNumber || "", packages: pkg.totalPackages || 1, pkgCount: pkg.totalPackages || 1, qtyPcs: 0 }] : []
            };
            lockStoreBatch(fallbackStore, { announce: false });
            exportState.isAutoLocked = true;
            wasAutoLockedOnThisScan = true;
        } else {
            const now = Date.now();
            if (now - lastUnconfiguredWarningTime > 2500) {
                triggerVibrate([150, 80, 150]);
                playSound("error");
                speakText("Mã này không có trong file kho tổng chốt");
                lastUnconfiguredWarningTime = now;
            }

            if (elExportVerdict) {
                elExportVerdict.innerHTML = `⚠️ KHÔNG TÌM THẤY MÃ [<strong>${escapeHtml(pkg.raw)}</strong>] TRONG FILE KHO TỔNG CHỐT!<br><span style="font-size: 0.92rem; font-weight: 500;">Vui lòng bắn mã QR kiện hàng, Số DO, Số SO hoặc Mã Cửa Hàng có trong <strong>File Kho Tổng Chốt</strong> (hoặc bấm <em>'Đổi file .xlsb/.xlsx'</em> để nạp file mới).</span>`;
                elExportVerdict.className = "verdict-box verdict-overscan";
            }

            setScannerLiveAlert({
                type: "warning",
                title: "⚠️ MÃ KHÔNG CÓ TRONG FILE TỔNG CHỐT!",
                subtitle: `Không tìm thấy DO/CH [${pkg.raw}] trong File Kho Tổng Chốt.`,
                icon: "⚠️"
            });

            return "UNCONFIGURED_BATCH";
        }
    }

    // Nếu đang khóa cửa hàng mà nhân viên quét lại mã Cửa hàng của chính cửa hàng đó
    if (pkg.isStoreOnlyScan && isStoreMatch(pkg, exportState.targetStore)) {
        triggerVibrate([80]);
        playSound("success");
        speakText(`Đang khóa ${cleanStoreName(exportState.targetStoreName)}, mời bắn kiện hàng`);
        return "LOCKED_STORE_ONLY";
    }

    const pkgStoreIdentifier = pkg.storeCode
        ? `[${pkg.storeCode}] ${pkg.storeName || pkg.chCode || ""}`
        : (pkg.chCode || pkg.storeName || "Không rõ");
    const pkgVehicleText = pkg.vehicleLabel ? ` (Xe: ${pkg.vehicleLabel})` : "";

    // 1. CHECK FOR WRONG STORE (CHỐNG LẪN HÀNG KHI CỬA HÀNG ĐANG XẾP CHƯA ĐỦ 100%)
    const match = isStoreMatch(pkg, exportState.targetStore);
    if (!match) {
        triggerVibrate([300, 100, 300, 100, 500]);
        playSound("wrong_store");
        speakText(`Sai cửa hàng! Kiện này của ${cleanStoreName(pkg.storeName) || pkg.storeCode || pkg.chCode || 'cửa hàng khác'}!`);

        const myDone = exportState.scannedItems.length;
        const peerDone = (exportState.peerScannedItems || []).length;
        const switchBtnHtml = (pkg.storeCode && masterDispatch && masterDispatch.byStore && masterDispatch.byStore[pkg.storeCode])
            ? `<div style="margin-top: 0.55rem;"><button type="button" onclick="window.forceSwitchToScannedStore('${escapeHtml(pkg.storeCode)}')" style="padding: 0.4rem 0.85rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.45); background: rgba(15,23,42,0.75); color: #38bdf8; font-weight: 700; font-size: 0.82rem; cursor: pointer;">🔄 Mở khóa & Chuyển sang xếp [${escapeHtml(pkg.storeCode)}] ngay</button></div>`
            : "";

        elExportVerdict.innerHTML = `🚨 SAI CỬA HÀNG / LẪN HÀNG!<br><span style="font-size: 0.96rem; font-weight: 500;">Kiện vừa bắn thuộc <strong>${escapeHtml(pkgStoreIdentifier)}${escapeHtml(pkgVehicleText)}</strong>,<br>KHÔNG PHẢI <strong>${escapeHtml(exportState.targetStore)}</strong> (Đang xếp dở ${myDone + peerDone}/${exportState.targetQty} kiện)!</span>${switchBtnHtml}`;
        elExportVerdict.className = "verdict-box verdict-wrong-store";

        setScannerLiveAlert({
            type: "danger",
            title: `🚨 SAI CỬA HÀNG: ${pkgStoreIdentifier}!`,
            subtitle: `Đang khóa ${exportState.targetStore} (${myDone + peerDone}/${exportState.targetQty}k) — Không được lẫn hàng!`,
            icon: "🚨"
        });

        elExportLastPkgStore.textContent = pkgStoreIdentifier;
        elExportLastPkgDo.textContent = pkg.doNumber || "-";
        elExportLastPkgIdx.textContent = `${pkg.pkgIdx}/${pkg.totalPackages}`;

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || pkg.storeCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "error",
            note: `SAI CỬA HÀNG (Lẫn hàng của ${pkgStoreIdentifier} khi đang xếp ${exportState.targetStore})`
        });
        return "WRONG_STORE";
    }

    // 1b. NẾU QUÉT MÃ DO / SO ĐƠN LẺ (1D BARCODE), TỰ ĐỘNG ĐẾM SỐ THỨ TỰ KIỆN TRONG DO ĐÓ (1..doTotalPackages)
    if (pkg.isBareDoOrSoScan && pkg.doNumber) {
        const doScannedCount = exportState.scannedItems.filter(it => it.pkg && it.pkg.doNumber === pkg.doNumber).length;
        const maxDoPkgs = pkg.doTotalPackages || pkg.totalPackages || 1;

        if (doScannedCount >= maxDoPkgs) {
            triggerVibrate([150, 80, 150]);
            playSound("duplicate");
            speakText(`Đơn D O này đã đủ ${maxDoPkgs} kiện`);

            elExportVerdict.innerHTML = `⚠️ ĐƠN DO [<strong>${escapeHtml(pkg.doNumber)}</strong>] ĐÃ ĐỦ ${maxDoPkgs}/${maxDoPkgs} KIỆN!<br><span style="font-size: 0.92rem; font-weight: 500;">Toàn bộ ${maxDoPkgs} kiện của DO ${escapeHtml(pkg.doNumber)} đã được quét lên xe. Nếu cửa hàng còn DO khác, hãy bắn DO tiếp theo!</span>`;
            elExportVerdict.className = "verdict-box verdict-incomplete";

            setScannerLiveAlert({
                type: "warning",
                title: `⚠️ DO ${pkg.doNumber} ĐÃ ĐỦ ${maxDoPkgs}/${maxDoPkgs} KIỆN!`,
                subtitle: `Đã quét đủ số kiện của DO này. Hãy kiểm tra DO khác của cửa hàng.`,
                icon: "⚠️"
            });
            return "DUPLICATE";
        }

        pkg.pkgIdx = doScannedCount + 1;
        pkg.totalPackages = maxDoPkgs;
        pkg.packageCode = `${pkg.doNumber}_K${pkg.pkgIdx}`;
    }

    const uniqueKey = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}` || pkg.raw;

    // 2. CHECK FOR DUPLICATE IN CURRENT EXPORT BATCH (MÁY NÀY)
    const isDuplicate = exportState.scannedItems.some(item => item.uniqueKey === uniqueKey);
    if (isDuplicate) {
        triggerVibrate([150, 80, 150]);
        playSound("duplicate");
        speakText("Đã trùng kiện này");

        elExportVerdict.innerHTML = `⚠️ KIỆN ĐÃ QUÉT TRÙNG!<br><span style="font-size: 0.95rem; font-weight: 500;">Kiện ${pkg.pkgIdx}/${pkg.totalPackages} (DO: ${escapeHtml(pkg.doNumber || "-")}) đã được máy này đưa lên xe trước đó.</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        setScannerLiveAlert({
            type: "warning",
            title: "⚠️ KIỆN ĐÃ QUÉT TRÙNG!",
            subtitle: `Kiện ${pkg.pkgIdx}/${pkg.totalPackages} đã xếp lên xe trước đó.`,
            icon: "⚠️"
        });

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || pkg.storeCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: "Kiện xuất trùng lặp trên máy này"
        });
        return "DUPLICATE";
    }

    // 2b. CHECK FOR CROSS-OPERATOR PEER DUPLICATE (ĐỒNG ĐỘI ĐÃ QUÉT TRÊN THIẾT BỊ KHÁC)
    const isPeerDuplicate = (exportState.peerScannedItems && exportState.peerScannedItems.some(item => item.uniqueKey === uniqueKey))
        || (window.OnlineSync && window.OnlineSync.isKnownByPeer(uniqueKey) && !isDuplicate);

    if (isPeerDuplicate) {
        const peerInfo = window.OnlineSync ? window.OnlineSync.getPeerScannerInfo(uniqueKey) : null;
        const peerOp = peerInfo ? peerInfo.operator : "Đồng đội";
        triggerVibrate([150, 80, 150]);
        playSound("duplicate");
        speakText(`Đã trùng! ${peerOp} đã bắn kiện này rồi!`);

        elExportVerdict.innerHTML = `⚠️ KIỆN ĐÃ ĐƯỢC BẮN TRƯỚC ĐÓ!<br><span style="font-size: 0.95rem; font-weight: 500;"><strong>${escapeHtml(peerOp)}</strong> đã xếp kiện ${pkg.pkgIdx}/${pkg.totalPackages} lên xe trên máy khác.</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        setScannerLiveAlert({
            type: "warning",
            title: `⚠️ ${peerOp} ĐÃ BẮN KIỆN NÀY!`,
            subtitle: `Đồng đội đã xếp kiện ${pkg.pkgIdx}/${pkg.totalPackages} lên xe trên máy khác.`,
            icon: "⚠️"
        });

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || pkg.storeCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: `Trùng chéo (${peerOp} đã quét trên máy khác)`
        });
        return "DUPLICATE";
    }

    // 3. VALID PACKAGE SCANNED ONTO TRUCK
    exportState.scannedItems.push({
        uniqueKey: uniqueKey,
        pkg: pkg,
        timestamp: timestamp
    });

    // 3b. DYNAMIC MULTI-DO & PACKAGE CAPACITY EXPANSION
    if (pkg.doNumber) {
        if (!Array.isArray(exportState.storeDos)) exportState.storeDos = [];
        let existingDo = exportState.storeDos.find(d => d.doNumber === pkg.doNumber);
        let doListChanged = false;
        const pkgDoTotal = pkg.totalPackages || pkg.doTotalPackages || 1;

        if (!existingDo) {
            exportState.storeDos.push({
                doNumber: pkg.doNumber,
                soNumber: pkg.soNumber || "",
                packages: pkgDoTotal,
                pkgCount: pkgDoTotal,
                qtyPcs: 0
            });
            doListChanged = true;
        } else if (pkgDoTotal > (existingDo.packages || 0)) {
            existingDo.packages = pkgDoTotal;
            existingDo.pkgCount = pkgDoTotal;
            doListChanged = true;
        }

        if (doListChanged || exportState.isAutoLocked) {
            const sumOfDos = exportState.storeDos.reduce((sum, d) => sum + (d.packages || 0), 0);
            if (sumOfDos > exportState.targetQty) {
                const prevQty = exportState.targetQty;
                exportState.targetQty = sumOfDos;
                showToast(`📦 Phát hiện thêm DO ${pkg.doNumber} (${pkgDoTotal} kiện). Kế hoạch tự động tăng: ${prevQty} ➔ ${exportState.targetQty} kiện!`, "info", 3500);
            }
        }
    }

    saveCurrentStoreProgress();
    saveStoredState();

    // Async Cloud Sync to Google Sheets
    if (window.OnlineSync) {
        window.OnlineSync.recordScan({
            action: "export_scan",
            tripCode: exportState.tripCode || pkg.bks || pkg.lotCode || "KHO_TONG",
            operatorCode: exportState.operatorCode,
            packageCode: uniqueKey,
            doNumber: pkg.doNumber || "",
            chCode: pkg.chCode || pkg.storeCode || "",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "Hợp lệ",
            rawBarcode: pkg.raw,
            timestamp: timestamp
        });
    }

    const myCount = exportState.scannedItems.length;
    const peerCount = (exportState.peerScannedItems || []).length;
    const currentCount = myCount + peerCount;
    const planQty = exportState.targetQty;

    elExportLastPkgStore.textContent = pkgStoreIdentifier;
    elExportLastPkgDo.textContent = pkg.doNumber || "-";
    elExportLastPkgIdx.textContent = `${pkg.pkgIdx}/${pkg.totalPackages}`;

    updateExportUI();

    if (currentCount < planQty) {
        // In progress
        triggerVibrate([80]);
        playSound("success");
        if (wasAutoLockedOnThisScan) {
            speakText(`Khóa ${cleanStoreName(exportState.targetStoreName || pkg.storeName)}, kiện ${currentCount} trên ${planQty}`);
        } else {
            speakText(`Kiện ${currentCount} trên ${planQty}`);
        }

        const lockBanner = wasAutoLockedOnThisScan
            ? `<div style="font-size:0.8rem; color:#38bdf8; margin-bottom:0.2rem;">🔒 Đã tự động khóa <strong>${escapeHtml(exportState.targetStore)}</strong> • Xe: <strong>${escapeHtml(exportState.vehicleLabel || exportState.tripCode)}</strong></div>`
            : "";

        elExportVerdict.innerHTML = `${lockBanner}✅ ĐÚNG CỬA HÀNG: Đã xếp <strong>${currentCount}/${planQty}</strong> kiện (DO ${escapeHtml(pkg.doNumber || "-")}: ${pkg.pkgIdx}/${pkg.totalPackages})<br><span style="font-size: 0.9rem; font-weight: 500;">Còn thiếu <strong>${planQty - currentCount}</strong> kiện của cửa hàng này</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        setScannerLiveAlert({
            type: "success",
            title: `✅ ${exportState.targetStore} (${currentCount}/${planQty} kiện)`,
            subtitle: `Xe: ${exportState.vehicleLabel || exportState.tripCode || "-"} • DO ${pkg.doNumber || "-"} (${pkg.pkgIdx}/${pkg.totalPackages}) • Còn thiếu ${planQty - currentCount} kiện`,
            icon: "📦"
        });

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || pkg.storeCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "success",
            note: `Đúng CH (${currentCount}/${planQty} kiện • Xe ${exportState.tripCode || "-"})`
        });
    } else if (currentCount === planQty) {
        // Completed batch
        triggerVibrate([100, 50, 100, 50, 200]);
        playSound("complete");
        speakText(`Đã đủ ${planQty} kiện cho ${cleanStoreName(exportState.targetStoreName || exportState.targetStore)}!`);

        elExportVerdict.innerHTML = `🎉 ĐÃ ĐỦ 100% SỐ KIỆN CỬA HÀNG!<br><span style="font-size: 0.95rem; font-weight: 600;">Đã xếp đủ ${currentCount}/${planQty} kiện lên xe <strong>${escapeHtml(exportState.vehicleLabel || exportState.tripCode)}</strong> cho <strong>${escapeHtml(exportState.targetStore)}</strong>.<br>👉 <em>Bắn kiện của cửa hàng tiếp theo để tự động chuyển khóa!</em></span>`;
        elExportVerdict.className = "verdict-box verdict-complete";

        setScannerLiveAlert({
            type: "success",
            title: `🎉 ĐỦ LÔ (${currentCount}/${planQty} KIỆN): ${exportState.targetStore}!`,
            subtitle: `Xe ${exportState.vehicleLabel || exportState.tripCode} • Bắn kiện của CH tiếp theo để tự động chuyển khóa!`,
            icon: "🎉"
        });

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || pkg.storeCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "success",
            note: `ĐỦ LÔ XUẤT (${planQty}/${planQty} kiện • Xe ${exportState.tripCode || "-"})`
        });

        // Trigger Batch Completion Modal Workflow after 1.0s delay
        if (!exportState.isBatchCompleted) {
            exportState.isBatchCompleted = true;
            exportState.completedAt = Date.now();
            saveCurrentStoreProgress();
            saveStoredState();
            setTimeout(() => {
                showBatchCompletedModal(exportState.targetStore, exportState.vehicleLabel || exportState.tripCode, currentCount, planQty, myCount, peerCount);
            }, 1000);
        }
    } else {
        // Overscanned
        triggerVibrate([100, 50, 100]);
        playSound("duplicate");
        speakText(`Cảnh báo: Thừa ${currentCount - planQty} kiện`);

        elExportVerdict.innerHTML = `⚠️ CẢNH BÁO: QUÉT THỪA KIỆN!<br><span style="font-size: 0.9rem; font-weight: 500;">Kế hoạch ${planQty} kiện, hiện đã quét ${currentCount} kiện!</span>`;
        elExportVerdict.className = "verdict-box verdict-overscan";

        setScannerLiveAlert({
            type: "warning",
            title: "⚠️ CẢNH BÁO: QUÉT THỪA KIỆN!",
            subtitle: `Kế hoạch ${planQty} kiện, hiện đã quét ${currentCount} kiện!`,
            icon: "⚠️"
        });

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || pkg.storeCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: `THỪA KIỆN (${currentCount}/${planQty} kiện)`
        });
    }
    if (window.WCM_ERGONOMICS && window.WCM_ERGONOMICS.showQuickUndoBar) {
        window.WCM_ERGONOMICS.showQuickUndoBar({
            packageCode: uniqueKey,
            storeCode: exportState.targetStoreCode || pkg.chCode || pkg.storeCode || "",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            progressText: `${currentCount}/${planQty} kiện`
        });
    }

    return "SUCCESS";
}

function renderDoBreakdownUI() {
    const storeCode = exportState.targetStoreCode;
    const dispatchStore = (storeCode && masterDispatch && masterDispatch.byStore) ? masterDispatch.byStore[storeCode] : null;
    let dos = (dispatchStore && Array.isArray(dispatchStore.dos) && dispatchStore.dos.length > 0)
        ? dispatchStore.dos
        : (Array.isArray(exportState.storeDos) ? exportState.storeDos : []);

    // Self-healing / Auto-reconciliation: Auto-discover all unique DOs from scanned items (local & peer)
    const allScanned = (exportState.scannedItems || []).concat(exportState.peerScannedItems || []);
    let dosChanged = false;

    allScanned.forEach(item => {
        const p = item.pkg;
        if (p && p.doNumber) {
            const dNum = p.doNumber;
            const dPkgs = p.totalPackages || p.doTotalPackages || 1;
            let existing = dos.find(d => d.doNumber === dNum);
            if (!existing) {
                const newEntry = {
                    doNumber: dNum,
                    soNumber: p.soNumber || "",
                    packages: dPkgs,
                    pkgCount: dPkgs,
                    qtyPcs: 0
                };
                dos.push(newEntry);
                if (Array.isArray(exportState.storeDos) && !exportState.storeDos.some(d => d.doNumber === dNum)) {
                    exportState.storeDos.push(newEntry);
                }
                dosChanged = true;
            } else if (dPkgs > (existing.packages || 0)) {
                existing.packages = dPkgs;
                existing.pkgCount = dPkgs;
                dosChanged = true;
            }
        }
    });

    const sumDos = dos.reduce((sum, d) => sum + (d.packages || 0), 0);
    if (sumDos > exportState.targetQty) {
        exportState.targetQty = sumDos;
        dosChanged = true;
    }

    if (dosChanged) {
        saveCurrentStoreProgress();
        saveStoredState();
    }

    if (!exportState.isBatchActive || dos.length === 0) {
        if (elSummaryDoBreakdown) {
            elSummaryDoBreakdown.style.display = "none";
            elSummaryDoBreakdown.innerHTML = "";
        }
        if (elExportActiveDoList) {
            elExportActiveDoList.style.display = "none";
            elExportActiveDoList.innerHTML = "";
        }
        return;
    }

    const scannedByDo = {};
    allScanned.forEach(item => {
        const d = item.pkg && item.pkg.doNumber ? item.pkg.doNumber : "";
        if (d) scannedByDo[d] = (scannedByDo[d] || 0) + 1;
    });

    let summaryHtml = `<div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 0.25rem; font-weight: 600;">📋 Chi tiết ${dos.length} đơn DO của cửa hàng (Tổng ${exportState.targetQty} kiện):</div><div style="display: flex; flex-wrap: wrap; gap: 0.35rem;">`;
    let activeDoHtml = "";

    dos.forEach(d => {
        const done = scannedByDo[d.doNumber] || 0;
        const total = d.packages || 1;
        const isDone = done >= total;
        const bg = isDone ? "rgba(16, 185, 129, 0.2)" : (done > 0 ? "rgba(56, 189, 248, 0.18)" : "rgba(30, 41, 59, 0.85)");
        const border = isDone ? "rgba(16, 185, 129, 0.55)" : (done > 0 ? "rgba(56, 189, 248, 0.45)" : "#334155");
        const color = isDone ? "#34d399" : (done > 0 ? "#38bdf8" : "#cbd5e1");
        const icon = isDone ? "✅" : "📦";

        const pill = `<span style="display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700; background: ${bg}; border: 1px solid ${border}; color: ${color};">${icon} DO ${escapeHtml(d.doNumber)}: ${done}/${total} kiện</span>`;
        summaryHtml += pill;
        activeDoHtml += pill;
    });

    summaryHtml += `</div>`;

    if (elSummaryDoBreakdown) {
        elSummaryDoBreakdown.innerHTML = summaryHtml;
        elSummaryDoBreakdown.style.display = "block";
    }
    if (elExportActiveDoList) {
        elExportActiveDoList.innerHTML = activeDoHtml;
        elExportActiveDoList.style.display = "flex";
    }
}

function updateExportProgress() {
    const myCount = exportState.scannedItems.length;
    let peerCount = 0;
    if (exportState.peerScannedItems && Array.isArray(exportState.peerScannedItems)) {
        peerCount = exportState.peerScannedItems.length;
    }
    const combinedCurrent = myCount + peerCount;
    const total = exportState.targetQty;

    if (exportState.tripCode && peerCount > 0) {
        elExportProgressText.textContent = `${combinedCurrent} / ${total} Kiện (Tôi: ${myCount}, Bạn: ${peerCount})`;
    } else {
        elExportProgressText.textContent = `${combinedCurrent} / ${total} Kiện`;
    }

    const pct = total > 0 ? Math.min(100, (combinedCurrent / total) * 100) : 0;
    elExportProgressBar.style.width = pct + "%";

    if (combinedCurrent === total && total > 0) {
        elExportProgressBar.className = "progress-bar-fill complete";
    } else {
        elExportProgressBar.className = "progress-bar-fill";
    }

    if (elPeerMyCount) elPeerMyCount.textContent = myCount;
    if (elPeerPartnerCount) elPeerPartnerCount.textContent = peerCount;
    if (elPeerTripDisplay) elPeerTripDisplay.textContent = exportState.vehicleLabel || exportState.tripCode || "-";
    if (elPeerProgressBox) {
        elPeerProgressBox.style.display = exportState.tripCode ? "flex" : "none";
    }
    renderDoBreakdownUI();
}

function updateExportUI() {
    if (exportState.isBatchActive) {
        const sttBadge = exportState.sttCh ? ` • STT CH.${exportState.sttCh}` : "";
        const vehicleText = (exportState.vehicleLabel || exportState.tripCode || "Tự động") + sttBadge;

        elSummaryStore.textContent = exportState.targetStore;
        elSummaryStore.style.color = "#34d399";
        if (elSummaryVehicle) elSummaryVehicle.textContent = `🚛 Xe: ${vehicleText}`;
        elSummaryQty.textContent = exportState.targetQty;

        elExportActiveStoreDisplay.textContent = exportState.targetStore;
        if (elExportActiveVehicleDisplay) {
            elExportActiveVehicleDisplay.textContent = `🚛 Xe: ${vehicleText}`;
        }
        elExportStatusBadge.textContent = "🔒 Đang khóa CH";
        elExportStatusBadge.className = "badge badge-success";

        if (elExportTargetStore) elExportTargetStore.value = exportState.targetStore;
        if (elExportTargetQty) elExportTargetQty.value = exportState.targetQty;
        if (elExportTripCode) elExportTripCode.value = exportState.tripCode || "";
        if (elExportOperatorCode) elExportOperatorCode.value = exportState.operatorCode || (window.OnlineSync ? window.OnlineSync.getOperatorCode() : "NV01");
        if (elBtnUndoLastScan) elBtnUndoLastScan.style.display = exportState.scannedItems.length > 0 ? "inline-block" : "none";
        if (elBtnReassignBatch) elBtnReassignBatch.style.display = exportState.scannedItems.length > 0 ? "inline-block" : "none";
        if (elBtnOpenScannedDrawer) {
            const count = exportState.scannedItems ? exportState.scannedItems.length : 0;
            elBtnOpenScannedDrawer.style.display = count > 0 ? "inline-block" : "none";
            if (elBtnScannedCountBadge) elBtnScannedCountBadge.textContent = count;
        }
        updateExportProgress();
    } else {
        elSummaryStore.textContent = "🔓 Chờ bắn kiện đầu tiên...";
        elSummaryStore.style.color = "#fde047";
        if (elSummaryVehicle) elSummaryVehicle.textContent = "🚛 Xe / Mã giờ: Tự động nhận diện khi quét";
        elSummaryQty.textContent = "0";
        if (elSummaryDoBreakdown) {
            elSummaryDoBreakdown.style.display = "none";
            elSummaryDoBreakdown.innerHTML = "";
        }

        elExportActiveStoreDisplay.textContent = "SẴN SÀNG — BẮN KIỆN ĐẦU TIÊN ĐỂ KHÓA CH";
        if (elExportActiveVehicleDisplay) {
            elExportActiveVehicleDisplay.textContent = "🚛 Xe / Mã giờ: Tự động nhận diện từ File Kho Tổng Chốt";
        }
        if (elExportActiveDoList) {
            elExportActiveDoList.style.display = "none";
            elExportActiveDoList.innerHTML = "";
        }
        elExportStatusBadge.textContent = "🔓 Tự động nhận diện";
        elExportStatusBadge.className = "badge badge-warning";
        elExportProgressText.textContent = "0 / 0 Kiện";
        elExportProgressBar.style.width = "0%";
        elExportVerdict.innerHTML = "⚡ <strong>CHẾ ĐỘ TỰ ĐỘNG:</strong> Bắn bất kỳ <strong>Mã QR kiện hàng / Số DO / Mã Cửa Hàng</strong> để tự động khóa Cửa hàng, Xe & Tổng số kiện!";
        elExportVerdict.className = "verdict-box verdict-empty";
        elExportLastPkgStore.textContent = "-";
        elExportLastPkgDo.textContent = "-";
        elExportLastPkgIdx.textContent = "-";
        if (elBtnUndoLastScan) elBtnUndoLastScan.style.display = "none";
        if (elBtnReassignBatch) elBtnReassignBatch.style.display = "none";
        if (elBtnOpenScannedDrawer) elBtnOpenScannedDrawer.style.display = "none";
        if (elPeerProgressBox) elPeerProgressBox.style.display = "none";
    }
}

// =============================================================================
// PHASE 3: OUTBOUND BATCH WORKFLOW, DASHBOARD & BULK UNDO
// =============================================================================

// Batch Completion Modal
function showBatchCompletedModal(store, trip, total, planQty, myCount, peerCount) {
    if (!elModalBatchCompleted) return;
    if (elModalCompleteStore) elModalCompleteStore.textContent = store || "Chưa rõ";
    if (elModalCompleteTrip) elModalCompleteTrip.textContent = `Xe: ${trip || "-"}`;
    if (elModalCompleteQty) elModalCompleteQty.textContent = `${total} / ${planQty} kiện (Đạt 100%)`;
    if (elModalCompleteBreakdown) elModalCompleteBreakdown.textContent = `Tôi: ${myCount} kiện | Đồng đội: ${peerCount} kiện`;

    elModalBatchCompleted.style.display = "flex";
    if (elBtnModalNextBatch) {
        setTimeout(() => elBtnModalNextBatch.focus(), 150);
    }
}

function closeBatchCompletedModal() {
    if (elModalBatchCompleted) elModalBatchCompleted.style.display = "none";
}

// All Trips Progress Dashboard
let tripDashboardPollTimer = null;

function openTripDashboard() {
    if (!elModalTripDashboard) return;
    elModalTripDashboard.style.display = "flex";
    fetchAndRenderTripDashboard();
    if (tripDashboardPollTimer) clearInterval(tripDashboardPollTimer);
    tripDashboardPollTimer = setInterval(fetchAndRenderTripDashboard, 10000);
}

function closeTripDashboard() {
    if (!elModalTripDashboard) return;
    elModalTripDashboard.style.display = "none";
    if (tripDashboardPollTimer) {
        clearInterval(tripDashboardPollTimer);
        tripDashboardPollTimer = null;
    }
    triggerFocus();
}

async function fetchAndRenderTripDashboard() {
    if (!elDashTripsList) return;

    let tripsData = [];

    // 1. Try live from Google Sheets
    if (window.OnlineSync && window.OnlineSync.getAllTripsProgress && navigator.onLine) {
        try {
            tripsData = await window.OnlineSync.getAllTripsProgress();
        } catch (e) {
            console.warn("[TripDashboard] Live fetch failed, fallback to local:", e);
        }
    }

    // 2. Local fallback from Master Dispatch (File Kho Tổng Chốt) if offline or no sheet data
    if (!tripsData || tripsData.length === 0) {
        const localTrips = {};
        const dispatchStores = getMasterDispatchStoreArray();

        if (dispatchStores.length > 0) {
            dispatchStores.forEach(st => {
                const tKey = st.bks || st.lotCode || "CHUA_GAN_XE";
                if (!localTrips[tKey]) {
                    localTrips[tKey] = {
                        tripCode: tKey,
                        vehicleLabel: st.vehicleLabel || tKey,
                        plannedTotal: 0,
                        totalExported: 0,
                        totalInbound: 0,
                        stores: [],
                        operators: {},
                        lastActive: "Chưa quét"
                    };
                }
                const prog = (storeProgressMap && storeProgressMap[st.storeCode]) ? storeProgressMap[st.storeCode] : null;
                const scannedCount = (exportState.isBatchActive && exportState.targetStoreCode === st.storeCode)
                    ? (exportState.scannedItems ? exportState.scannedItems.length : 0)
                    : (prog && Array.isArray(prog.scannedItems) ? prog.scannedItems.length : 0);

                localTrips[tKey].plannedTotal += (st.totalPackages || 0);
                localTrips[tKey].totalExported += scannedCount;
                localTrips[tKey].stores.push({
                    code: st.storeCode,
                    name: `[${st.storeCode}] ${st.storeName}`,
                    count: scannedCount,
                    planned: st.totalPackages || 0
                });
                if (scannedCount > 0) {
                    localTrips[tKey].lastActive = "Đang xếp hàng";
                }
            });
        } else {
            Object.keys(PRESET_TRIP_STORES).forEach(tripCode => {
                localTrips[tripCode] = {
                    tripCode: tripCode,
                    totalExported: 0,
                    totalInbound: 0,
                    stores: PRESET_TRIP_STORES[tripCode].map(s => ({ code: s.storeCode, name: s.storeName, count: 0 })),
                    operators: {},
                    lastActive: "Chưa quét"
                };
            });
        }

        tripsData = Object.values(localTrips);
    }

    renderTripDashboard(tripsData);
}

function renderTripDashboard(tripsData) {
    if (!elDashTripsList) return;

    const totalTrips = tripsData.length;
    let totalPkgs = 0;
    let activeTrips = 0;

    tripsData.forEach(t => {
        const count = t.totalExported || 0;
        totalPkgs += count;
        if (count > 0) activeTrips++;
    });

    if (elDashTotalTrips) elDashTotalTrips.textContent = totalTrips;
    if (elDashTotalPkgs) elDashTotalPkgs.textContent = totalPkgs;
    if (elDashActiveTrips) elDashActiveTrips.textContent = activeTrips;

    elDashTripsList.innerHTML = "";

    if (tripsData.length === 0) {
        elDashTripsList.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 2rem;">Chưa có dữ liệu chuyến xe nào.</div>`;
        return;
    }

    tripsData.forEach(trip => {
        const card = document.createElement("div");
        card.className = "trip-dash-card";

        const isCurrentTrip = (exportState.tripCode === trip.tripCode);
        const count = trip.totalExported || 0;
        const inboundCount = trip.totalInbound || 0;

        let plannedTotal = trip.plannedTotal || 0;
        if (!plannedTotal && PRESET_TRIP_STORES[trip.tripCode]) {
            plannedTotal = PRESET_TRIP_STORES[trip.tripCode].reduce((sum, s) => sum + (s.totalQty || 0), 0);
        }
        const pct = plannedTotal > 0 ? Math.min(100, Math.round((count / plannedTotal) * 100)) : (count > 0 ? 100 : 0);

        let statusBadge = `<span class="trip-dash-badge empty">${ Array.isArray(trip.stores) ? trip.stores.length + ' CH' : 'Chưa bắt đầu' }</span>`;
        if (count > 0) {
            statusBadge = `<span class="trip-dash-badge active">Đang xếp xe (${count}${plannedTotal ? '/' + plannedTotal : ''} kiện)</span>`;
        }

        const opList = trip.operators ? Object.keys(trip.operators).map(op => `${op}: ${trip.operators[op]}`).join(" | ") : "";

        let storesSummary = "";
        if (Array.isArray(trip.stores) && trip.stores.length > 0) {
            storesSummary = trip.stores.slice(0, 6).map(s => {
                const sName = s.code || s.name || "CH";
                const sCount = s.count || 0;
                const sPlan = s.planned ? `/${s.planned}` : "";
                return `<span class="trip-meta-pill">🏪 ${escapeHtml(sName)}: <strong>${sCount}${sPlan}</strong></span>`;
            }).join(" ");
            if (trip.stores.length > 6) {
                storesSummary += ` <span class="trip-meta-pill">+${trip.stores.length - 6} CH khác</span>`;
            }
        }

        card.innerHTML = `
            <div class="trip-dash-header">
                <div class="trip-dash-title">
                    <span>🚛 Xe ${escapeHtml(trip.vehicleLabel || trip.tripCode)}</span>
                    ${isCurrentTrip ? '<span class="badge badge-success" style="font-size: 0.68rem; margin-left: 6px;">Đang khóa</span>' : ''}
                </div>
                ${statusBadge}
            </div>

            <div class="trip-dash-progress-row">
                <div class="trip-dash-progress-bar">
                    <div class="trip-dash-progress-fill" style="width: ${pct}%;"></div>
                </div>
                <span style="font-size: 0.8rem; font-weight: 700; color: #fff; min-width: 60px; text-align: right;">
                    ${count}${plannedTotal > 0 ? ' / ' + plannedTotal : ''} kiện
                </span>
            </div>

            <div class="trip-dash-meta-pills" style="margin-bottom: 0.6rem;">
                ${inboundCount > 0 ? `<span class="trip-meta-pill" style="color: #34d399;">📥 Đã dỡ: <strong>${inboundCount}</strong></span>` : ''}
                ${opList ? `<span class="trip-meta-pill">👥 ${opList}</span>` : ''}
                ${trip.lastActive ? `<span class="trip-meta-pill" style="color: #94a3b8;">🕒 ${trip.lastActive}</span>` : ''}
            </div>

            ${storesSummary ? `<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 0.6rem;">${storesSummary}</div>` : ''}
        `;

        elDashTripsList.appendChild(card);
    });
}

// Scanned Packages Drawer (Bulk Undo)
function openScannedPackagesDrawer() {
    if (!elModalScannedPackages) return;
    elModalScannedPackages.style.display = "flex";
    if (elInputFilterBatchPkgs) {
        elInputFilterBatchPkgs.value = "";
    }
    renderScannedPackagesList("");
}

function closeScannedPackagesDrawer() {
    if (!elModalScannedPackages) return;
    elModalScannedPackages.style.display = "none";
    triggerFocus();
}

function renderScannedPackagesList(filterText) {
    if (!elBatchPkgsList) return;

    const items = exportState.scannedItems || [];
    const cleanFilter = (filterText || "").trim().toLowerCase();

    const filtered = items.filter(item => {
        if (!cleanFilter) return true;
        const key = (item.uniqueKey || "").toLowerCase();
        const doNum = (item.pkg && item.pkg.doNumber ? item.pkg.doNumber : "").toLowerCase();
        const store = (item.pkg && (item.pkg.storeName || item.pkg.chCode) ? (item.pkg.storeName || item.pkg.chCode) : "").toLowerCase();
        return key.includes(cleanFilter) || doNum.includes(cleanFilter) || store.includes(cleanFilter);
    });

    if (elBatchPkgsCountTag) {
        elBatchPkgsCountTag.textContent = `${filtered.length} / ${items.length} kiện`;
    }

    elBatchPkgsList.innerHTML = "";

    if (items.length === 0) {
        elBatchPkgsList.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 2rem;">Lô này chưa có kiện nào được quét.</div>`;
        return;
    }

    if (filtered.length === 0) {
        elBatchPkgsList.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 1.5rem;">Không tìm thấy kiện nào khớp với từ khóa "${filterText}".</div>`;
        return;
    }

    filtered.slice().reverse().forEach((item, revIdx) => {
        const originalIdx = items.indexOf(item);
        const pkg = item.pkg || {};
        const div = document.createElement("div");
        div.className = "scanned-pkg-item";

        const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
        const doDisplay = pkg.doNumber ? `DO: ${pkg.doNumber}` : "";
        const idxDisplay = (pkg.pkgIdx && pkg.totalPackages) ? `Kiện ${pkg.pkgIdx}/${pkg.totalPackages}` : "";

        div.innerHTML = `
            <div class="scanned-pkg-info">
                <div class="scanned-pkg-code">#${originalIdx + 1} - ${item.uniqueKey}</div>
                <div class="scanned-pkg-sub">
                    <span>${doDisplay}</span>
                    <span>${idxDisplay}</span>
                    <span>🕒 ${timeStr}</span>
                </div>
            </div>
            <button type="button" class="scanned-pkg-undo-btn" title="Hủy kiện này khỏi lô xuất">
                ❌ Hủy Kiện
            </button>
        `;

        const undoBtn = div.querySelector(".scanned-pkg-undo-btn");
        undoBtn.addEventListener("click", () => {
            if (confirm(`Bạn có chắc muốn HỦY KIỆN sau khỏi lô:\n${item.uniqueKey} (${doDisplay})?`)) {
                const delIdx = exportState.scannedItems.indexOf(item);
                if (delIdx !== -1) {
                    exportState.scannedItems.splice(delIdx, 1);
                    exportState.isBatchCompleted = false;
                    saveCurrentStoreProgress();
                    saveStoredState();
                    updateExportUI();
                    speakText("Đã hủy kiện");

                    if (window.OnlineSync && window.OnlineSync.undoScan) {
                        window.OnlineSync.undoScan({
                            tripCode: exportState.tripCode,
                            packageCode: item.uniqueKey
                        });
                    }

                    logHistory({
                        timestamp: new Date().toISOString(),
                        mode: "Xuất",
                        chCode: pkg.chCode || "-",
                        doNumber: pkg.doNumber || "-",
                        storeName: exportState.targetStore,
                        pkgIdxText: idxDisplay || "-",
                        status: "warning",
                        note: `ĐÃ HỦY KIỆN (${item.uniqueKey})`
                    });

                    renderScannedPackagesList(elInputFilterBatchPkgs ? elInputFilterBatchPkgs.value : "");
                    showToast(`Đã hủy kiện #${delIdx + 1}`);
                }
            }
        });

        elBatchPkgsList.appendChild(div);
    });
}

// =============================================================================
// AUDIT LOG & REPORT EXPORT (Windowed DOM Rendering: 50 rows visible, 1000 stored)
// =============================================================================
let historyRenderLimit = 50;

function logHistory(entry) {
    scanHistory.unshift(entry);
    if (scanHistory.length > 1000) scanHistory.pop();
    saveStoredState();
    renderHistory();
}

function renderHistory() {
    const elLoadMoreWrap = document.getElementById("history-load-more-wrap");
    const elBtnLoadMore = document.getElementById("btn-load-more-history");

    if (elBtnLoadMore && !elBtnLoadMore.dataset.bound) {
        elBtnLoadMore.dataset.bound = "1";
        elBtnLoadMore.addEventListener("click", () => {
            historyRenderLimit += 50;
            renderHistory();
        });
    }

    if (scanHistory.length === 0) {
        historyRenderLimit = 50;
        if (elLoadMoreWrap) elLoadMoreWrap.style.display = "none";
        elHistoryLogBody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center" style="color: var(--text-muted); padding: 2rem;">
                    Chưa có hoạt động quét nào trong phiên làm việc này.
                </td>
            </tr>
        `;
        return;
    }

    const visibleSlice = scanHistory.slice(0, historyRenderLimit);
    if (elLoadMoreWrap && elBtnLoadMore) {
        if (scanHistory.length > historyRenderLimit) {
            elLoadMoreWrap.style.display = "block";
            elBtnLoadMore.textContent = `📜 Xem thêm 50 dòng cũ hơn (Đang hiển thị ${visibleSlice.length} / ${scanHistory.length} lượt quét)`;
        } else {
            elLoadMoreWrap.style.display = "none";
        }
    }

    elHistoryLogBody.innerHTML = visibleSlice.map(log => {
        let statusBadge = "";
        if (log.status === "success") {
            statusBadge = `<span class="badge badge-success">✓ Hợp lệ</span>`;
        } else if (log.status === "warning") {
            statusBadge = `<span class="badge badge-warning">⚠ Cảnh báo</span>`;
        } else {
            statusBadge = `<span class="badge badge-error">✗ Lỗi</span>`;
        }

        const modeBadge = log.mode === "Xuất" ?
            `<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.15); color: var(--accent-yellow);">📤 Xuất</span>` :
            `<span class="badge badge-success" style="background: rgba(0, 161, 154, 0.15); color: var(--accent-teal);">📥 Nhập</span>`;

        return `
            <tr>
                <td>${log.timestamp}</td>
                <td style="text-align: center;">${modeBadge}</td>
                <td style="font-weight: 800; color: #38bdf8;">${log.chCode}</td>
                <td style="font-family: monospace; font-weight: 600;">${log.doNumber}</td>
                <td>${log.storeName}</td>
                <td style="text-align: center; font-weight: 700;">${log.pkgIdxText}</td>
                <td style="text-align: center;">${statusBadge}</td>
                <td style="font-size: 0.8rem; color: var(--text-secondary);">${log.note}</td>
            </tr>
        `;
    }).join("");
}

function exportScanReportCSV() {
    if (scanHistory.length === 0) {
        alert("Chưa có lịch sử quét nào để xuất báo cáo!");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // BOM for Excel UTF-8
    csvContent += "Thời gian,Hướng,Vị trí CH,Số DO,Tên cửa hàng,Kiện,Đánh giá,Ghi chú\n";

    scanHistory.forEach(log => {
        const row = [
            `"${log.timestamp}"`,
            `"${log.mode}"`,
            `"${log.chCode}"`,
            `"${log.doNumber}"`,
            `"${log.storeName}"`,
            `"${log.pkgIdxText}"`,
            `"${log.status === 'success' ? 'Hợp lệ' : log.status === 'warning' ? 'Cảnh báo' : 'Lỗi'}"`,
            `"${log.note}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Bao_cao_quet_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// =============================================================================
// OFFLINE AUDIO SYNTH (Web Audio API - Zero network calls)
// =============================================================================
function unlockAudio() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch (e) {}
}

function triggerVibrate(pattern) {
    if (!settings.vibrateEnabled) return;
    if (navigator.vibrate) {
        try { navigator.vibrate(pattern); } catch (e) {}
    }
}

function playSound(type) {
    if (!settings.soundEnabled) return;
    try {
        unlockAudio();
        if (!audioCtx) return;

        const now = audioCtx.currentTime;

        if (type === 'success') {
            // High-pitched short crisp beep (A5 880Hz)
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(880, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
        } else if (type === 'complete') {
            // Success fanfare: 4 rising celebratory notes
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, idx) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                const startTime = now + (idx * 0.08);
                osc.frequency.setValueAtTime(freq, startTime);
                gain.gain.setValueAtTime(0.12, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);
                osc.start(startTime);
                osc.stop(startTime + 0.15);
            });
        } else if (type === 'duplicate') {
            // Double warning beep
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(440, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.setValueAtTime(0, now + 0.06);
            gain.gain.setValueAtTime(0.1, now + 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.start(now);
            osc.stop(now + 0.22);
        } else if (type === 'wrong_store') {
            // Siren alarm: 2 alternating harsh bursts (750Hz <-> 400Hz)
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(750, now);
            osc.frequency.setValueAtTime(400, now + 0.12);
            osc.frequency.setValueAtTime(750, now + 0.24);
            osc.frequency.setValueAtTime(400, now + 0.36);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        } else if (type === 'error') {
            // Low buzz (130Hz)
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(130, now);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        }
    } catch (e) {
        console.warn("Audio playback error", e);
    }
}

// =============================================================================
// OFFLINE TEXT-TO-SPEECH (Web Speech API Native)
// =============================================================================
function initSpeechSynthesis() {
    if (!('speechSynthesis' in window)) return;
    populateVoiceList();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }
}

function populateVoiceList() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    const viVoices = voices.filter(v => v.lang.toLowerCase().includes("vi"));

    if (viVoices.length === 0) {
        elSelectVoice.innerHTML = `<option value="">Mặc định thiết bị</option>`;
        return;
    }

    elSelectVoice.innerHTML = viVoices.map(v => `<option value="${v.name}">🇻🇳 ${v.name}</option>`).join("");
    if (settings.preferredVoiceName) {
        elSelectVoice.value = settings.preferredVoiceName;
    }
}

function speakText(text) {
    if (!settings.ttsEnabled) return;
    if (!('speechSynthesis' in window)) return;

    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);

        const voices = window.speechSynthesis.getVoices();
        let voice = voices.find(v => v.name === settings.preferredVoiceName);
        if (!voice) voice = voices.find(v => v.lang.toLowerCase().includes("vi"));

        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else {
            utterance.lang = 'vi-VN';
        }
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn("TTS speak error", e);
    }
}

// =============================================================================
// CAMERA SCANNER CONTROLLER (Dual-Engine: Hardware BarcodeDetector + WebAssembly ZXing-C++)
// =============================================================================
let isCameraRunning = false;
let currentMediaStream = null;
let currentVideoTrack = null;
let torchActive = false;
let scanRafId = null;
let isProcessingFrame = false;
let lastFrameScanTime = 0;
let lastCameraScan = { text: "", time: 0 };
const SCAN_FRAME_INTERVAL_MS = 80; // ~12 fps scan rate for optimal battery and high responsiveness

// Offscreen canvas for frame extraction
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

// Hardware BarcodeDetector instance if supported by browser
let nativeDetector = null;
if (typeof BarcodeDetector !== "undefined") {
    try {
        nativeDetector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch (e) {
        console.log("Native BarcodeDetector not available:", e);
    }
}

// Ensure ZXing-WASM is initialized with local wasm file
let zxingReady = false;
function ensureZXingConfigured() {
    if (zxingReady) return true;
    if (typeof ZXingWASM !== "undefined" && ZXingWASM.setZXingModuleOverrides) {
        if (!window.__INLINE_WASM_LOADED__) {
            ZXingWASM.setZXingModuleOverrides({
                locateFile: (path) => path.endsWith(".wasm") ? "zxing_reader.wasm" : path
            });
        }
        zxingReady = true;
        return true;
    }
    return false;
}

function onCameraScanSuccess(decodedText) {
    const now = Date.now();
    // 1. Debounce cùng 1 mã vạch trong 3.5 giây để tránh camera quét lặp đi lặp lại khi người dùng chưa kịp dời máy
    if (decodedText === lastCameraScan.text && now - lastCameraScan.time < 3500) {
        return;
    }
    // 2. Khoảng cách tối thiểu 800ms giữa 2 mã vạch bất kỳ
    if (now - lastCameraScan.time < 800) {
        return;
    }
    lastCameraScan = { text: decodedText, time: now };

    // Trigger visual green flash on camera HUD
    triggerCameraScanFlash();

    // Process scanned barcode
    handleBarcodeScanned(decodedText);
}

function triggerCameraScanFlash() {
    const container = document.querySelector(".camera-viewport-container");
    if (container) {
        container.classList.remove("scan-flash");
        void container.offsetWidth; // Force CSS reflow
        container.classList.add("scan-flash");
    }
}

async function toggleCamera() {
    if (isCameraRunning) {
        stopCamera();
    } else {
        await startCamera();
    }
}

async function startCamera(preferredDeviceId = null) {
    stopCamera();
    ensureZXingConfigured();
    elScannerStatus.textContent = "Đang kết nối camera...";

    const constraints = {
        video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 }
        },
        audio: false
    };

    if (preferredDeviceId) {
        constraints.video.deviceId = { exact: preferredDeviceId };
    } else {
        constraints.video.facingMode = { ideal: "environment" };
    }

    try {
        currentMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        elCameraVideo.srcObject = currentMediaStream;
        await elCameraVideo.play();

        currentVideoTrack = currentMediaStream.getVideoTracks()[0];

        // Configure Torch (Flashlight)
        checkAndSetupTorch();

        // Configure Continuous Autofocus
        tryApplyContinuousFocus();

        // Enumerate devices now that permission is granted
        const activeDeviceId = currentVideoTrack.getSettings?.()?.deviceId;
        await enumerateAndPopulateCameras(activeDeviceId);

        elCameraWrapper.style.display = "block";
        elBtnToggleCamera.textContent = "🛑 Tắt Camera";
        elBtnToggleCamera.className = "btn btn-danger";
        elScannerStatus.textContent = "Máy quét đang hoạt động (Độ nhạy cao)";

        isCameraRunning = true;
        lastFrameScanTime = 0;
        runScannerLoop();
    } catch (err) {
        console.error("Camera access failed:", err);
        elScannerStatus.textContent = "Lỗi bật camera: " + (err.name || err.message);
        alert("Không thể mở camera. Vui lòng cấp quyền truy cập camera trong cài đặt trình duyệt của bạn.");
    }
}

function stopCamera() {
    isCameraRunning = false;
    if (scanRafId) {
        cancelAnimationFrame(scanRafId);
        scanRafId = null;
    }
    if (currentMediaStream) {
        currentMediaStream.getTracks().forEach(track => track.stop());
        currentMediaStream = null;
    }
    currentVideoTrack = null;
    torchActive = false;

    if (elCameraVideo) {
        elCameraVideo.srcObject = null;
    }
    if (elCameraWrapper) {
        elCameraWrapper.style.display = "none";
    }
    if (elBtnToggleCamera) {
        elBtnToggleCamera.textContent = "📷 Bật Camera";
        elBtnToggleCamera.className = "btn btn-primary";
    }
    if (elBtnToggleTorch) {
        elBtnToggleTorch.style.display = "none";
        elBtnToggleTorch.textContent = "🔦 Đèn Flash";
        elBtnToggleTorch.className = "btn btn-secondary";
    }
    if (elScannerStatus) {
        elScannerStatus.textContent = "Máy quét camera đang tắt";
    }
}

function checkAndSetupTorch() {
    if (!currentVideoTrack) return;
    const caps = currentVideoTrack.getCapabilities?.() || {};
    if (caps.torch) {
        elBtnToggleTorch.style.display = "inline-flex";
        torchActive = false;
        elBtnToggleTorch.textContent = "🔦 Bật Đèn";
        elBtnToggleTorch.className = "btn btn-secondary";
    } else {
        elBtnToggleTorch.style.display = "none";
    }
}

async function toggleTorch() {
    if (!currentVideoTrack) return;
    try {
        const caps = currentVideoTrack.getCapabilities?.() || {};
        if (!caps.torch) {
            alert("Thiết bị này không hỗ trợ điều khiển đèn Flash từ trình duyệt.");
            return;
        }
        torchActive = !torchActive;
        await currentVideoTrack.applyConstraints({
            advanced: [{ torch: torchActive }]
        });
        elBtnToggleTorch.textContent = torchActive ? "🔦 Tắt Đèn" : "🔦 Bật Đèn";
        elBtnToggleTorch.className = torchActive ? "btn btn-warning" : "btn btn-secondary";
    } catch (e) {
        console.warn("Torch toggle failed:", e);
    }
}

async function tryApplyContinuousFocus() {
    if (!currentVideoTrack) return;
    try {
        const caps = currentVideoTrack.getCapabilities?.() || {};
        if (caps.focusMode && caps.focusMode.includes("continuous")) {
            await currentVideoTrack.applyConstraints({
                advanced: [{ focusMode: "continuous" }]
            });
        }
    } catch (e) {
        // Continuous focus not supported on this track, silent pass
    }
}

async function enumerateAndPopulateCameras(activeDeviceId) {
    try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === "videoinput");
        if (videoInputs.length === 0) return;

        elCameraSelect.innerHTML = videoInputs.map((d, i) => {
            const label = d.label || `Camera ${i + 1}`;
            const isSelected = activeDeviceId ? (d.deviceId === activeDeviceId) : (i === 0);
            return `<option value="${d.deviceId}" ${isSelected ? 'selected' : ''}>${label}</option>`;
        }).join("");
    } catch (e) {
        console.warn("enumerateDevices failed:", e);
    }
}

// Continuous frame loop with throttling
async function runScannerLoop() {
    if (!isCameraRunning) return;

    const now = performance.now();
    if (now - lastFrameScanTime >= SCAN_FRAME_INTERVAL_MS && !isProcessingFrame) {
        if (elCameraVideo.readyState >= 2 && elCameraVideo.videoWidth > 0) {
            isProcessingFrame = true;
            lastFrameScanTime = now;
            try {
                await decodeCurrentVideoFrame();
            } catch (err) {
                // Ignore transient frame errors
            } finally {
                isProcessingFrame = false;
            }
        }
    }

    if (isCameraRunning) {
        scanRafId = requestAnimationFrame(runScannerLoop);
    }
}

async function decodeCurrentVideoFrame() {
    const vw = elCameraVideo.videoWidth;
    const vh = elCameraVideo.videoHeight;
    if (!vw || !vh) return;

    // Fast-Path: Native BarcodeDetector (Runs in ~10ms on Android Chrome)
    if (nativeDetector) {
        try {
            const t0 = performance.now();
            const detected = await nativeDetector.detect(elCameraVideo);
            if (detected && detected.length > 0) {
                const code = detected[0].rawValue;
                if (code) {
                    const t1 = performance.now();
                    window.__lastDecodeTelemetry = { decoder: "BarcodeDetector", latencyMs: Math.round(t1 - t0) };
                    onCameraScanSuccess(code);
                    return;
                }
            }
        } catch (e) {
            // Native detector may throw or return empty
        }
    }

    // High-Accuracy Path: ZXing-WASM WebAssembly C++ engine (Decodes dense/tilted/glare QR in ~40ms)
    if (typeof ZXingWASM !== "undefined" && ZXingWASM.readBarcodesFromImageData) {
        ensureZXingConfigured();

        // Downscale to max 1280 to preserve fine barcode features while optimizing CPU
        const maxDim = 1280;
        let dw = vw;
        let dh = vh;
        if (dw > maxDim || dh > maxDim) {
            const scale = maxDim / Math.max(dw, dh);
            dw = Math.round(dw * scale);
            dh = Math.round(dh * scale);
        }

        if (offscreenCanvas.width !== dw || offscreenCanvas.height !== dh) {
            offscreenCanvas.width = dw;
            offscreenCanvas.height = dh;
        }

        offscreenCtx.drawImage(elCameraVideo, 0, 0, dw, dh);
        const imgData = offscreenCtx.getImageData(0, 0, dw, dh);

        const t0 = performance.now();
        const barcodes = await ZXingWASM.readBarcodesFromImageData(imgData, {
            formats: ["QRCode"],
            tryHarder: true,
            tryRotate: true
        });
        const t1 = performance.now();

        if (barcodes && barcodes.length > 0) {
            const code = barcodes[0].text;
            if (code) {
                window.__lastDecodeTelemetry = { decoder: "ZXing-WASM", latencyMs: Math.round(t1 - t0) };
                onCameraScanSuccess(code);
            }
        }
    }
}

