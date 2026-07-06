// Configuration
const LIVE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1fifr6Wacb5zMxWiWgM-HH9xl_z2Px9bGJ4mJk1twHiY/export?format=csv";
const LOCAL_SHEET_URL = "sheet.csv";

// Application State
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let db = {}; // Maps doNumber -> { storeName, totalPackages, originalRow }
let scanState = {}; // Maps doNumber -> Array of scanned package indices (e.g., [1, 2, 5])
let scanHistory = []; // Array of scan log objects
let settings = {
    ttsEnabled: true,
    soundEnabled: true,
    autoFocusEnabled: true,
    preferredVoiceName: "",
    scanMode: "Nhập"
};

// HTML5 QR Scanner instance
let html5QrCode = null;
let activeCameraId = null;

// Initialize Web Audio API Support
let audioCtx = null;

// Page elements
const elSyncIndicator = document.getElementById("sync-indicator");
const elSyncText = document.getElementById("sync-text");
const elBtnSync = document.getElementById("btn-sync");
const elCsvFileInput = document.getElementById("csv-file-input");

const elChkTts = document.getElementById("chk-tts");
const elSelectVoice = document.getElementById("select-voice");
const elChkBeep = document.getElementById("chk-beep");
const elChkAutoFocus = document.getElementById("chk-autofocus");
const elBtnResetSession = document.getElementById("btn-reset-session");
const elBtnModeImport = document.getElementById("btn-mode-import");
const elBtnModeExport = document.getElementById("btn-mode-export");

const elCameraSelect = document.getElementById("camera-select");
const elBtnToggleCamera = document.getElementById("btn-toggle-camera");
const elScannerStatus = document.getElementById("scanner-status");

const elManualScanInput = document.getElementById("manual-scan-input");
const elBtnSubmitScan = document.getElementById("btn-submit-scan");

const elResultStoreCard = document.getElementById("result-store-card");
const elResultStoreName = document.getElementById("result-store-name");
const elResultDoNumber = document.getElementById("result-do-number");
const elResultProgressText = document.getElementById("result-progress-text");
const elResultProgressBar = document.getElementById("result-progress-bar");
const elResultVerdict = document.getElementById("result-verdict");
const elResultScannedBadges = document.getElementById("result-scanned-badges");
const elResultMissingBadges = document.getElementById("result-missing-badges");

const elHistoryLogBody = document.getElementById("history-log-body");
const elBtnExport = document.getElementById("btn-export");
const elBtnClearHistory = document.getElementById("btn-clear-history");

// Init application on load
window.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadLocalState();
    initEventListeners();
    fetchGoogleSheetData();
    initSpeechSynthesis();
});

// Load Settings from LocalStorage
function loadSettings() {
    const saved = localStorage.getItem("wcm_scan_settings");
    if (saved) {
        try {
            settings = { ...settings, ...JSON.parse(saved) };
        } catch (e) {
            console.error("Failed to parse settings", e);
        }
    }
    elChkTts.checked = settings.ttsEnabled;
    elChkBeep.checked = settings.soundEnabled;
    elChkAutoFocus.checked = settings.autoFocusEnabled;
    if (settings.scanMode === "Xuất") {
        elBtnModeExport.classList.add("active");
        elBtnModeImport.classList.remove("active");
    } else {
        elBtnModeImport.classList.add("active");
        elBtnModeExport.classList.remove("active");
    }
}

// Save Settings to LocalStorage
function saveSettings() {
    localStorage.setItem("wcm_scan_settings", JSON.stringify(settings));
}

// Safely triggers input focus (Desktop only, prevents keyboard popups on mobile)
function triggerFocus() {
    if (settings.autoFocusEnabled && !isMobile) {
        elManualScanInput.focus();
    }
}

// Load Scan State & History from LocalStorage
function loadLocalState() {
    const savedState = localStorage.getItem("wcm_scan_state");
    if (savedState) {
        try { scanState = JSON.parse(savedState); } catch(e) {}
    }
    
    const savedHistory = localStorage.getItem("wcm_scan_history");
    if (savedHistory) {
        try { scanHistory = JSON.parse(savedHistory); } catch(e) {}
    }
    renderHistory();
}

