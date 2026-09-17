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

    const syncState = {
        scriptUrl: localStorage.getItem(STORAGE_KEY_URL) || '',
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
        onInboundUpdateCallback: null
    };

    // Initialize queue from storage
    try {
        const savedQueue = localStorage.getItem(STORAGE_KEY_QUEUE);
        if (savedQueue) syncState.queue = JSON.parse(savedQueue);
    } catch (e) {
        syncState.queue = [];
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
            const payload = {
                action: 'batch_export',
                scans: batch
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
                    syncState.queue.splice(0, batch.length);
                    saveQueue();
                    console.log(`Flushed ${batch.length} scans to Google Sheets successfully.`);
                }
            }
        } catch (e) {
            console.warn('Queue flush retry failed:', e);
        } finally {
            syncState.isSyncing = false;
            updateStatusPill();
        }
    }

    // Background Peer Polling: Query peer scans every 3 seconds
    async function pollPeerScans() {
        if (!syncState.scriptUrl || !syncState.tripCode || !syncState.isOnline) return;

        try {
            const sep = syncState.scriptUrl.includes('?') ? '&' : '?';
            const url = `${syncState.scriptUrl}${sep}action=sync_peer_scans&tripCode=${encodeURIComponent(syncState.tripCode)}&_t=${Date.now()}`;
            const res = await fetch(url, { method: 'GET', mode: 'cors' });
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'SUCCESS' && Array.isArray(data.scannedItems)) {
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
                }
            }
        } catch (e) {
            // Ignore background polling errors silently
        }
    }

    // Start background sync loop
    function startPeerPolling() {
        if (syncState.pollInterval) clearInterval(syncState.pollInterval);
        syncState.pollInterval = setInterval(() => {
            pollPeerScans();
            flushQueue();
        }, 3000);
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

        if (!syncState.scriptUrl) {
            pill.className = 'sync-pill sync-pill-unconfigured';
            pill.innerHTML = '⚙️ Cấu hình Google Sheet';
            pill.title = 'Chưa liên kết Google Sheets. Bấm để cấu hình!';
            return;
        }

        if (!syncState.isOnline) {
            pill.className = 'sync-pill sync-pill-offline';
            pill.innerHTML = `🔴 Mất mạng (${syncState.queue.length} chờ)`;
            pill.title = 'Không có kết nối Internet. Dữ liệu đang được lưu cục bộ trên máy.';
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
        pill.innerHTML = '🟢 Online Sync OK';
        pill.title = 'Đang đồng bộ trực tiếp với Google Sheets thời gian thực.';
    }

    // Modal: Configuration UI
    function openConfigModal() {
        const existing = document.getElementById('modal-google-sheet-config');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-google-sheet-config';
        modal.className = 'pilot-modal-overlay';
        modal.innerHTML = `
            <div class="pilot-modal" style="max-width: 580px;">
                <div class="pilot-modal-header">
                    <span class="pilot-modal-title">🌐 CẤU HÌNH ĐỒNG BỘ ONLINE GOOGLE SHEETS</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-close-sync-modal">✕</button>
                </div>

                <div class="pilot-instructions-box" style="margin-bottom: 1rem; font-size: 0.85rem;">
                    <strong>HƯỚNG DẪN LIÊN KẾT BẢNG TÍNH GOOGLE (1 PHÚT):</strong>
                    <ol style="margin-top: 0.35rem; padding-left: 1.2rem; line-height: 1.45;">
                        <li>Tạo 1 Google Sheets mới trên Google Drive của bạn.</li>
                        <li>Vào menu <strong>Tiện ích mở rộng -> Apps Script</strong>.</li>
                        <li>Dán nội dung từ file <code>google_sheets_script.gs</code> vào và bấm Lưu.</li>
                        <li>Bấm <strong>Triển khai -> Tùy chọn triển khai mới -> Ứng dụng web</strong> (Quyền truy cập: <em>Bất kỳ ai / Anyone</em>).</li>
                        <li>Dán URL nhận được vào ô bên dưới và bấm <strong>Kiểm tra kết nối</strong>.</li>
                    </ol>
                </div>

                <div class="pilot-form-grid" style="margin-bottom: 1.2rem;">
                    <div class="pilot-form-group">
                        <label for="input-sheet-url">URL Ứng dụng web Google Apps Script (Web App URL):</label>
                        <input type="url" id="input-sheet-url" placeholder="https://script.google.com/macros/s/.../exec" value="${syncState.scriptUrl}">
                    </div>
                    <div class="pilot-form-group">
                        <label for="input-sync-operator">Mã nhân viên của máy này (Operator Code):</label>
                        <input type="text" id="input-sync-operator" placeholder="VD: NV01, NV02" value="${syncState.operatorCode}">
                    </div>
                </div>

                <div id="sync-test-status" style="margin-bottom: 1rem; font-size: 0.85rem; font-weight: 600; display: none;"></div>

                <div style="display: flex; gap: 0.5rem; justify-content: space-between; align-items: center;">
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-test-sheet-conn">
                        🔍 Kiểm tra kết nối
                    </button>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" class="btn btn-secondary" id="btn-cancel-sync-modal">Đóng</button>
                        <button type="button" class="btn btn-primary" id="btn-save-sync-modal">💾 Lưu Cấu Hình</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const statusEl = document.getElementById('sync-test-status');

        document.getElementById('btn-close-sync-modal').addEventListener('click', () => modal.remove());
        document.getElementById('btn-cancel-sync-modal').addEventListener('click', () => modal.remove());

        document.getElementById('btn-test-sheet-conn').addEventListener('click', async () => {
            const url = document.getElementById('input-sheet-url').value.trim();
            statusEl.style.display = 'block';
            statusEl.style.color = '#f59e0b';
            statusEl.textContent = '⏳ Đang kiểm tra kết nối tới Google Sheets...';

            const res = await testConnection(url);
            if (res.success) {
                statusEl.style.color = '#10b981';
                statusEl.textContent = '✅ ' + res.message;
            } else {
                statusEl.style.color = '#ef4444';
                statusEl.textContent = '❌ ' + res.message;
            }
        });

        document.getElementById('btn-save-sync-modal').addEventListener('click', () => {
            const url = document.getElementById('input-sheet-url').value.trim();
            const op = document.getElementById('input-sync-operator').value.trim() || 'NV01';
            setScriptUrl(url);
            setOperatorCode(op);
            modal.remove();
            alert('Đã lưu cấu hình Google Sheets thành công!');
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
        flushQueue,
        fetchTripManifest,
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
