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
    byDo: {},  // doNumber -> storeName
    byCh: {}   // chCode -> storeName
};

// Import Mode State (Set of unique package identifiers)
let importScannedKeys = new Set();

// Export Mode State (Hỗ trợ 2 người bắn đồng thời)
let exportState = {
    targetStore: "",      // e.g. "CH.2.24" or "Tân Thủy"
    targetQty: 0,         // e.g. 15
    tripCode: "",         // e.g. "1392"
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
const elExportOperatorCode = document.getElementById("export-operator-code");
const elExportTargetStore = document.getElementById("export-target-store");
const elExportTargetQty = document.getElementById("export-target-qty");
const elBtnSetBatch = document.getElementById("btn-set-batch");
const elBtnClearBatch = document.getElementById("btn-clear-batch");
const elSummaryStore = document.getElementById("summary-store");
const elSummaryQty = document.getElementById("summary-qty");
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

// =============================================================================
// INITIALIZATION
// =============================================================================
window.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadRecentStores();
    loadStoredState();
    initEventListeners();
    initSpeechSynthesis();
    tryPreloadLocalSheet();
    onTripChanged(exportState.tripCode || "1392");
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
                elSyncText.textContent = `Offline: Đã nạp ${count} cửa hàng`;
            }
        } catch (e) {}
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
            window.WCM_DB.getAppState("wcm_backup_history")
        ]).then(([idbDict, idbImport, idbExport, idbRecon, idbHistory]) => {
            let needsRerender = false;
            if (idbDict && Object.keys(storeMap.byDo || {}).length === 0) {
                storeMap = idbDict;
                const count = Object.keys(storeMap.byDo || {}).length;
                if (count > 0) elSyncText.textContent = `Offline (IDB): Đã nạp ${count} cửa hàng`;
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
    const importKeysArr = Array.from(importScannedKeys);
    localStorage.setItem("wcm_import_keys", JSON.stringify(importKeysArr));
    localStorage.setItem("wcm_export_state", JSON.stringify(exportState));
    localStorage.setItem("wcm_backup_history", JSON.stringify(scanHistory));

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
        if (serializedRecon) {
            window.WCM_DB.setAppState("wcm_inbound_recon_state", serializedRecon);
        }
    }
}

// Try reading local sheet.csv if served by local server (optional)
function tryPreloadLocalSheet() {
    if (location.protocol === "file:") return; // Avoid CORS error when opening offline local file
    if (Object.keys(storeMap.byDo).length > 0) return; // already loaded in localStorage

    fetch("sheet.csv?t=" + Date.now())
        .then(res => res.ok ? res.text() : Promise.reject("no local file"))
        .then(csvText => {
            parseCSVIntoDictionary(csvText);
            console.log("Preloaded sheet.csv into offline dictionary");
        })
        .catch(() => {
            // It's completely fine if sheet.csv is not present; app works without it!
        });
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
    const fullStoreName = `CH.${storeCode} - ${storeName}`;
    if (elExportTargetStore) elExportTargetStore.value = fullStoreName;
    if (elExportTargetQty) elExportTargetQty.value = qty || 50;

    if (elExportStoreSelect) {
        for (let i = 0; i < elExportStoreSelect.options.length; i++) {
            if (elExportStoreSelect.options[i].value === storeCode) {
                elExportStoreSelect.selectedIndex = i;
                break;
            }
        }
    }

    addRecentStore(storeCode, storeName, qty);
    applyExportBatch();
}

function renderStoreOptions(storeList) {
    if (!elExportStoreSelect) return;
    const countText = storeList.length > 0 ? ` (${storeList.length} CH)` : "";
    elExportStoreSelect.innerHTML = `<option value="">-- Bấm chọn Cửa Hàng${countText} (Tự động nạp số kiện) --</option>`;

    if (storeList.length > 0) {
        storeList.forEach(st => {
            const opt = document.createElement("option");
            opt.value = st.storeCode;
            opt.dataset.name = st.storeName;
            opt.dataset.qty = st.totalQty;
            opt.textContent = `CH.${st.storeCode} - ${st.storeName} (${st.totalQty} kiện)`;
            elExportStoreSelect.appendChild(opt);
        });
    }
}

function filterStoreDropdown(filterText) {
    if (!currentTripStores || currentTripStores.length === 0) return [];
    const cleanQuery = removeVietnameseTones(filterText);

    if (!cleanQuery) {
        renderStoreOptions(currentTripStores);
        return currentTripStores;
    }

    const matched = currentTripStores.filter(st => {
        const codeNorm = removeVietnameseTones(st.storeCode || "");
        const nameNorm = removeVietnameseTones(st.storeName || "");
        return codeNorm.includes(cleanQuery) || nameNorm.includes(cleanQuery);
    });

    renderStoreOptions(matched);
    return matched;
}

function updateStoreDropdown(tripCode) {
    if (!elExportStoreSelect) return;
    const cleanTrip = (tripCode || "").trim();

    let storeList = [];
    if (storeMap.trips && storeMap.trips[cleanTrip]) {
        storeList = Object.values(storeMap.trips[cleanTrip]);
    } else if (PRESET_TRIP_STORES[cleanTrip]) {
        storeList = PRESET_TRIP_STORES[cleanTrip];
    }

    currentTripStores = storeList;
    if (elExportStoreSearch) {
        elExportStoreSearch.value = "";
    }
    if (elBtnClearStoreSearch) {
        elBtnClearStoreSearch.style.display = "none";
    }
    renderStoreOptions(storeList);
    renderRecentStoreChips();
}

function onTripChanged(tripCode) {
    const clean = (tripCode || "").trim();
    exportState.tripCode = clean;
    if (elExportTripCode) elExportTripCode.value = clean;
    if (window.OnlineSync) window.OnlineSync.setTripCode(clean);

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
        if (confirm("Bạn có chắc muốn XÓA DỮ LIỆU phiên quét hiện tại (tiến độ nhập/xuất)? Lịch sử quét sẽ được giữ lại.")) {
            importScannedKeys.clear();
            exportState.scannedItems = [];
            saveStoredState();
            updateExportUI();
            resetImportVisuals();
            alert("Đã xóa dữ liệu phiên làm việc!");
        }
    });

    // CSV File upload for store dictionary
    elCsvFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                parseCSVIntoDictionary(event.target.result);
                alert(`Đã nạp danh mục thành công! Nhận diện ${Object.keys(storeMap.byDo).length} đơn/cửa hàng.`);
            };
            reader.readAsText(file, "utf-8");
        }
    });

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
        if (exportState.scannedItems.length > 0) {
            if (!confirm(`Lô hiện tại đã quét ${exportState.scannedItems.length} kiện. Bạn có chắc muốn chốt lô và đổi sang lô xe mới?`)) {
                return;
            }
        }
        clearExportBatch();
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

    // Smart Trip Selectors (Chips & Input)
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

    // Error Recovery 2: Hoàn tác kiện vừa quét
    if (elBtnUndoLastScan) {
        elBtnUndoLastScan.addEventListener("click", () => {
            if (!exportState.scannedItems || exportState.scannedItems.length === 0) return;
            const lastItem = exportState.scannedItems[exportState.scannedItems.length - 1];
            if (confirm(`Bạn có chắc muốn HOÀN TÁC (hủy) kiện vừa quét:\n${lastItem.uniqueKey} (${lastItem.storeName || ''})?`)) {
                exportState.scannedItems.pop();
                saveStoredState();
                updateExportUI();
                speakText("Đã hoàn tác kiện vừa quét");

                if (window.OnlineSync && window.OnlineSync.undoScan) {
                    window.OnlineSync.undoScan({
                        tripCode: exportState.tripCode,
                        packageCode: lastItem.uniqueKey
                    });
                }
            }
        });
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
            exportState.targetStore = "";
            exportState.targetQty = 0;
            exportState.scannedItems = [];
            exportState.peerScannedItems = [];
            exportState.isBatchActive = false;
            exportState.isBatchCompleted = false;
            saveStoredState();

            if (elExportTargetStore) elExportTargetStore.value = "";
            if (elExportTargetQty) elExportTargetQty.value = "";
            if (elExportStoreSearch) {
                elExportStoreSearch.value = "";
                filterStoreDropdown("");
                setTimeout(() => elExportStoreSearch.focus(), 150);
            }
            updateExportUI();
            showToast("🚚 Sẵn sàng cho cửa hàng tiếp theo!");
            speakText("Mời chọn cửa hàng tiếp theo");
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

    // Inbound Sub-Mode Switchers (Phân loại tự do vs Đối chiếu chuyến)
    if (elBtnInboundSubFree && elBtnInboundSubRecon) {
        elBtnInboundSubFree.addEventListener("click", () => {
            unlockAudio();
            inboundReconState.isActive = false;
            elBtnInboundSubFree.classList.add("active");
            elBtnInboundSubRecon.classList.remove("active");
            if (elInboundReconBox) elInboundReconBox.style.display = "none";
            if (elImportChuteBox) elImportChuteBox.style.display = "block";
            speakText("Chế độ phân loại tự do");
            triggerFocus();
        });

        elBtnInboundSubRecon.addEventListener("click", () => {
            unlockAudio();
            inboundReconState.isActive = true;
            elBtnInboundSubRecon.classList.add("active");
            elBtnInboundSubFree.classList.remove("active");
            if (elInboundReconBox) elInboundReconBox.style.display = "block";
            if (elImportChuteBox) elImportChuteBox.style.display = "none";
            speakText("Chế độ đối chiếu chuyến xuất");
            if (elReconTripCode) elReconTripCode.focus();
        });
    }

    if (elBtnLoadTripManifest) {
        elBtnLoadTripManifest.addEventListener("click", () => {
            unlockAudio();
            loadTripManifestForInbound();
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
        // Do not intercept if user is typing into batch configuration fields
        if (e.target === elExportTargetStore || e.target === elExportTargetQty || e.target === elExportTripCode || e.target === elExportOperatorCode || e.target === elReconTripCode) {
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

        // Only buffer printable single characters
        if (e.key && e.key.length === 1) {
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
        const tag = e.target.tagName;
        if (tag !== "INPUT" && tag !== "SELECT" && tag !== "BUTTON") {
            triggerFocus();
        }
    });
}

// Safely refocus without triggering Android virtual keyboard (inputmode="none")
function triggerFocus() {
    if (settings.autoFocusEnabled && elManualScanInput) {
        elManualScanInput.focus();
    }
}

// Switch between Nhập (Import) and Xuất (Export) modes
function switchMode(newMode, notify = true) {
    if (window.WCM_AUTH && !window.WCM_AUTH.isSuperAdmin()) {
        const role = window.WCM_AUTH.getUserRole();
        if (role === "DAU_XUAT" && newMode === "Nhập") return;
        if (role === "DAU_NHAP" && newMode === "Xuất") return;
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
        if (notify) speakText("Chế độ đầu nhập. Phân loại cửa hàng");
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
    let storeNameIdx = 9;
    let chIdx = 24;

    for (let i = 0; i < headers.length; i++) {
        if (headers[i] === "số do" || headers[i] === "do") doIdx = i;
        else if (headers[i].includes("tên siêu thị") || headers[i].includes("tên cửa hàng")) storeNameIdx = i;
        else if (headers[i].includes("ghi chú 2")) chIdx = i;
    }

    let loadedCount = 0;
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = splitCSVRow(lines[i]);
        const doNum = cols[doIdx] ? cols[doIdx].trim() : "";
        const storeName = cols[storeNameIdx] ? cols[storeNameIdx].trim() : "";
        const chCode = cols[chIdx] ? cols[chIdx].trim() : "";

        if (doNum && storeName) {
            storeMap.byDo[doNum] = storeName;
            loadedCount++;
        }
        if (chCode && storeName && chCode.startsWith("CH.")) {
            storeMap.byCh[chCode] = storeName;
        }
    }

    localStorage.setItem("wcm_store_dictionary", JSON.stringify(storeMap));
    elSyncText.textContent = `Offline: Đã nạp ${loadedCount} cửa hàng`;
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
        pkgIdx: 1,
        totalPackages: 1,
        storeName: ""
    };

    if (text.includes("|")) {
        const parts = text.split("|").map(p => p.trim());
        result.tripCode = parts[0] || "";
        result.doNumber = parts[1] || "";
        result.soNumber = parts[2] || "";
        result.packageCode = parts[3] || "";

        // Detect CH routing code (e.g. CH.2.24 or CH.2.31)
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
        // Fallback for single barcode / DO scan
        result.doNumber = text;
        result.packageCode = text;
    }

    // Resolve store name from offline dictionary if possible
    if (result.doNumber && storeMap.byDo[result.doNumber]) {
        result.storeName = storeMap.byDo[result.doNumber];
    } else if (result.chCode && storeMap.byCh[result.chCode]) {
        result.storeName = storeMap.byCh[result.chCode];
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
function handleBarcodeScanned(rawBarcode) {
    if (!rawBarcode || !rawBarcode.trim()) return;
    const tStartBiz = performance.now();
    const pkg = parseQrCode(rawBarcode);

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
            rawBarcode,
            pkg,
            scanResult: result || "SUCCESS",
            businessLatencyMs: Math.round(tEndBiz - tStartBiz),
            decodeTelemetry: window.__lastDecodeTelemetry || null
        });
    }
}

// -----------------------------------------------------------------------------
// ĐẦU NHẬP: ĐỐI CHIẾU THEO CHUYẾN XUẤT & PHÂN LOẠI CỬA HÀNG
// -----------------------------------------------------------------------------

async function loadTripManifestForInbound() {
    const trip = elReconTripCode ? elReconTripCode.value.trim() : "";
    if (!trip) {
        alert("Vui lòng nhập Mã Chuyến xe (Ví dụ: 1392)!");
        if (elReconTripCode) elReconTripCode.focus();
        return;
    }

    if (!window.OnlineSync || !window.OnlineSync.getScriptUrl()) {
        alert("Chưa cấu hình URL Google Sheets! Vui lòng bấm vào nút 'Cấu hình Google Sheet' trên thanh tiêu đề để cài đặt.");
        if (window.OnlineSync) window.OnlineSync.openConfigModal();
        return;
    }

    elBtnLoadTripManifest.disabled = true;
    elBtnLoadTripManifest.textContent = "⏳ Đang tải...";

    try {
        const data = await window.OnlineSync.fetchTripManifest(trip);
        if (!data || !Array.isArray(data.packages) || data.packages.length === 0) {
            alert(`Không tìm thấy kiện nào thuộc chuyến xe "${trip}" trên Google Sheets. Hãy kiểm tra lại mã chuyến hoặc đảm bảo đầu xuất đã quét và đồng bộ lên Google Sheets.`);
            return;
        }

        inboundReconState.tripCode = trip;
        inboundReconState.totalExported = data.totalExported || data.packages.length;
        inboundReconState.manifestList = data.packages;
        inboundReconState.manifestMap = new Map();
        inboundReconState.inboundScannedKeys = new Set();
        inboundReconState.missingKeys = new Set();
        inboundReconState.extraScannedList = [];

        data.packages.forEach(pkg => {
            const key = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}`;
            inboundReconState.manifestMap.set(key, pkg);
            if (pkg.inboundScanned) {
                inboundReconState.inboundScannedKeys.add(key);
            } else {
                inboundReconState.missingKeys.add(key);
            }
        });

        if (elReconSummaryGrid) elReconSummaryGrid.style.display = "grid";
        updateInboundReconUI();

        speakText(`Đã tải chuyến ${trip}, tổng ${inboundReconState.totalExported} kiện. Bắt đầu đối chiếu.`);
        alert(`Đã tải thành công chuyến ${trip}!\n- Tổng kiện đã xuất: ${inboundReconState.totalExported}\n- Đã nhận trước đó: ${inboundReconState.inboundScannedKeys.size}\n- Còn thiếu: ${inboundReconState.missingKeys.size}\n\nHãy bắt đầu quét kiện để đối chiếu!`);
    } catch (err) {
        alert("Lỗi khi tải danh sách chuyến từ Google Sheets: " + err.message);
    } finally {
        elBtnLoadTripManifest.disabled = false;
        elBtnLoadTripManifest.textContent = "📥 Tải Lô Xuất";
    }
}

function updateInboundReconUI() {
    if (!elReconValTotal) return;
    const total = inboundReconState.totalExported;
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
        if (missing === 0) {
            elMissingPkgsList.innerHTML = `<div style="color:#10b981; text-align:center; padding:0.5rem; font-weight:700;">🎉 Đã nhận đủ toàn bộ ${total} kiện!</div>`;
        } else {
            let html = "";
            inboundReconState.missingKeys.forEach(key => {
                const item = inboundReconState.manifestMap.get(key) || {};
                html += `
                    <div class="missing-pkg-item">
                        <span><strong>${item.chCode || item.storeName || "Kiện"}</strong> (DO: ${item.doNumber || "-"})</span>
                        <span style="color: #f59e0b;">${item.pkgIdxText || key}</span>
                    </div>
                `;
            });
            elMissingPkgsList.innerHTML = html;
        }
    }
}

function handleInboundReconScan(pkg, timestamp) {
    const uniqueKey = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}` || pkg.raw;
    const cleanStore = cleanStoreName(pkg.storeName);
    const storeLabel = pkg.storeName || (pkg.chCode ? `Cửa hàng ${pkg.chCode}` : "Không rõ");

    // 1. Kiểm tra quét trùng trong phiên dỡ hàng
    if (inboundReconState.inboundScannedKeys.has(uniqueKey)) {
        triggerVibrate([150, 80, 150]);
        playSound("duplicate");
        speakText("Đã trùng kiện này");

        elImportVerdict.innerHTML = `⚠️ KIỆN ĐÃ NHẬP TRƯỚC ĐÓ!<br><span style="font-size: 0.95rem;">Kiện [${uniqueKey}] đã được dỡ xuống và đối chiếu rồi.</span>`;
        elImportVerdict.className = "verdict-box verdict-incomplete";

        logHistory({
            timestamp: timestamp,
            mode: "Nhập",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: storeLabel,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: "Kiện trùng khi đối chiếu dỡ hàng"
        });
        return "DUPLICATE";
    }

    // 2. Kiểm tra kiện có nằm trong danh sách xuất của chuyến này không
    const manifestItem = inboundReconState.manifestMap.get(uniqueKey) ||
                         inboundReconState.manifestMap.get(pkg.packageCode) ||
                         inboundReconState.manifestMap.get(`${pkg.doNumber}_${pkg.pkgIdx}`);

    if (!manifestItem) {
        // CÒI BÁO ĐỘNG ĐỎ: HÀNG LẠC / SAI CHUYẾN!
        inboundReconState.extraScannedList.push(pkg);
        triggerVibrate([300, 100, 300, 100, 500]);
        playSound("wrong_store");
        speakText("Cảnh báo! Hàng lạc không có trong chuyến này!");

        updateImportVisuals(pkg, "duplicate");

        elImportVerdict.innerHTML = `🚨 HÀNG LẠC / SAI CHUYẾN XUẤT!<br><span style="font-size: 0.95rem;">Kiện [<strong>${uniqueKey}</strong>] không có trong danh sách xuất của chuyến <strong>${inboundReconState.tripCode}</strong>!</span>`;
        elImportVerdict.className = "verdict-box verdict-wrong-store";

        if (window.OnlineSync) {
            window.OnlineSync.recordScan({
                action: "inbound_scan",
                tripCode: inboundReconState.tripCode,
                operatorCode: window.OnlineSync.getOperatorCode(),
                packageCode: uniqueKey,
                doNumber: pkg.doNumber || "",
                chCode: pkg.chCode || "",
                storeName: storeLabel,
                status: "HÀNG LẠC / SAI CHUYẾN",
                rawBarcode: pkg.raw,
                timestamp: timestamp
            });
        }

        logHistory({
            timestamp: timestamp,
            mode: "Nhập",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: storeLabel,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "error",
            note: `HÀNG LẠC (Không có trong chuyến ${inboundReconState.tripCode})`
        });
        return "WRONG_STORE";
    }

    // 3. KHỚP ĐÚNG CHUYẾN XUẤT!
    inboundReconState.inboundScannedKeys.add(uniqueKey);
    inboundReconState.missingKeys.delete(uniqueKey);

    manifestItem.inboundReceived = true;
    manifestItem.receivedTime = timestamp;

    triggerVibrate([80]);
    playSound("success");

    if (cleanStore) {
        speakText(`${cleanStore}, kiện ${inboundReconState.inboundScannedKeys.size} trên ${inboundReconState.totalExported}`);
    } else {
        speakText(`Đúng kiện, thứ ${inboundReconState.inboundScannedKeys.size} trên ${inboundReconState.totalExported}`);
    }

    updateImportVisuals(pkg, "success");
    updateInboundReconUI();

    const currentReceived = inboundReconState.inboundScannedKeys.size;
    const totalExp = inboundReconState.totalExported;

    if (currentReceived === totalExp) {
        triggerVibrate([100, 50, 100, 50, 200]);
        playSound("complete");
        speakText(`Đã dỡ và đối chiếu đủ ${totalExp} kiện của chuyến xe!`);
        elImportVerdict.innerHTML = `🎉 ĐÃ ĐỐI CHIẾU ĐỦ ${totalExp}/${totalExp} KIỆN CỦA CHUYẾN!<br><span style="font-size: 0.95rem;">Toàn bộ kiện xuất đã được nhận đầy đủ không thất lạc.</span>`;
        elImportVerdict.className = "verdict-box verdict-complete";
    } else {
        elImportVerdict.innerHTML = `✅ KHỚP CHUYẾN XUẤT: Đã nhận ${currentReceived}/${totalExp} kiện<br><span style="font-size: 0.9rem;">Còn thiếu ${totalExp - currentReceived} kiện chưa dỡ.</span>`;
        elImportVerdict.className = "verdict-box verdict-incomplete";
    }

    if (window.OnlineSync) {
        window.OnlineSync.recordScan({
            action: "inbound_scan",
            tripCode: inboundReconState.tripCode,
            operatorCode: window.OnlineSync.getOperatorCode(),
            packageCode: uniqueKey,
            doNumber: pkg.doNumber || "",
            chCode: pkg.chCode || "",
            storeName: storeLabel,
            status: "KHỚP ĐÚNG CHUYẾN",
            rawBarcode: pkg.raw,
            timestamp: timestamp
        });
    }

    logHistory({
        timestamp: timestamp,
        mode: "Nhập",
        chCode: pkg.chCode || "-",
        doNumber: pkg.doNumber || "-",
        storeName: storeLabel,
        pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
        status: "success",
        note: `Khớp chuyến (${currentReceived}/${totalExp})`
    });

    return "SUCCESS";
}

function handleImportScan(pkg, timestamp) {
    if (inboundReconState.isActive) {
        return handleInboundReconScan(pkg, timestamp);
    }

    // Unique identifier for duplicate detection
    const uniqueKey = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}` || pkg.raw;
    const isDuplicate = importScannedKeys.has(uniqueKey);

    const spokenCh = pkg.chCode ? pkg.chCode.replace("CH.", "cửa hàng ") : "";
    const cleanStore = cleanStoreName(pkg.storeName);

    if (isDuplicate) {
        // DUPLICATE SCAN
        triggerVibrate([150, 80, 150]);
        playSound("duplicate");
        speakText("Đã trùng kiện");

        updateImportVisuals(pkg, "duplicate");

        logHistory({
            timestamp: timestamp,
            mode: "Nhập",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkg.storeName || (pkg.chCode ? `Vị trí ${pkg.chCode}` : "Không rõ"),
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: "Kiện đã quét trùng"
        });
        return "DUPLICATE";
    }

    // NEW VALID IMPORT SCAN
    importScannedKeys.add(uniqueKey);
    saveStoredState();

    triggerVibrate([80]);
    playSound("success");

    // Speech: Prioritize CH code loudly and clearly
    if (cleanStore && pkg.chCode) {
        speakText(`${cleanStore}, phân loại ${pkg.chCode}`);
    } else if (pkg.chCode) {
        speakText(`Phân loại ${pkg.chCode}`);
    } else {
        speakText(`Kiện ${pkg.pkgIdx} trên ${pkg.totalPackages}`);
    }

    updateImportVisuals(pkg, "success");

    logHistory({
        timestamp: timestamp,
        mode: "Nhập",
        chCode: pkg.chCode || "-",
        doNumber: pkg.doNumber || "-",
        storeName: pkg.storeName || (pkg.chCode ? `Vị trí ${pkg.chCode}` : "Không rõ"),
        pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
        status: "success",
        note: "Đã phân loại thành công"
    });
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
}

// -----------------------------------------------------------------------------
// ĐẦU XUẤT: ĐỐI CHIẾU LÔ XUẤT & CHỐNG LẪN HÀNG
// -----------------------------------------------------------------------------
function applyExportBatch() {
    const store = elExportTargetStore.value.trim();
    const qty = parseInt(elExportTargetQty.value, 10);
    const trip = elExportTripCode ? elExportTripCode.value.trim() : "";
    const op = elExportOperatorCode ? elExportOperatorCode.value.trim() : "NV01";

    if (!store) {
        alert("Vui lòng nhập Cửa hàng / Mã CH cần xuất (Ví dụ: CH.2.24 hoặc Tân Thủy)!");
        elExportTargetStore.focus();
        return;
    }

    if (!qty || qty <= 0) {
        alert("Vui lòng nhập Số kiện kế hoạch của lô lớn hơn 0!");
        elExportTargetQty.focus();
        return;
    }

    exportState.targetStore = store;
    exportState.targetQty = qty;
    exportState.tripCode = trip;
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

function clearExportBatch() {
    exportState.targetStore = "";
    exportState.targetQty = 0;
    exportState.tripCode = "";
    exportState.scannedItems = [];
    exportState.peerScannedItems = [];
    exportState.isBatchActive = false;
    saveStoredState();

    if (elExportTargetStore) elExportTargetStore.value = "";
    if (elExportTargetQty) elExportTargetQty.value = "";
    if (elExportTripCode) elExportTripCode.value = "";
    updateExportUI();
    triggerFocus();
}

// Check if package store matches batch target store
function isStoreMatch(pkg, targetStore) {
    if (!targetStore) return true;
    const tgt = targetStore.toLowerCase().replace(/^ch[\.\s_]*/, '').replace(/\s+/g, '').trim();

    // 1. Compare with CH code
    if (pkg.chCode) {
        const pkgCh = pkg.chCode.toLowerCase().replace(/^ch[\.\s_]*/, '').replace(/\s+/g, '').trim();
        if (pkgCh === tgt || pkgCh.includes(tgt) || tgt.includes(pkgCh)) return true;
    }

    // 2. Compare with store name
    const store = (pkg.storeName || "").toLowerCase().replace(/\s+/g, '');
    if (store && (store.includes(tgt) || tgt.includes(store))) return true;

    // 3. Compare with DO if target is DO
    if (pkg.doNumber && pkg.doNumber.includes(tgt)) return true;

    return false;
}

let lastUnconfiguredWarningTime = 0;

function handleExportScan(pkg, timestamp) {
    if (!exportState.isBatchActive || exportState.targetQty <= 0) {
        const now = Date.now();
        if (now - lastUnconfiguredWarningTime > 2500) {
            triggerVibrate([100, 50, 100]);
            playSound("error");
            speakText("Chưa thiết lập lô xuất");
            lastUnconfiguredWarningTime = now;
        }

        if (elExportVerdict) {
            elExportVerdict.innerHTML = `⚠️ CHƯA THIẾT LẬP LÔ XUẤT XE!<br><span style="font-size: 0.95rem; font-weight: 500;">Hãy nhập <strong>Cửa hàng</strong> & <strong>Số kiện</strong> ở khung phía trên, rồi bấm nút xanh <strong>'ÁP DỤNG LÔ NÀY'</strong> để bắt đầu đếm kiện!</span>`;
            elExportVerdict.className = "verdict-box verdict-overscan";
        }

        return "UNCONFIGURED_BATCH";
    }

    const uniqueKey = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}` || pkg.raw;
    const pkgStoreIdentifier = pkg.chCode || pkg.storeName || "Không rõ";

    // 1. CHECK FOR WRONG STORE (CHỐNG LẪN HÀNG)
    const match = isStoreMatch(pkg, exportState.targetStore);
    if (!match) {
        // ALARM: WRONG STORE DETECTED!
        triggerVibrate([300, 100, 300, 100, 500]);
        playSound("wrong_store");
        speakText(`Sai cửa hàng! Kiện này của ${pkg.chCode || 'cửa hàng khác'}!`);

        // Display Red Alert UI
        elExportVerdict.innerHTML = `🚨 SAI CỬA HÀNG / LẪN HÀNG!<br><span style="font-size: 1rem; font-weight: 500;">Kiện này thuộc <strong>${pkgStoreIdentifier}</strong>, KHÔNG PHẢI <strong>${exportState.targetStore}</strong>!</span>`;
        elExportVerdict.className = "verdict-box verdict-wrong-store";

        elExportLastPkgStore.textContent = pkgStoreIdentifier;
        elExportLastPkgDo.textContent = pkg.doNumber || "-";
        elExportLastPkgIdx.textContent = `${pkg.pkgIdx}/${pkg.totalPackages}`;

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "error",
            note: `SAI CỬA HÀNG (Lẫn hàng của ${pkgStoreIdentifier})`
        });
        return "WRONG_STORE";
    }

    // 2. CHECK FOR DUPLICATE IN CURRENT EXPORT BATCH (MÁY NÀY)
    const isDuplicate = exportState.scannedItems.some(item => item.uniqueKey === uniqueKey);
    if (isDuplicate) {
        triggerVibrate([150, 80, 150]);
        playSound("duplicate");
        speakText("Đã trùng kiện này");

        elExportVerdict.innerHTML = `⚠️ KIỆN ĐÃ QUÉT TRÙNG!<br><span style="font-size: 0.95rem; font-weight: 500;">Kiện ${pkg.pkgIdx}/${pkg.totalPackages} đã được máy này đưa lên xe trước đó.</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
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

        elExportVerdict.innerHTML = `⚠️ KIỆN ĐÃ ĐƯỢC BẮN TRƯỚC ĐÓ!<br><span style="font-size: 0.95rem; font-weight: 500;"><strong>${peerOp}</strong> đã xếp kiện ${pkg.pkgIdx}/${pkg.totalPackages} lên xe trên máy khác.</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
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
    saveStoredState();

    // Async Cloud Sync to Google Sheets
    if (window.OnlineSync) {
        window.OnlineSync.recordScan({
            action: "export_scan",
            tripCode: exportState.tripCode,
            operatorCode: exportState.operatorCode,
            packageCode: uniqueKey,
            doNumber: pkg.doNumber || "",
            chCode: pkg.chCode || "",
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

    updateExportProgress();

    if (currentCount < planQty) {
        // In progress
        triggerVibrate([80]);
        playSound("success");
        speakText(`Kiện ${currentCount} trên ${planQty}`);

        elExportVerdict.innerHTML = `✅ ĐÚNG CỬA HÀNG: Đã xếp ${currentCount}/${planQty} kiện (Tôi: ${myCount}, Bạn: ${peerCount})<br><span style="font-size: 0.9rem; font-weight: 500;">Còn thiếu ${planQty - currentCount} kiện</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "success",
            note: `Đúng cửa hàng (${currentCount}/${planQty} kiện)`
        });
    } else if (currentCount === planQty) {
        // Completed batch
        triggerVibrate([100, 50, 100, 50, 200]);
        playSound("complete");
        speakText(`Đã đủ ${planQty} kiện xuất kho!`);

        elExportVerdict.innerHTML = `🎉 ĐÃ ĐỦ SỐ LƯỢNG KẾ HOẠCH!<br><span style="font-size: 1rem; font-weight: 600;">Đã xếp đủ ${currentCount}/${planQty} kiện lên xe cho ${exportState.targetStore}</span>`;
        elExportVerdict.className = "verdict-box verdict-complete";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "success",
            note: `ĐỦ LÔ XUẤT (${planQty}/${planQty} kiện)`
        });

        // Trigger Batch Completion Modal Workflow after 1.2s delay
        if (!exportState.isBatchCompleted) {
            exportState.isBatchCompleted = true;
            exportState.completedAt = Date.now();
            saveStoredState();
            setTimeout(() => {
                showBatchCompletedModal(exportState.targetStore, exportState.tripCode, currentCount, planQty, myCount, peerCount);
            }, 1200);
        }
    } else {
        // Overscanned
        triggerVibrate([100, 50, 100]);
        playSound("duplicate");
        speakText(`Cảnh báo: Thừa ${currentCount - planQty} kiện`);

        elExportVerdict.innerHTML = `⚠️ CẢNH BÁO: QUÉT THỪA KIỆN!<br><span style="font-size: 0.9rem; font-weight: 500;">Kế hoạch ${planQty} kiện, hiện đã quét ${currentCount} kiện!</span>`;
        elExportVerdict.className = "verdict-box verdict-overscan";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: `THỪA KIỆN (${currentCount}/${planQty} kiện)`
        });
    }
    return "SUCCESS";
}

function updateExportProgress() {
    const myCount = exportState.scannedItems.length;
    let peerCount = 0;
    if (exportState.peerScannedItems && Array.isArray(exportState.peerScannedItems)) {
        peerCount = exportState.peerScannedItems.length;
    }
    const combinedCurrent = myCount + peerCount;
    const total = exportState.targetQty;

    if (exportState.tripCode && (myCount > 0 || peerCount > 0)) {
        elExportProgressText.textContent = `${combinedCurrent} / ${total} Kiện (Tôi: ${myCount}, Bạn: ${peerCount})`;
    } else {
        elExportProgressText.textContent = `${myCount} / ${total} Kiện`;
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
    if (elPeerTripDisplay) elPeerTripDisplay.textContent = exportState.tripCode || "-";
    if (elPeerProgressBox) {
        elPeerProgressBox.style.display = exportState.tripCode ? "flex" : "none";
    }
}

function updateExportUI() {
    if (exportState.isBatchActive) {
        elSummaryStore.textContent = exportState.targetStore;
        elSummaryQty.textContent = exportState.targetQty;
        elExportActiveStoreDisplay.textContent = exportState.targetStore;
        elExportStatusBadge.textContent = "Đang xuất lô";
        elExportStatusBadge.className = "badge badge-success";
        elExportTargetStore.value = exportState.targetStore;
        elExportTargetQty.value = exportState.targetQty;
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
        elSummaryStore.textContent = "Chưa chọn";
        elSummaryQty.textContent = "0";
        elExportActiveStoreDisplay.textContent = "CHƯA THIẾT LẬP LÔ XUẤT";
        elExportStatusBadge.textContent = "Chưa chốt lô";
        elExportStatusBadge.className = "badge badge-warning";
        elExportProgressText.textContent = "0 / 0 Kiện";
        elExportProgressBar.style.width = "0%";
        elExportVerdict.textContent = "Vui lòng nhập cửa hàng & số kiện kế hoạch trước khi quét...";
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
    if (elModalCompleteTrip) elModalCompleteTrip.textContent = `Chuyến ${trip || "-"}`;
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

    // 2. Local fallback if offline or no sheet data
    if (!tripsData || tripsData.length === 0) {
        const localTrips = {};
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

        if (exportState.tripCode && localTrips[exportState.tripCode]) {
            const activeTrip = localTrips[exportState.tripCode];
            const myCount = exportState.scannedItems ? exportState.scannedItems.length : 0;
            const peerCount = exportState.peerScannedItems ? exportState.peerScannedItems.length : 0;
            activeTrip.totalExported = myCount + peerCount;
            if (exportState.operatorCode) {
                activeTrip.operators[exportState.operatorCode] = myCount;
            }
            activeTrip.lastActive = "Vừa xong";
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

        let plannedTotal = 0;
        if (PRESET_TRIP_STORES[trip.tripCode]) {
            plannedTotal = PRESET_TRIP_STORES[trip.tripCode].reduce((sum, s) => sum + (s.totalQty || 0), 0);
        }
        const pct = plannedTotal > 0 ? Math.min(100, Math.round((count / plannedTotal) * 100)) : (count > 0 ? 100 : 0);

        let statusBadge = `<span class="trip-dash-badge empty">Chưa bắt đầu</span>`;
        if (count > 0) {
            statusBadge = `<span class="trip-dash-badge active">Đang xếp xe (${count} kiện)</span>`;
        }

        const opList = trip.operators ? Object.keys(trip.operators).map(op => `${op}: ${trip.operators[op]}`).join(" | ") : "";

        let storesSummary = "";
        if (Array.isArray(trip.stores) && trip.stores.length > 0) {
            storesSummary = trip.stores.slice(0, 4).map(s => {
                const sName = s.name || s.code || "CH";
                const sCount = s.count || 0;
                return `<span class="trip-meta-pill">🏪 ${sName}: <strong>${sCount}</strong></span>`;
            }).join(" ");
        }

        card.innerHTML = `
            <div class="trip-dash-header">
                <div class="trip-dash-title">
                    <span>🚛 Chuyến ${trip.tripCode}</span>
                    ${isCurrentTrip ? '<span class="badge badge-success" style="font-size: 0.68rem; margin-left: 6px;">Đang chọn</span>' : ''}
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

            <div style="display: flex; justify-content: flex-end; gap: 6px;">
                ${!isCurrentTrip ? `
                    <button type="button" class="btn btn-secondary btn-sm btn-select-trip-dash" data-trip="${trip.tripCode}" style="font-size: 0.75rem; padding: 0.25rem 0.65rem;">
                        👉 Chọn Chuyến Này
                    </button>
                ` : `
                    <span style="font-size: 0.75rem; color: var(--accent-teal); font-weight: 600; padding: 0.25rem 0;">✓ Đang quét chuyến này</span>
                `}
            </div>
        `;

        const selectBtn = card.querySelector(".btn-select-trip-dash");
        if (selectBtn) {
            selectBtn.addEventListener("click", () => {
                const targetTrip = selectBtn.getAttribute("data-trip");
                onTripChanged(targetTrip);
                closeTripDashboard();
                showToast(`Đã chuyển sang Chuyến ${targetTrip}`);
            });
        }

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
// AUDIT LOG & REPORT EXPORT
// =============================================================================
function logHistory(entry) {
    scanHistory.unshift(entry);
    if (scanHistory.length > 200) scanHistory.pop();
    saveStoredState();
    renderHistory();
}

function renderHistory() {
    if (scanHistory.length === 0) {
        elHistoryLogBody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center" style="color: var(--text-muted); padding: 2rem;">
                    Chưa có hoạt động quét nào trong phiên làm việc này.
                </td>
            </tr>
        `;
        return;
    }

    elHistoryLogBody.innerHTML = scanHistory.map(log => {
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
    // Debounce identical scans within 1.5 seconds to prevent accidental duplicate scans
    if (decodedText === lastCameraScan.text && now - lastCameraScan.time < 1500) {
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