// Save Scan State & History
function saveScanState() {
    localStorage.setItem("wcm_scan_state", JSON.stringify(scanState));
    localStorage.setItem("wcm_scan_history", JSON.stringify(scanHistory));
}

// Init Event Listeners
function initEventListeners() {
    elBtnSync.addEventListener("click", () => fetchGoogleSheetData());
    
    elCsvFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            parseCSVFile(file);
        }
    });

    elChkTts.addEventListener("change", (e) => {
        settings.ttsEnabled = e.target.checked;
        saveSettings();
    });

    elSelectVoice.addEventListener("change", (e) => {
        settings.preferredVoiceName = e.target.value;
        saveSettings();
        speakText("Giọng đọc đã thay đổi");
    });

    elChkBeep.addEventListener("change", (e) => {
        settings.soundEnabled = e.target.checked;
        saveSettings();
    });

    elChkAutoFocus.addEventListener("change", (e) => {
        settings.autoFocusEnabled = e.target.checked;
        saveSettings();
        if (settings.autoFocusEnabled && !isMobile) elManualScanInput.focus();
    });

    elBtnModeImport.addEventListener("click", () => {
        settings.scanMode = "Nhập";
        elBtnModeImport.classList.add("active");
        elBtnModeExport.classList.remove("active");
        saveSettings();
        updateUIForActiveDO();
    });

    elBtnModeExport.addEventListener("click", () => {
        settings.scanMode = "Xuất";
        elBtnModeExport.classList.add("active");
        elBtnModeImport.classList.remove("active");
        saveSettings();
        updateUIForActiveDO();
    });

    elBtnResetSession.addEventListener("click", () => {
        if (confirm("Bạn có chắc muốn xoá TOÀN BỘ tiến trình quét hiện tại? Lịch sử quét sẽ được giữ lại.")) {
            scanState = {};
            saveScanState();
            updateUIVisuals(null);
            alert("Đã reset tiến độ quét!");
        }
    });

    elBtnToggleCamera.addEventListener("click", () => toggleCamera());
    elCameraSelect.addEventListener("change", (e) => {
        activeCameraId = e.target.value;
    });

    elManualScanInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleManualInput();
        }
    });

    elBtnSubmitScan.addEventListener("click", () => handleManualInput());

    elBtnClearHistory.addEventListener("click", () => {
        if (confirm("Bạn có chắc muốn xoá lịch sử quét?")) {
            scanHistory = [];
            saveScanState();
            renderHistory();
        }
    });

    elBtnExport.addEventListener("click", () => exportScanReport());

    // Keep focus on input for scan gun (Desktop only, prevents virtual keyboard popups on mobile)
    document.addEventListener("click", () => {
        if (settings.autoFocusEnabled && !isMobile && document.activeElement !== elManualScanInput && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "SELECT" && document.activeElement.tagName !== "BUTTON") {
            elManualScanInput.focus();
        }
    });
}

// Fetch Google Sheet Data (Try live first, fallback to local file)
function fetchGoogleSheetData() {
    setSyncIndicator("syncing", "Đang tải dữ liệu...");
    
    // Live Sheet
    fetch(LIVE_SHEET_URL)
        .then(response => {
            if (!response.ok) throw new Error("CORS or Network Error on Live URL");
            return response.text();
        })
        .then(csvText => {
            processCSVData(csvText);
            setSyncIndicator("success", "Đã đồng bộ live sheet");
        })
        .catch(err => {
            console.warn("Could not sync with Google Sheets online, trying local backup...", err);
            // Local Backup
            fetch(LOCAL_SHEET_URL)
                .then(res => {
                    if (!res.ok) throw new Error("Local sheet.csv not found");
                    return res.text();
                })
                .then(csvText => {
                    processCSVData(csvText);
                    setSyncIndicator("success", "Sử dụng dữ liệu sheet.csv cục bộ");
                })
                .catch(localErr => {
                    console.error("Both live and local data loads failed", localErr);
                    setSyncIndicator("error", "Lỗi tải dữ liệu. Hãy chọn file CSV");
                    speakText("Lỗi tải dữ liệu");
                });
        });
}

