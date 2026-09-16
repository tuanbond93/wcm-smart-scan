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

// Export Mode State
let exportState = {
    targetStore: "",      // e.g. "CH.2.24" or "Tân Thủy"
    targetQty: 0,         // e.g. 15
    scannedItems: [],     // array of scanned package objects
    isBatchActive: false
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
const elExportTargetStore = document.getElementById("export-target-store");
const elExportTargetQty = document.getElementById("export-target-qty");
const elBtnSetBatch = document.getElementById("btn-set-batch");
const elBtnClearBatch = document.getElementById("btn-clear-batch");
const elSummaryStore = document.getElementById("summary-store");
const elSummaryQty = document.getElementById("summary-qty");
const elExportStatusBadge = document.getElementById("export-status-badge");

// Camera Elements
const elBtnToggleCameraSection = document.getElementById("btn-toggle-camera-section");
const elCameraSectionBody = document.getElementById("camera-section-body");
const elCameraSelect = document.getElementById("camera-select");
const elBtnToggleCamera = document.getElementById("btn-toggle-camera");
const elScannerStatus = document.getElementById("scanner-status");

// Import Result View Elements
const elImportResultView = document.getElementById("import-result-view");
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

// =============================================================================
// INITIALIZATION
// =============================================================================
window.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadStoredState();
    initEventListeners();
    initSpeechSynthesis();
    tryPreloadLocalSheet();
    triggerFocus();
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
    // Load store dictionary
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

    // Load import keys
    const savedImport = localStorage.getItem("wcm_import_keys");
    if (savedImport) {
        try { importScannedKeys = new Set(JSON.parse(savedImport)); } catch (e) {}
    }

    // Load export state
    const savedExport = localStorage.getItem("wcm_export_state");
    if (savedExport) {
        try {
            exportState = { ...exportState, ...JSON.parse(savedExport) };
            updateExportUI();
        } catch (e) {}
    }

    // Load history
    const savedHistory = localStorage.getItem("wcm_backup_history");
    if (savedHistory) {
        try { scanHistory = JSON.parse(savedHistory); } catch (e) {}
    }
    renderHistory();
}

function saveStoredState() {
    localStorage.setItem("wcm_import_keys", JSON.stringify(Array.from(importScannedKeys)));
    localStorage.setItem("wcm_export_state", JSON.stringify(exportState));
    localStorage.setItem("wcm_backup_history", JSON.stringify(scanHistory));
}

