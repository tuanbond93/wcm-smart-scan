// =============================================================================
// WCM SMART SCAN - ONLINE REAL-TIME SYNCHRONIZATION ENGINE
// Hỗ trợ 2 người bắn đồng thời, lưu trữ Google Sheets, và đối chiếu đầu nhập
// =============================================================================

(function() {
    'use strict';

    const STORAGE_KEY_URL = 'wcm_google_sheet_url';
    const STORAGE_KEY_OPERATOR = 'wcm_operator_code';
    const STORAGE_KEY_TRIP = 'wcm_current_trip_code';
    const STORAGE_KEY_QUEUE = 'wcm_offline_sync_queue';

    // Helper to get master configuration from config.js
    function getMasterConfigUrl() {
        if (window.WCM_CONFIG && typeof window.WCM_CONFIG.MASTER_GOOGLE_SHEET_URL === 'string') {
            return window.WCM_CONFIG.MASTER_GOOGLE_SHEET_URL.trim();
        }
        return '';
    }

    // Auto-detect & auto-store URL query param ?sheet_url=... or ?set_sheet_url=...
    function extractQuerySheetUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const sheetParam = params.get('sheet_url') || params.get('set_sheet_url');
            if (sheetParam) {
                const cleaned = sheetParam.trim();
                localStorage.setItem(STORAGE_KEY_URL, cleaned);
                // Clean URL bar so user doesn't see giant URL query parameter
                try {
                    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
                } catch(e) {}
                return cleaned;
            }
        } catch (e) {}
        return '';
    }

    const queryUrl = extractQuerySheetUrl();
    const masterUrl = getMasterConfigUrl();
    const activeUrl = masterUrl || queryUrl || localStorage.getItem(STORAGE_KEY_URL) || '';

    const syncState = {
        scriptUrl: activeUrl,
        operatorCode: localStorage.getItem(STORAGE_KEY_OPERATOR) || 'NV01',
        tripCode: localStorage.getItem(STORAGE_KEY_TRIP) || '',
        isOnline: navigator.onLine,
        isSyncing: false,
        queue: [],
        peerKnownKeys: new Set(),      // Set of packageCodes seen across all devices for active trip
        peerScansList: [],             // Array of { packageCode, operator, timestamp }
        pollInterval: null,
        onPeerUpdateCallback: null,
        onQueueUpdateCallback: null,
        onInboundUpdateCallback: null,
        isMasterLocked: Boolean(masterUrl)
    };

    // If masterUrl is provided in config.js, ensure localStorage also mirrors it
    if (masterUrl) {
        localStorage.setItem(STORAGE_KEY_URL, masterUrl);
    }

    // Initialize queue from storage (with IndexedDB fallback & migration)
    try {
        const savedQueue = localStorage.getItem(STORAGE_KEY_QUEUE);
        if (savedQueue) syncState.queue = JSON.parse(savedQueue);
    } catch (e) {
        syncState.queue = [];
    }

    // Load from persistent IndexedDB asynchronously
    if (window.WCM_DB && window.WCM_DB.getSyncQueue) {
        window.WCM_DB.getSyncQueue().then(idbQueue => {
            if (Array.isArray(idbQueue) && idbQueue.length > 0) {
                const idMap = new Map();
                syncState.queue.forEach(item => { if (item && item.id) idMap.set(item.id, item); });
                idbQueue.forEach(item => { if (item && item.id) idMap.set(item.id, item); });
                syncState.queue = Array.from(idMap.values());
                saveQueue();
            }
        }).catch(() => {});
    }

    // Network status listeners
    window.addEventListener('online', () => {
        syncState.isOnline = true;
        updateStatusPill();
        flushQueue();
    });

    window.addEventListener('offline', () => {
        syncState.isOnline = false;
        updateStatusPill();
    });

    function saveQueue() {
        localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(syncState.queue));
        if (window.WCM_DB && window.WCM_DB.enqueueSyncItem) {
            syncState.queue.forEach(item => window.WCM_DB.enqueueSyncItem(item));
        }
        if (syncState.onQueueUpdateCallback) {
            syncState.onQueueUpdateCallback(syncState.queue.length);
        }
        updateStatusPill();
    }

    function setScriptUrl(url) {
        const clean = (url || '').trim();
        syncState.scriptUrl = clean;
        localStorage.setItem(STORAGE_KEY_URL, clean);
        updateStatusPill();
        if (clean && syncState.queue.length > 0) {
            flushQueue();
        }
    }

    function getScriptUrl() {
        return syncState.scriptUrl;
    }

    function setOperatorCode(code) {
        const clean = (code || 'NV01').trim();
        syncState.operatorCode = clean;
        localStorage.setItem(STORAGE_KEY_OPERATOR, clean);
        // Automatically sync to Export screen input if present
        const elExportOp = document.getElementById('export-operator-code');
        if (elExportOp && elExportOp.value !== clean) {
            elExportOp.value = clean;
        }
        updateStatusPill();
    }

    function getOperatorCode() {
        return syncState.operatorCode || 'NV01';
    }

    function setTripCode(code) {
        const clean = (code || '').trim();
        syncState.tripCode = clean;
        localStorage.setItem(STORAGE_KEY_TRIP, clean);
        syncState.peerKnownKeys.clear();
        syncState.peerScansList = [];
        if (clean) {
            pollPeerScans();
        }
    }

    function getTripCode() {
        return syncState.tripCode;
    }

    // Ping / test connection to Google Apps Script
    async function testConnection(url) {
        const targetUrl = url || syncState.scriptUrl;
        if (!targetUrl) return { success: false, message: 'Chưa nhập URL Google Apps Script!' };

        try {
            const separator = targetUrl.includes('?') ? '&' : '?';
            const res = await fetch(`${targetUrl}${separator}action=ping&_t=${Date.now()}`, {
                method: 'GET',
                mode: 'cors'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const data = await res.json();
            if (data.status === 'SUCCESS') {
                return { success: true, message: 'Kết nối Google Sheets thành công!' };
            } else {
                return { success: false, message: data.message || 'Lỗi phản hồi từ Google Sheets' };
            }
        } catch (e) {
            return { success: false, message: 'Không thể kết nối đến Web App: ' + e.message };
        }
    }

    // Send single scan or enqueue if offline
    async function recordScanOnline(scanPayload) {
        const item = {
            id: `SYNC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            action: scanPayload.action || 'export_scan',
            tripCode: scanPayload.tripCode || syncState.tripCode || 'CHUA_DAT_TEN',
            operatorCode: scanPayload.operatorCode || syncState.operatorCode || 'NV',
            packageCode: scanPayload.packageCode || scanPayload.uniqueKey || '',
            doNumber: scanPayload.doNumber || '',
            chCode: scanPayload.chCode || '',
            storeName: scanPayload.storeName || '',
            pkgIdxText: scanPayload.pkgIdxText || '',
            status: scanPayload.status || 'Hợp lệ',
            rawBarcode: scanPayload.rawBarcode || '',
            deviceInfo: scanPayload.deviceInfo || (navigator.userAgent.includes('Android') ? 'Android' : 'iOS/PC'),
            timestamp: scanPayload.timestamp || new Date().toISOString()
        };

        // Track in local peer memory immediately
        if (item.packageCode) {
            syncState.peerKnownKeys.add(item.packageCode);
            syncState.peerScansList.unshift({
                packageCode: item.packageCode,
                operator: item.operatorCode,
                timestamp: item.timestamp
            });
        }

        // If no URL configured or offline -> Enqueue for later
        if (!syncState.scriptUrl || !syncState.isOnline) {
            syncState.queue.push(item);
            saveQueue();
            return { sent: false, queued: true, message: 'Đã lưu hàng đợi Offline' };
        }

        // Try sending in background
        try {
            // Use text/plain to avoid CORS preflight rejection by Google Apps Script
            const res = await fetch(syncState.scriptUrl, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(item)
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { sent: true, queued: false, data: data };
        } catch (err) {
            console.warn('Sync failed, enqueuing:', err);
            syncState.queue.push(item);
            saveQueue();
            return { sent: false, queued: true, error: err.message };
        }
    }

    // Flush offline queue to Google Sheets
    async function flushQueue() {
        if (syncState.isSyncing || syncState.queue.length === 0 || !syncState.scriptUrl || !syncState.isOnline) {
            return;
        }

        syncState.isSyncing = true;
        updateStatusPill();

        try {
            const batch = syncState.queue.slice(0, 50); // Send up to 50 at a time
            const regularScans = [];
            const actionItems = [];

            batch.forEach(item => {
                if (item.action === 'undo_scan' || item.action === 'reassign_batch') {
                    actionItems.push(item);
                } else {
                    regularScans.push(item);
                }
            });

            const successfullySentIds = [];

            if (regularScans.length > 0) {
                const payload = {
                    action: 'batch_export',
                    scans: regularScans
                };

                const res = await fetch(syncState.scriptUrl, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'SUCCESS') {
                        regularScans.forEach(s => successfullySentIds.push(s.id));
                    }
                }
            }

            for (const act of actionItems) {
                try {
                    const res = await fetch(syncState.scriptUrl, {
                        method: 'POST',
                        mode: 'cors',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify(act)
                    });
                    if (res.ok) {
                        successfullySentIds.push(act.id);
                    }
                } catch (actErr) {
                    console.warn('[OnlineSync] Failed sending action item:', act.action, actErr);
                }
            }

            if (successfullySentIds.length > 0) {
                const sentSet = new Set(successfullySentIds);
                syncState.queue = syncState.queue.filter(q => !sentSet.has(q.id));
                saveQueue();
                if (window.WCM_DB && window.WCM_DB.removeSyncItems) {
                    window.WCM_DB.removeSyncItems(successfullySentIds);
                }
                console.log(`[OnlineSync] Processed ${successfullySentIds.length} items from sync queue.`);
            }
        } catch (e) {
            console.warn('[OnlineSync] Queue flush retry failed:', e);
        } finally {
            syncState.isSyncing = false;
            updateStatusPill();
        }
    }

    // Undo scan for single package (online direct or offline queued)
    async function undoScanOnline({ tripCode, packageCode }) {
        const item = {
            id: `UNDO-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            action: 'undo_scan',
            tripCode: tripCode || syncState.tripCode || '',
            packageCode: packageCode || '',
            timestamp: new Date().toISOString()
        };

        // Remove from local peer known keys immediately
        if (packageCode) {
            syncState.peerKnownKeys.delete(packageCode);
            syncState.peerScansList = syncState.peerScansList.filter(s => s.packageCode !== packageCode);
        }

        // Direct push if online
        if (syncState.isOnline && syncState.scriptUrl) {
            try {
                const res = await fetch(syncState.scriptUrl, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(item)
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'SUCCESS') {
                        return data;
                    }
                }
            } catch (e) {
                console.warn('[OnlineSync] Direct undo failed, queuing for retry:', e);
            }
        }

        // Queue if offline or failed
        syncState.queue.push(item);
        saveQueue();
        return { status: 'QUEUED', message: 'Đã lưu hàng đợi hoàn tác' };
    }

    // Adaptive Polling with Exponential Backoff and Visibility Awareness
    let basePollingInterval = (window.WCM_CONFIG && window.WCM_CONFIG.SYNC_INTERVAL_MS) || 5000;
    let currentPollingInterval = basePollingInterval;
    let isPollingActive = false;
    let pollTimerId = null;

    async function pollPeerScans() {
        if (!syncState.scriptUrl || !syncState.tripCode || !syncState.isOnline) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

        try {
            const sep = syncState.scriptUrl.includes('?') ? '&' : '?';
            const url = `${syncState.scriptUrl}${sep}action=sync_peer_scans&tripCode=${encodeURIComponent(syncState.tripCode)}&_t=${Date.now()}`;
            const res = await fetch(url, { method: 'GET', mode: 'cors' });
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'SUCCESS' && Array.isArray(data.scannedItems)) {
                    // Reset interval on success
                    currentPollingInterval = (window.WCM_CONFIG && window.WCM_CONFIG.SYNC_INTERVAL_MS) || 5000;

                    let newlyDiscoveredCount = 0;
                    data.scannedItems.forEach(item => {
                        if (!syncState.peerKnownKeys.has(item.packageCode)) {
                            syncState.peerKnownKeys.add(item.packageCode);
                            newlyDiscoveredCount++;
                        }
                    });

                    syncState.peerScansList = data.scannedItems;

                    if (syncState.onPeerUpdateCallback) {
                        syncState.onPeerUpdateCallback({
                            totalScanned: data.scannedItems.length,
                            peerScansList: data.scannedItems,
                            newlyDiscoveredCount: newlyDiscoveredCount
                        });
                    }
                } else {
                    // Backoff on non-success status
                    currentPollingInterval = Math.min(30000, Math.round(currentPollingInterval * 1.5));
                }
            } else {
                // Backoff on HTTP error
                currentPollingInterval = Math.min(30000, Math.round(currentPollingInterval * 1.5));
            }
        } catch (e) {
            // Backoff on network exception
            currentPollingInterval = Math.min(30000, Math.round(currentPollingInterval * 1.5));
        }
    }

    function scheduleNextPoll() {
        if (pollTimerId) clearTimeout(pollTimerId);
        if (!isPollingActive) return;

        pollTimerId = setTimeout(async () => {
            if (isPollingActive && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
                if (syncState.tripCode) {
                    await pollPeerScans();
                }
                if (syncState.queue.length > 0) {
                    await flushQueue();
                }
            }
            scheduleNextPoll();
        }, currentPollingInterval);
    }

    // Start background sync loop
    function startPeerPolling() {
        isPollingActive = true;
        currentPollingInterval = (window.WCM_CONFIG && window.WCM_CONFIG.SYNC_INTERVAL_MS) || 5000;
        scheduleNextPoll();
    }

    // Handle tab visibility changes to save battery & avoid wasteful requests
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (isPollingActive) {
                    currentPollingInterval = (window.WCM_CONFIG && window.WCM_CONFIG.SYNC_INTERVAL_MS) || 5000;
                    if (syncState.tripCode) pollPeerScans();
                    if (syncState.queue.length > 0) flushQueue();
                    scheduleNextPoll();
                }
            }
        });
    }

    // Inbound: Fetch trip manifest for reconciliation
    async function fetchTripManifest(tripCode) {
        const targetTrip = tripCode || syncState.tripCode;
        if (!targetTrip) throw new Error('Chưa nhập mã chuyến xe!');
        if (!syncState.scriptUrl) throw new Error('Chưa cấu hình URL Google Sheets!');

        const sep = syncState.scriptUrl.includes('?') ? '&' : '?';
        const url = `${syncState.scriptUrl}${sep}action=get_trip_manifest&tripCode=${encodeURIComponent(targetTrip)}&_t=${Date.now()}`;
        const res = await fetch(url, { method: 'GET', mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'SUCCESS') throw new Error(data.message || 'Lỗi tải danh sách chuyến');
        return data;
    }

    // Dashboard: Fetch overall progress across all active trips
    async function getAllTripsProgress() {
        if (!syncState.scriptUrl) throw new Error('Chưa cấu hình URL Google Sheets!');
        const sep = syncState.scriptUrl.includes('?') ? '&' : '?';
        const url = `${syncState.scriptUrl}${sep}action=get_all_trips_progress&_t=${Date.now()}`;
        const res = await fetch(url, { method: 'GET', mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'SUCCESS') throw new Error(data.message || 'Lỗi tải tiến độ chuyến');
        return data.trips || [];
    }

    // Check if a package was scanned by a peer
    function isKnownByPeer(packageCode) {
        if (!packageCode) return false;
        return syncState.peerKnownKeys.has(packageCode);
    }

    function getPeerScannerInfo(packageCode) {
        if (!packageCode) return null;
        return syncState.peerScansList.find(s => s.packageCode === packageCode) || null;
    }

    // UI Pill updater
    function updateStatusPill() {
        const pill = document.getElementById('online-sync-pill');
        if (!pill) return;

        const warehouseName = (window.WCM_CONFIG && window.WCM_CONFIG.WAREHOUSE_NAME) ? window.WCM_CONFIG.WAREHOUSE_NAME : 'Kho chung';

        if (!syncState.scriptUrl) {
            pill.className = 'sync-pill sync-pill-unconfigured';
            pill.innerHTML = '⚙️ Chưa gắn Sheet kho';
            pill.title = 'Chưa liên kết Google Sheets chung cho kho. Bấm để thiết lập!';
            return;
        }

        if (!syncState.isOnline) {
            pill.className = 'sync-pill sync-pill-offline';
            pill.innerHTML = `🔴 Mất mạng (${syncState.queue.length} chờ)`;
            pill.title = 'Không có kết nối Internet. Dữ liệu đang được lưu an toàn trên máy.';
            return;
        }

        if (syncState.isSyncing) {
            pill.className = 'sync-pill sync-pill-syncing';
            pill.innerHTML = `🔄 Đang đồng bộ (${syncState.queue.length})...`;
            return;
        }

        if (syncState.queue.length > 0) {
            pill.className = 'sync-pill sync-pill-queued';
            pill.innerHTML = `🟡 Chờ gửi (${syncState.queue.length})`;
            pill.title = `Có ${syncState.queue.length} lượt quét đang chờ đồng bộ lên Google Sheets.`;
            return;
        }

        pill.className = 'sync-pill sync-pill-online';
        pill.innerHTML = `🟢 Sheet: ${warehouseName} [${syncState.operatorCode}]`;
        pill.title = `Đang kết nối Google Sheet kho chung (${syncState.operatorCode}). Bấm để chọn người bắn.`;
    }

    // Modal: Configuration UI
    function openConfigModal() {
        const existing = document.getElementById('modal-google-sheet-config');
        if (existing) existing.remove();

        const warehouseName = (window.WCM_CONFIG && window.WCM_CONFIG.WAREHOUSE_NAME) ? window.WCM_CONFIG.WAREHOUSE_NAME : 'Kho Toll Supra';
        const isMasterConfigured = Boolean(getMasterConfigUrl());
        const hasActiveUrl = Boolean(syncState.scriptUrl);

        const modal = document.createElement('div');
        modal.id = 'modal-google-sheet-config';
        modal.className = 'pilot-modal-overlay';
        modal.innerHTML = `
            <div class="pilot-modal" style="max-width: 580px;">
                <div class="pilot-modal-header">
                    <span class="pilot-modal-title">🏢 ĐỒNG BỘ GOOGLE SHEET TRUNG TÂM</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-close-sync-modal">✕</button>
                </div>

                <!-- Central Status Banner -->
                ${hasActiveUrl ? `
                    <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid #10b981; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem;">
                        <div style="font-weight: 700; color: #10b981; font-size: 0.95rem; margin-bottom: 0.25rem;">
                            ✅ ĐÃ KẾT NỐI BẢNG TÍNH DÙNG CHUNG (${warehouseName})
                        </div>
                        <div style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.45;">
                            Tất cả thiết bị quét (NV01, NV02...) đều tự động ghi dữ liệu vào cùng 1 Google Sheet trung tâm này. 
                            <strong>Nhân viên không cần phải tự cấu hình URL trên từng máy.</strong>
                        </div>
                    </div>
                ` : `
                    <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid #f59e0b; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem;">
                        <div style="font-weight: 700; color: #f59e0b; font-size: 0.95rem; margin-bottom: 0.25rem;">
                            ⚠️ CHƯA CÓ GOOGLE SHEET DÙNG CHUNG CHO KHO
                        </div>
                        <div style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.45;">
                            Quản trị viên chỉ cần dán URL Web App 1 lần bên dưới, sau đó bấm <strong>"Sao chép link Zalo"</strong> gửi cho tổ để tất cả điện thoại tự động đồng bộ vào chung 1 sheet.
                        </div>
                    </div>
                `}

                <!-- SECTION 1: WORKER OPERATOR SELECTION (1-TAP) -->
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1rem;">
                    <label style="display: block; font-weight: 700; font-size: 0.85rem; color: #38bdf8; margin-bottom: 0.5rem;">
                        👤 BẠN LÀ NGƯỜI BẮN SỐ MẤY? (CHỌN 1 CHẠM):
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.6rem;">
                        <button type="button" class="btn btn-sm op-quick-select ${syncState.operatorCode === 'NV01' ? 'btn-primary' : 'btn-secondary'}" data-op="NV01" style="justify-content: flex-start; text-align: left; padding: 0.5rem 0.7rem;">
                            <strong>NV01</strong> &nbsp;(Cửa xe / Chuyền 1)
                        </button>
                        <button type="button" class="btn btn-sm op-quick-select ${syncState.operatorCode === 'NV02' ? 'btn-primary' : 'btn-secondary'}" data-op="NV02" style="justify-content: flex-start; text-align: left; padding: 0.5rem 0.7rem;">
                            <strong>NV02</strong> &nbsp;(Pallet / Chuyền 2)
                        </button>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <span style="font-size: 0.8rem; color: #94a3b8;">Hoặc mã/tên khác:</span>
                        <input type="text" id="input-sync-operator" value="${syncState.operatorCode}" style="padding: 0.35rem 0.6rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; width: 120px; font-weight: 700; text-align: center;">
                    </div>
                </div>

                <!-- SECTION 2: WAREHOUSE MANAGER SETTINGS (COLLAPSIBLE) -->
                <details style="background: rgba(15, 23, 42, 0.6); border: 1px dashed #475569; border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem;" ${!hasActiveUrl ? 'open' : ''}>
                    <summary style="font-size: 0.85rem; font-weight: 700; color: #f59e0b; cursor: pointer; user-select: none;">
                        ⚙️ CÀI ĐẶT QUẢN TRỊ (Quản lý kho cấu hình & Chia sẻ link)
                    </summary>
                    <div style="margin-top: 0.75rem;">
                        <div class="pilot-instructions-box" style="margin-bottom: 0.75rem; font-size: 0.78rem; line-height: 1.45;">
                            <strong>Cách cấu hình đồng bộ 1 Sheet duy nhất cho cả kho:</strong>
                            <ol style="margin-top: 0.3rem; padding-left: 1.1rem;">
                                <li>Tạo 1 Google Sheets -> <em>Tiện ích mở rộng -> Apps Script</em> -> Dán file <code>google_sheets_script.gs</code>.</li>
                                <li>Triển khai dưới dạng <strong>Ứng dụng web</strong> (Quyền: <em>Bất kỳ ai / Anyone</em>).</li>
                                <li>Dán link vào ô bên dưới rồi bấm <strong>"Sao chép Link Gửi Zalo"</strong>.</li>
                                <li>Gửi link đó vào nhóm Zalo kho -> Mọi nhân viên bấm vào là TỰ ĐỘNG DÙNG CHUNG SHEET ĐÓ!</li>
                            </ol>
                        </div>

                        <div class="pilot-form-group" style="margin-bottom: 0.6rem;">
                            <label for="input-sheet-url" style="font-size: 0.8rem; color: #cbd5e1;">URL Google Apps Script Web App (Dùng chung cả kho):</label>
                            <input type="url" id="input-sheet-url" placeholder="https://script.google.com/macros/s/.../exec" value="${syncState.scriptUrl}" ${isMasterConfigured ? 'readonly style="background:#1e293b; color:#94a3b8; cursor:not-allowed;"' : ''}>
                            ${isMasterConfigured ? '<small style="color:#10b981; margin-top:0.25rem;">🔒 Đã khóa cố định từ config.js (Nhân viên không thể sửa nhầm)</small>' : ''}
                        </div>

                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-test-sheet-conn">
                                🔍 Kiểm tra kết nối
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-team-link" style="background: rgba(14, 165, 233, 0.15); border-color: #0ea5e9; color: #38bdf8;">
                                📋 Sao chép Link Gửi Zalo Cho Tổ
                            </button>
                        </div>
                        <div id="sync-test-status" style="font-size: 0.82rem; font-weight: 600; display: none; margin-top: 0.4rem;"></div>
                    </div>
                </details>

                <div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center;">
                    <button type="button" class="btn btn-secondary" id="btn-cancel-sync-modal">Đóng</button>
                    <button type="button" class="btn btn-primary" id="btn-save-sync-modal">💾 Áp Dụng</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const statusEl = document.getElementById('sync-test-status');
        const inputUrl = document.getElementById('input-sheet-url');
        const inputOp = document.getElementById('input-sync-operator');

        // Quick operator selector buttons
        modal.querySelectorAll('.op-quick-select').forEach(btn => {
            btn.addEventListener('click', () => {
                const op = btn.getAttribute('data-op');
                inputOp.value = op;
                modal.querySelectorAll('.op-quick-select').forEach(b => {
                    b.className = 'btn btn-sm op-quick-select btn-secondary';
                });
                btn.className = 'btn btn-sm op-quick-select btn-primary';
            });
        });

        document.getElementById('btn-close-sync-modal').addEventListener('click', () => modal.remove());
        document.getElementById('btn-cancel-sync-modal').addEventListener('click', () => modal.remove());

        // Test connection
        document.getElementById('btn-test-sheet-conn').addEventListener('click', async () => {
            const url = inputUrl.value.trim();
            statusEl.style.display = 'block';
            statusEl.style.color = '#f59e0b';
            statusEl.textContent = '⏳ Đang kiểm tra kết nối tới Google Sheets...';

            const res = await testConnection(url);
            if (res.success) {
                statusEl.style.color = '#10b981';
                statusEl.textContent = '✅ ' + res.message;
            } else {
                statusEl.style.color = '#ef4444';
                let errMsg = '❌ ' + res.message;
                if (res.message && (res.message.includes('getSheetByName') || res.message.includes('null'))) {
                    errMsg += ' — 💡 NGUYÊN NHÂN: Script này chưa được liên kết với file Google Sheets. Cách sửa: Mở file Google Sheets -> chọn menu "Tiện ích mở rộng" -> "Apps Script" rồi dán code vào đó; hoặc điền ID file Sheet vào biến SPREADSHEET_ID.';
                }
                statusEl.textContent = errMsg;
            }
        });

        // Copy Shareable Team Link (Zalo)
        document.getElementById('btn-copy-team-link').addEventListener('click', () => {
            const url = inputUrl.value.trim();
            if (!url) {
                alert('Vui lòng nhập URL Google Apps Script trước khi sao chép link!');
                return;
            }
            const origin = window.location.origin + window.location.pathname;
            const shareableUrl = `${origin}?sheet_url=${encodeURIComponent(url)}`;
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(shareableUrl).then(() => {
                    statusEl.style.display = 'block';
                    statusEl.style.color = '#10b981';
                    statusEl.textContent = '✅ Đã sao chép link kho vào bộ nhớ đệm! Hãy gửi link này vào nhóm Zalo kho. Mọi nhân viên bấm vào là TỰ ĐỘNG DÙNG CHUNG SHEET.';
                }).catch(() => {
                    prompt('Sao chép đường link này gửi Zalo cho nhân viên:', shareableUrl);
                });
            } else {
                prompt('Sao chép đường link này gửi Zalo cho nhân viên:', shareableUrl);
            }
        });

        // Save & Apply
        document.getElementById('btn-save-sync-modal').addEventListener('click', () => {
            const url = inputUrl.value.trim();
            const op = inputOp.value.trim() || 'NV01';
            if (!isMasterConfigured) {
                setScriptUrl(url);
            }
            setOperatorCode(op);
            modal.remove();
        });
    }

    // Public API
    window.OnlineSync = {
        init: function() {
            updateStatusPill();
            startPeerPolling();
            const pill = document.getElementById('online-sync-pill');
            if (pill) {
                pill.addEventListener('click', openConfigModal);
            }
        },
        setScriptUrl,
        getScriptUrl,
        setOperatorCode,
        getOperatorCode,
        setTripCode,
        getTripCode,
        recordScan: recordScanOnline,
        undoScan: undoScanOnline,
        flushQueue,
        fetchTripManifest,
        getAllTripsProgress,
        testConnection,
        openConfigModal,
        isKnownByPeer,
        getPeerScannerInfo,
        onPeerUpdate: function(cb) { syncState.onPeerUpdateCallback = cb; },
        onQueueUpdate: function(cb) { syncState.onQueueUpdateCallback = cb; },
        onInboundUpdate: function(cb) { syncState.onInboundUpdateCallback = cb; },
        getState: function() { return syncState; }
    };

    // Auto-init on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.OnlineSync.init());
    } else {
        window.OnlineSync.init();
    }
})();