// Set visual sync indicator
function setSyncIndicator(status, text) {
    elSyncIndicator.className = "status-indicator";
    elSyncIndicator.classList.add(status);
    elSyncText.textContent = text;
}

// Parse Local uploaded CSV File
function parseCSVFile(file) {
    setSyncIndicator("syncing", "Đang phân tích file...");
    const reader = new FileReader();
    reader.onload = function(e) {
        processCSVData(e.target.result);
        setSyncIndicator("success", "Đồng bộ từ file đã chọn: " + file.name);
    };
    reader.onerror = function() {
        setSyncIndicator("error", "Lỗi đọc file");
    };
    reader.readAsText(file, "utf-8");
}

// Process CSV string into db lookup map
function processCSVData(csvText) {
    Papa.parse(csvText, {
        skipEmptyLines: true,
        complete: function(results) {
            const rows = results.data;
            if (rows.length < 2) {
                console.error("CSV has no data rows");
                return;
            }

            const newDb = {};
            const headers = rows[0];
            
            // Default Column Indices: H = 7 (DO), J = 9 (Store Name), L = 11 (Qty)
            let doColIdx = 7;
            let storeColIdx = 9;
            let qtyColIdx = 11;

            // Attempt to dynamically find index based on headers
            for (let i = 0; i < headers.length; i++) {
                const headerText = headers[i].trim().toLowerCase();
                if (headerText === "số do" || headerText === "do") {
                    doColIdx = i;
                } else if (headerText === "tên siêu thị" || headerText === "tên cửa hàng" || headerText === "siêu thị") {
                    storeColIdx = i;
                } else if ((headerText.includes("số kiện") && headerText.includes("pcs")) || headerText === "số kiện" || headerText === "kiện") {
                    qtyColIdx = i;
                }
            }

            console.log(`Column Mapping: DO -> index ${doColIdx}, Store -> index ${storeColIdx}, Qty -> index ${qtyColIdx}`);

            // Parse data rows (start from row index 1)
            let parsedCount = 0;
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length <= Math.max(doColIdx, storeColIdx, qtyColIdx)) continue;
                
                const doNumber = row[doColIdx].trim();
                const storeName = row[storeColIdx].trim();
                const qtyRaw = row[qtyColIdx].trim();
                
                if (!doNumber) continue;

                // Extract total packages from qty column
                // It can be a simple number like "5" or text like "15" or "13/13".
                // We extract the first sequence of digits.
                const match = qtyRaw.match(/\d+/);
                const totalPackages = match ? parseInt(match[0]) : 1;

                newDb[doNumber] = {
                    storeName: storeName,
                    totalPackages: totalPackages,
                    originalRow: row
                };
                parsedCount++;
            }

            db = newDb;
            console.log(`Parsed ${parsedCount} rows from sheet`);
            
            // Refocus input if enabled
            triggerFocus();
        }
    });
}