// Try reading local sheet.csv if served by local server (optional)
function tryPreloadLocalSheet() {
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

    // Camera Accordion Toggle
    elBtnToggleCameraSection.addEventListener("click", () => {
        unlockAudio();
        const isHidden = elCameraSectionBody.style.display === "none";
        elCameraSectionBody.style.display = isHidden ? "block" : "none";
        elBtnToggleCameraSection.textContent = isHidden ? "📷 Thu gọn Camera ▴" : "📷 Sử dụng Camera thiết bị (Tùy chọn) ▾";
    });

    elBtnToggleCamera.addEventListener("click", () => {
        unlockAudio();
        toggleCamera();
    });

    elCameraSelect.addEventListener("change", (e) => {
        activeCameraId = e.target.value;
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

    // =========================================================================
    // PDA HARDWARE SCANNER INTEGRATION (GLOBAL KEYSTROKE LISTENER)
    // =========================================================================
    // Even if user touches outside or input is blurred, bóp cò PDA still works 100%!
    let pdaKeystrokeBuffer = "";
    let lastKeyTimestamp = 0;

    document.addEventListener("keydown", (e) => {
        // Do not intercept if user is typing into batch configuration fields
        if (e.target === elExportTargetStore || e.target === elExportTargetQty) {
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
    const pkg = parseQrCode(rawBarcode);

    const now = new Date();
    const timestamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')} ${now.toLocaleTimeString("vi-VN")}`;

    if (settings.scanMode === "Nhập") {
        handleImportScan(pkg, timestamp);
    } else {
        handleExportScan(pkg, timestamp);
    }
}

// -----------------------------------------------------------------------------
// ĐẦU NHẬP: PHÂN LOẠI CỬA HÀNG
// -----------------------------------------------------------------------------
function handleImportScan(pkg, timestamp) {
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
        return;
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
    exportState.isBatchActive = true;
    saveStoredState();

    updateExportUI();
    speakText(`Bắt đầu xuất cho ${store}. Kế hoạch ${qty} kiện`);
    triggerFocus();
}

function clearExportBatch() {
    exportState.targetStore = "";
    exportState.targetQty = 0;
    exportState.scannedItems = [];
    exportState.isBatchActive = false;
    saveStoredState();

    elExportTargetStore.value = "";
    elExportTargetQty.value = "";
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

function handleExportScan(pkg, timestamp) {
    if (!exportState.isBatchActive || exportState.targetQty <= 0) {
        triggerVibrate([100, 50, 100]);
        playSound("error");
        speakText("Chưa thiết lập lô xuất. Hãy nhập cửa hàng và số lượng kế hoạch.");
        alert("Vui lòng nhập Cửa hàng và Số kiện kế hoạch rồi bấm 'Áp dụng Lô này' trước khi quét!");
        return;
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
        return;
    }

    // 2. CHECK FOR DUPLICATE IN CURRENT EXPORT BATCH
    const isDuplicate = exportState.scannedItems.some(item => item.uniqueKey === uniqueKey);
    if (isDuplicate) {
        triggerVibrate([150, 80, 150]);
        playSound("duplicate");
        speakText("Đã trùng kiện này");

        elExportVerdict.innerHTML = `⚠️ KIỆN ĐÃ QUÉT TRÙNG!<br><span style="font-size: 0.95rem; font-weight: 500;">Kiện ${pkg.pkgIdx}/${pkg.totalPackages} đã được đưa lên xe trước đó.</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: "Kiện xuất trùng lặp"
        });
        return;
    }

    // 3. VALID PACKAGE SCANNED ONTO TRUCK
    exportState.scannedItems.push({
        uniqueKey: uniqueKey,
        pkg: pkg,
        timestamp: timestamp
    });
    saveStoredState();

    const currentCount = exportState.scannedItems.length;
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

        elExportVerdict.innerHTML = `✅ ĐÚNG CỬA HÀNG: Đã xếp ${currentCount}/${planQty} kiện<br><span style="font-size: 0.9rem; font-weight: 500;">Còn thiếu ${planQty - currentCount} kiện</span>`;
        elExportVerdict.className = "verdict-box verdict-incomplete";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "success",
            note: `Hợp lệ (${currentCount}/${planQty})`
        });
    } else if (currentCount === planQty) {
        // EXACTLY COMPLETE!
        triggerVibrate([100, 50, 100, 50, 200]);
        playSound("complete");
        speakText(`Đã đủ ${planQty} kiện xuất kho!`);

        elExportVerdict.innerHTML = `🎉 ĐÃ ĐỦ SỐ LƯỢNG KẾ HOẠCH!<br><span style="font-size: 1rem; font-weight: 600;">Đã xếp đủ ${planQty}/${planQty} kiện lên xe cho ${exportState.targetStore}</span>`;
        elExportVerdict.className = "verdict-box verdict-complete";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "success",
            note: `🎉 ĐỦ HÀNG (${planQty}/${planQty})`
        });
    } else {
        // OVER-SCAN (THỪA KIỆN)
        triggerVibrate([200, 100, 200]);
        playSound("error");
        speakText(`Cảnh báo: Đã thừa kiện so với kế hoạch!`);

        elExportVerdict.innerHTML = `⚠️ CẢNH BÁO: ĐÃ THỪA KIỆN!<br><span style="font-size: 1rem; font-weight: 600;">Đã quét ${currentCount} / Kế hoạch chỉ có ${planQty} kiện!</span>`;
        elExportVerdict.className = "verdict-box verdict-overscan";

        logHistory({
            timestamp: timestamp,
            mode: "Xuất",
            chCode: pkg.chCode || "-",
            doNumber: pkg.doNumber || "-",
            storeName: pkgStoreIdentifier,
            pkgIdxText: `${pkg.pkgIdx}/${pkg.totalPackages}`,
            status: "warning",
            note: `Thừa kiện (${currentCount}/${planQty})`
        });
    }
}

function updateExportProgress() {
    const current = exportState.scannedItems.length;
    const total = exportState.targetQty;
    elExportProgressText.textContent = `${current} / ${total} Kiện`;

    const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
    elExportProgressBar.style.width = pct + "%";

    if (current === total && total > 0) {
        elExportProgressBar.className = "progress-bar-fill complete";
    } else {
        elExportProgressBar.className = "progress-bar-fill";
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
    }
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
// CAMERA SCANNER CONTROLLER (Full-frame Full HD with native BarcodeDetector)
// =============================================================================
let lastCameraScan = { text: "", time: 0 };

function onCameraScanSuccess(decodedText) {
    const now = Date.now();
    // Debounce identical scans within 1.5 seconds to prevent machine-gun duplicate scans
    if (decodedText === lastCameraScan.text && now - lastCameraScan.time < 1500) {
        return;
    }
    lastCameraScan = { text: decodedText, time: now };
    handleBarcodeScanned(decodedText);
}

function toggleCamera() {
    if (typeof Html5Qrcode === "undefined") {
        alert("Thư viện camera chưa sẵn sàng. Bạn có thể dùng đầu đọc máy PDA hoặc nhập tay.");
        return;
    }

    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            elBtnToggleCamera.textContent = "Bật Camera";
            elBtnToggleCamera.className = "btn btn-primary";
            elScannerStatus.textContent = "Máy quét camera đang tắt";
        }).catch(err => {
            console.error("Failed to stop scanner", err);
        });
    } else {
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }

        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length > 0) {
                elCameraSelect.innerHTML = devices.map((d, i) =>
                    `<option value="${d.id}" ${i === devices.length - 1 ? 'selected' : ''}>${d.label || 'Camera ' + (i + 1)}</option>`
                ).join("");
                // Select rear camera by default on phones
                activeCameraId = devices[devices.length - 1].id;
                startScanning();
            } else {
                alert("Không tìm thấy camera trên thiết bị.");
                elScannerStatus.textContent = "Không tìm thấy camera";
            }
        }).catch(err => {
            console.error("Camera access failed", err);
            alert("Lỗi truy cập camera: Hãy đảm bảo bạn đã cấp quyền sử dụng camera trong trình duyệt.");
            elScannerStatus.textContent = "Lỗi cấp quyền camera";
        });
    }
}

function startScanning() {
    if (!activeCameraId) return;
    elScannerStatus.textContent = "Đang kết nối camera...";

    const formats = (typeof Html5QrcodeSupportedFormats !== "undefined") ? 
        [ Html5QrcodeSupportedFormats.QR_CODE ] : undefined;

    // Full-frame scanning without qrbox restriction, with 1080p Full HD resolution
    html5QrCode.start(
        activeCameraId,
        {
            fps: 15,
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true // Native hardware acceleration on mobile
            },
            formatsToSupport: formats,
            videoConstraints: {
                deviceId: activeCameraId,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        },
        (decodedText) => {
            onCameraScanSuccess(decodedText);
        },
        () => {} // Silent on search
    ).then(() => {
        elBtnToggleCamera.textContent = "Tắt Camera";
        elBtnToggleCamera.className = "btn btn-secondary";
        elScannerStatus.textContent = "Máy quét đang hoạt động (Độ nhạy cao)";
    }).catch(err => {
        console.warn("High-res constraints failed, falling back to facingMode environment...", err);
        // Fallback for devices that don't accept strict videoConstraints
        html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 15,
                experimentalFeatures: { useBarCodeDetectorIfSupported: true },
                formatsToSupport: formats
            },
            (decodedText) => {
                onCameraScanSuccess(decodedText);
            },
            () => {}
        ).then(() => {
            elBtnToggleCamera.textContent = "Tắt Camera";
            elBtnToggleCamera.className = "btn btn-secondary";
            elScannerStatus.textContent = "Máy quét đang hoạt động (Chế độ tự động)";
        }).catch(fallbackErr => {
            console.error("All camera start attempts failed", fallbackErr);
            elScannerStatus.textContent = "Lỗi khởi động camera: " + (fallbackErr.message || fallbackErr);
        });
    });
}