// Populates voices in the select-voice dropdown (Filtered to Vietnamese only, with online fallback)
function populateVoiceList() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    
    // Filter to ONLY include Vietnamese voices
    const viVoices = voices.filter(voice => voice.lang.toLowerCase().includes("vi"));

    let optionsHtml = "";
    if (viVoices.length === 0) {
        // No local Vietnamese voice, add the online fallback option as default
        optionsHtml = `<option value="online_google_tts">🌐 Google Dịch (Online)</option>`;
        elSelectVoice.innerHTML = optionsHtml;
        settings.preferredVoiceName = "online_google_tts";
        saveSettings();
        return;
    }

    // If there are local voices, display them and also add the online option as a choice!
    optionsHtml = viVoices.map(voice => {
        return `<option value="${voice.name}">🇻🇳 ${voice.name}</option>`;
    }).join("");
    optionsHtml += `<option value="online_google_tts">🌐 Google Dịch (Online)</option>`;
    elSelectVoice.innerHTML = optionsHtml;

    // Pre-select voice:
    // 1. Saved preferredVoiceName
    // 2. First Vietnamese voice
    let selectedVoice = viVoices.find(v => v.name === settings.preferredVoiceName);
    if (settings.preferredVoiceName === "online_google_tts") {
        elSelectVoice.value = "online_google_tts";
    } else if (selectedVoice) {
        elSelectVoice.value = selectedVoice.name;
    } else {
        selectedVoice = viVoices[0];
        elSelectVoice.value = selectedVoice.name;
        settings.preferredVoiceName = selectedVoice.name;
        saveSettings();
    }
}

// Text-to-Speech Helper (Web Speech API)
function initSpeechSynthesis() {
    if ('speechSynthesis' in window) {
        populateVoiceList();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = populateVoiceList;
        }
    }
}

let activeAudio = null;

function speakText(text) {
    if (!settings.ttsEnabled) return;
    
    // Check if they preferred Google Dịch Online
    if (settings.preferredVoiceName === "online_google_tts") {
        playOnlineTTS(text);
        return;
    }

    // Check if we have a Vietnamese voice in speechSynthesis
    const voices = ('speechSynthesis' in window) ? window.speechSynthesis.getVoices() : [];
    let voice = voices.find(v => v.name === settings.preferredVoiceName);
    if (!voice) {
        voice = voices.find(v => v.lang.toLowerCase().includes("vi"));
    }

    if (voice) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
    } else {
        // Fallback to online if no local voice found
        playOnlineTTS(text);
    }
}

function playOnlineTTS(text) {
    try {
        if (activeAudio) {
            activeAudio.pause();
            activeAudio.remove();
        }
        
        // Request the local Python backend API proxy (No CORS, No Referrer issue!)
        const url = `/api/tts?text=${encodeURIComponent(text)}`;
        
        activeAudio = new Audio(url);
        activeAudio.play().catch(e => {
            console.warn("Google TTS audio play failed:", e);
            fallbackSpeechSynthesis(text);
        });
    } catch (err) {
        console.error("Failed to run Google TTS online:", err);
        fallbackSpeechSynthesis(text);
    }
}

function fallbackSpeechSynthesis(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
}

// Web Audio API Sound generator
function playSound(type) {
    if (!settings.soundEnabled) return;
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Resume context if suspended (browser security)
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const now = audioCtx.currentTime;

        if (type === 'success') {
            // High-pitched short beep
            osc.frequency.setValueAtTime(900, now); // A5
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
        } 
        else if (type === 'complete') {
            // Success fanfare: 3 rising notes
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
            osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
            osc.frequency.setValueAtTime(1046.50, now + 0.24); // C6
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        } 
        else if (type === 'duplicate') {
            // Double warning beep
            osc.frequency.setValueAtTime(440, now); // A4
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.setValueAtTime(0, now + 0.07);
            gain.gain.setValueAtTime(0.08, now + 0.10);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.start(now);
            osc.stop(now + 0.22);
        } 
        else if (type === 'error') {
            // Low buzz
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(130, now);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        }
    } catch (e) {
        console.error("Audio playback error", e);
    }
}

// Clean Store Name for voice announcements
// Example: "WM+ DBN Tân Thủy, Tuần Giáo" -> "Tân Thủy, Tuần Giáo"
function cleanStoreName(name) {
    if (!name) return "Không rõ cửa hàng";
    let clean = name.trim();
    if (clean.startsWith("WM+")) {
        const parts = clean.split(/\s+/);
        if (parts.length > 2) {
            return parts.slice(2).join(" ");
        }
    }
    return clean;
}

// Process scanned string
function handleScanResult(rawText) {
    const text = rawText.trim();
    if (!text) return;

    // Parse scan input (QR or raw)
    let doNumber = "";
    let scannedPackageIdx = null; // 1-indexed

    if (text.includes("|")) {
        // Standard QR code format:
        // 1392|7079433553|SOWINSAL1372840|PPTD260704SVXZFP|CH.2.24|13/13
        const parts = text.split("|");
        if (parts.length >= 6) {
            doNumber = parts[1].trim();
            const packagePart = parts[5].trim(); // e.g. "13/13"
            const pkgParts = packagePart.split("/");
            scannedPackageIdx = parseInt(pkgParts[0]) || 1;
        } else {
            // Faulty QR code format, fallback to entire string as DO
            doNumber = text;
        }
    } else {
        // Raw barcode scan of DO (e.g. 7079433553)
        doNumber = text;
    }

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const timeStr = now.toLocaleTimeString("vi-VN");
    const timestamp = `${day}/${month}/${year} ${timeStr}`;

    // Look up DO in database
    const doRecord = db[doNumber];
    if (!doRecord) {
        // DO NOT FOUND
        playSound("error");
        speakText("Không thấy đi ô");
        
        updateUIVisuals({
            doNumber: doNumber,
            storeName: "Không tìm thấy trong Google Sheet",
            scannedCount: 0,
            totalPackages: 0,
            verdict: "error",
            scannedBadges: [],
            missingBadges: []
        });

        logToHistory({
            timestamp: timestamp,
            scanMode: settings.scanMode,
            doNumber: doNumber,
            storeName: "Mã DO không tồn tại",
            packageIdxText: scannedPackageIdx ? `Kiện ${scannedPackageIdx}` : "-",
            totalPackagesText: "-",
            status: "error",
            message: "Không thấy DO trong sheet"
        });
        return;
    }

    // DO FOUND
    const storeName = doRecord.storeName;
    const totalPackages = doRecord.totalPackages;
    const spokenStoreName = cleanStoreName(storeName);

    // Initialize scan tracking array for this DO + mode if not exists
    const stateKey = `${settings.scanMode}_${doNumber}`;
    if (!scanState[stateKey]) {
        scanState[stateKey] = [];
    }

    // Resolve package index for raw barcode scans
    if (scannedPackageIdx === null) {
        // Find first missing index to count it as scanned
        for (let i = 1; i <= totalPackages; i++) {
            if (!scanState[stateKey].includes(i)) {
                scannedPackageIdx = i;
                break;
            }
        }
        // If already full, assign to 1 just for reporting duplicate
        if (scannedPackageIdx === null) {
            scannedPackageIdx = 1;
        }
    }

    // Check for duplicate scan
    const isDuplicate = scanState[stateKey].includes(scannedPackageIdx);
    
    if (isDuplicate) {
        // DUPLICATE
        playSound("duplicate");
        speakText("Đã trùng");
        
        const scannedCount = scanState[stateKey].length;
        
        updateUIVisuals({
            doNumber: doNumber,
            storeName: storeName,
            scannedCount: scannedCount,
            totalPackages: totalPackages,
            verdict: scannedCount === totalPackages ? "complete" : "incomplete",
            scannedBadges: scanState[stateKey],
            missingBadges: getMissingIndices(scanState[stateKey], totalPackages)
        });

        logToHistory({
            timestamp: timestamp,
            scanMode: settings.scanMode,
            doNumber: doNumber,
            storeName: storeName,
            packageIdxText: `Kiện ${scannedPackageIdx}`,
            totalPackagesText: totalPackages,
            status: "warning",
            message: "Kiện đã quét trùng lặp"
        });
        return;
    }

    // NEW SCAN
    const isFirstScanOfDO = scanState[stateKey].length === 0;
    
    // Add to scanned list
    scanState[stateKey].push(scannedPackageIdx);
    scanState[stateKey].sort((a, b) => a - b);
    saveScanState();

    const scannedCount = scanState[stateKey].length;
    
    // Determine status & Speak announcement
    if (scannedCount === totalPackages) {
        // COMPLETE
        playSound("complete");
        speakText(`Đã đủ ${totalPackages} trên ${totalPackages} kiện`);
        
        updateUIVisuals({
            doNumber: doNumber,
            storeName: storeName,
            scannedCount: scannedCount,
            totalPackages: totalPackages,
            verdict: "complete",
            scannedBadges: scanState[stateKey],
            missingBadges: []
        });

        logToHistory({
            timestamp: timestamp,
            scanMode: settings.scanMode,
            doNumber: doNumber,
            storeName: storeName,
            packageIdxText: `Kiện ${scannedPackageIdx}`,
            totalPackagesText: totalPackages,
            status: "success",
            message: "Đã quét đủ tất cả các kiện"
        });
    } else {
        // INCOMPLETE
        playSound("success");
        if (isFirstScanOfDO) {
            // "Nếu có DO -> Báo DO có ... kiện. Khi quét được 1 kiện -> báo 1/... và tên cửa hàng"
            speakText(`Đi ô có ${totalPackages} kiện. Đang quét kiện thứ ${scannedPackageIdx} trên ${totalPackages}, ${spokenStoreName}`);
        } else {
            // General scan
            speakText(`${scannedPackageIdx} trên ${totalPackages}, ${spokenStoreName}`);
        }

        updateUIVisuals({
            doNumber: doNumber,
            storeName: storeName,
            scannedCount: scannedCount,
            totalPackages: totalPackages,
            verdict: "incomplete",
            scannedBadges: scanState[stateKey],
            missingBadges: getMissingIndices(scanState[stateKey], totalPackages)
        });

        logToHistory({
            timestamp: timestamp,
            scanMode: settings.scanMode,
            doNumber: doNumber,
            storeName: storeName,
            packageIdxText: `Kiện ${scannedPackageIdx}`,
            totalPackagesText: totalPackages,
            status: "success",
            message: `Thiếu ${totalPackages - scannedCount} kiện`
        });
    }
}

// Get array of missing package indices
function getMissingIndices(scannedArray, total) {
    const missing = [];
    for (let i = 1; i <= total; i++) {
        if (!scannedArray.includes(i)) {
            missing.push(i);
        }
    }
    return missing;
}

// Update scan result details on UI
function updateUIVisuals(data) {
    if (!data) {
        // Reset state UI
        elResultStoreCard.className = "store-name-card";
        elResultStoreName.textContent = "CHƯA QUÉT KIỆN NÀO";
        elResultDoNumber.textContent = "-";
        elResultProgressText.textContent = "0 / 0";
        elResultProgressBar.style.width = "0%";
        elResultProgressBar.className = "progress-bar-fill";
        elResultVerdict.textContent = "Đang chờ quét kiện đầu tiên...";
        elResultVerdict.className = "verdict-box verdict-empty";
        elResultScannedBadges.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">Chưa có</span>`;
        elResultMissingBadges.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">Chưa có</span>`;
        return;
    }

    // Set Card border status color
    elResultStoreCard.className = "store-name-card " + data.verdict;
    elResultStoreName.textContent = data.storeName;
    elResultDoNumber.textContent = data.doNumber;
    
    // Set Progress
    elResultProgressText.textContent = `${data.scannedCount} / ${data.totalPackages}`;
    const pct = data.totalPackages > 0 ? (data.scannedCount / data.totalPackages) * 100 : 0;
    elResultProgressBar.style.width = pct + "%";
    
    if (data.verdict === "complete") {
        elResultProgressBar.className = "progress-bar-fill complete";
        
        elResultVerdict.textContent = "✅ ĐÃ ĐỦ HÀNG";
        elResultVerdict.className = "verdict-box verdict-complete";
    } else if (data.verdict === "incomplete") {
        elResultProgressBar.className = "progress-bar-fill";
        
        const missingCount = data.totalPackages - data.scannedCount;
        elResultVerdict.textContent = `⚠️ CHƯA ĐỦ (Thiếu ${missingCount} kiện)`;
        elResultVerdict.className = "verdict-box verdict-incomplete";
    } else {
        elResultProgressBar.className = "progress-bar-fill";
        elResultProgressBar.style.width = "0%";
        elResultVerdict.textContent = "❌ KHÔNG TÌM THẤY DO";
        elResultVerdict.className = "verdict-box verdict-empty";
        elResultVerdict.style.color = "var(--accent-red)";
        elResultVerdict.style.borderColor = "rgba(239, 68, 68, 0.2)";
        elResultVerdict.style.background = "rgba(239, 68, 68, 0.1)";
    }

    // Render Scanned Badges
    if (data.scannedBadges.length > 0) {
        elResultScannedBadges.innerHTML = data.scannedBadges.map(idx => 
            `<span class="pkg-badge scanned">${idx}</span>`
        ).join("");
    } else {
        elResultScannedBadges.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">Không có</span>`;
    }

    // Render Missing Badges
    if (data.missingBadges.length > 0) {
        elResultMissingBadges.innerHTML = data.missingBadges.map(idx => 
            `<span class="pkg-badge missing">${idx}</span>`
        ).join("");
    } else {
        elResultMissingBadges.innerHTML = data.verdict === "complete" ? 
            `<span style="color: var(--accent-teal); font-weight: 700;">Đã quét đủ</span>` : 
            `<span style="color: var(--text-muted); font-style: italic;">Không có</span>`;
    }
}

// Updates the UI progress elements based on the currently active DO and the current scanMode
function updateUIForActiveDO() {
    const activeDo = elResultDoNumber.textContent.trim();
    if (!activeDo || activeDo === "-") {
        updateUIVisuals(null);
        return;
    }
    
    const doRecord = db[activeDo];
    if (!doRecord) {
        updateUIVisuals(null);
        return;
    }
    
    const stateKey = `${settings.scanMode}_${activeDo}`;
    const scannedBadges = scanState[stateKey] || [];
    const scannedCount = scannedBadges.length;
    const totalPackages = doRecord.totalPackages;
    
    updateUIVisuals({
        doNumber: activeDo,
        storeName: doRecord.storeName,
        scannedCount: scannedCount,
        totalPackages: totalPackages,
        verdict: scannedCount === totalPackages ? "complete" : "incomplete",
        scannedBadges: scannedBadges,
        missingBadges: getMissingIndices(scannedBadges, totalPackages)
    });
}

// Log scan results into History Log state & render
function logToHistory(logObj) {
    scanHistory.unshift(logObj); // Add to beginning of array
    // Cap history length at 100 for browser performance
    if (scanHistory.length > 100) {
        scanHistory.pop();
    }
    saveScanState();
    renderHistory();
}

// Render history log table
function renderHistory() {
    if (scanHistory.length === 0) {
        elHistoryLogBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center" style="color: var(--text-muted); padding: 2rem;">
                    Chưa có hoạt động quét nào trong phiên làm việc này.
                </td>
            </tr>
        `;
        return;
    }

    elHistoryLogBody.innerHTML = scanHistory.map(log => {
        let statusBadge = "";
        if (log.status === "success") {
            statusBadge = `<span class="badge badge-success">✓ Thành công</span>`;
        } else if (log.status === "warning") {
            statusBadge = `<span class="badge badge-warning">⚠ Trùng lặp</span>`;
        } else {
            statusBadge = `<span class="badge badge-error">✗ Lỗi</span>`;
        }

        const modeBadge = log.scanMode === "Xuất" ? 
            `<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.12); color: var(--accent-yellow); border: 1px solid rgba(245, 158, 11, 0.25);">📤 Xuất</span>` : 
            `<span class="badge badge-success" style="background: rgba(0, 161, 154, 0.12); color: var(--accent-teal); border: 1px solid rgba(0, 161, 154, 0.25);">📥 Nhập</span>`;

        return `
            <tr>
                <td>${log.timestamp}</td>
                <td style="text-align: center;">${modeBadge}</td>
                <td style="font-family: monospace; font-weight: 700;">${log.doNumber}</td>
                <td>${log.storeName}</td>
                <td style="text-align: center; font-weight: 700;">${log.packageIdxText}</td>
                <td style="text-align: center; color: var(--text-secondary);">${log.totalPackagesText}</td>
                <td style="text-align: center;">${statusBadge}<br><small style="color: var(--text-muted); font-size: 0.75rem;">${log.message}</small></td>
            </tr>
        `;
    }).join("");
}

// Handle submit manual scanning input
function handleManualInput() {
    const text = elManualScanInput.value.trim();
    if (text) {
        handleScanResult(text);
        elManualScanInput.value = "";
    }
    triggerFocus();
}

// Export Scan History and progress state to CSV
function exportScanReport() {
    if (scanHistory.length === 0) {
        alert("Chưa có lịch sử quét nào để xuất báo cáo!");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // Add BOM for Excel UTF-8 display
    csvContent += "Thời gian,Hướng,Số DO,Tên Cửa Hàng,Kiện quét được,Tổng số kiện,Trạng thái,Ghi chú\n";

    scanHistory.forEach(log => {
        const row = [
            `"${log.timestamp}"`,
            `"${log.scanMode || 'Nhập'}"`,
            `"${log.doNumber}"`,
            `"${log.storeName}"`,
            `"${log.packageIdxText}"`,
            `"${log.totalPackagesText}"`,
            `"${log.status === 'success' ? 'Thành công' : log.status === 'warning' ? 'Trùng' : 'Lỗi'}"`,
            `"${log.message}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Báo_cáo_quét_hàng_${new Date().toLocaleDateString("vi-VN").replace(/\//g, "-")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// HTML5 Camera controller
function toggleCamera() {
    if (html5QrCode && html5QrCode.isScanning) {
        // Stop Camera
        html5QrCode.stop().then(() => {
            elBtnToggleCamera.textContent = "Bật Camera";
            elBtnToggleCamera.className = "btn btn-primary";
            elScannerStatus.textContent = "Máy quét đang tắt";
        }).catch(err => {
            console.error("Failed to stop scanner", err);
        });
    } else {
        // Start Camera
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }

        // Get cameras list if not loaded
        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length > 0) {
                // Render camera selection list
                elCameraSelect.innerHTML = devices.map((device, index) => 
                    `<option value="${device.id}" ${index === devices.length - 1 ? 'selected' : ''}>${device.label || 'Camera ' + (index + 1)}</option>`
                ).join("");
                
                // Select last camera by default (usually rear camera on mobiles)
                activeCameraId = devices[devices.length - 1].id;
                
                startScanning();
            } else {
                alert("Không tìm thấy camera nào trên thiết bị.");
                elScannerStatus.textContent = "Không tìm thấy camera";
            }
        }).catch(err => {
            console.error("Camera access failed", err);
            alert("Lỗi truy cập camera: Hãy đảm bảo bạn đã cấp quyền sử dụng camera.");
            elScannerStatus.textContent = "Lỗi cấp quyền camera";
        });
    }
}

function startScanning() {
    if (!activeCameraId) return;

    elScannerStatus.textContent = "Đang kết nối camera...";
    
    html5QrCode.start(
        activeCameraId,
        {
            fps: 10,
            qrbox: function(width, height) {
                const size = Math.min(width, height) * 0.7;
                return { width: size, height: size };
            }
        },
        (decodedText, decodedResult) => {
            // On QR Code Scan Success
            handleScanResult(decodedText);
        },
        (errorMessage) => {
            // Scan fails silently (usual behavior while searching)
        }
    ).then(() => {
        elBtnToggleCamera.textContent = "Tắt Camera";
        elBtnToggleCamera.className = "btn btn-secondary";
        elScannerStatus.textContent = "Máy quét đang hoạt động";
    }).catch(err => {
        console.error("Failed to start camera scan", err);
        elScannerStatus.textContent = "Lỗi khởi động camera";
    });
}
