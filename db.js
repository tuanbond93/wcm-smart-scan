// =============================================================================
// WCM SMART SCAN - INDEXEDDB PERSISTENT OFFLINE STORAGE ENGINE
// Chống mất dữ liệu quét khi xóa cache trình duyệt, tự động kích hoạt
// persistent storage và di trú dữ liệu an toàn từ localStorage.
// =============================================================================

(function() {
    'use strict';

    const DB_NAME = 'wcm_smart_scan_db';
    const DB_VERSION = 1;
    const STORE_QUEUE = 'sync_queue';
    const STORE_STATE = 'app_state';

    let dbInstance = null;
    let dbInitPromise = null;

    // Helper: Mở kết nối IndexedDB
    function getDB() {
        if (dbInstance) return Promise.resolve(dbInstance);
        if (dbInitPromise) return dbInitPromise;

        dbInitPromise = new Promise((resolve) => {
            if (!window.indexedDB) {
                console.warn('[WCM_DB] IndexedDB không khả dụng trên trình duyệt này. Fallback sang localStorage.');
                return resolve(null);
            }

            const request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                    const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
                    queueStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_STATE)) {
                    db.createObjectStore(STORE_STATE, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                dbInstance = event.target.result;
                console.log('[WCM_DB] IndexedDB kết nối thành công:', DB_NAME);
                requestPersistentStorage();
                migrateFromLocalStorage().then(() => {
                    resolve(dbInstance);
                });
            };

            request.onerror = (event) => {
                console.error('[WCM_DB] Lỗi mở IndexedDB:', event.target.error);
                resolve(null); // Fallback to localStorage gracefully
            };
        });

        return dbInitPromise;
    }

    // Yêu cầu trình duyệt không tự xóa bộ nhớ (Persistent Storage API)
    async function requestPersistentStorage() {
        try {
            if (navigator.storage && navigator.storage.persist) {
                const isPersisted = await navigator.storage.persist();
                if (isPersisted) {
                    console.log('[WCM_DB] Trình duyệt đã cấp quyền Persistent Storage: Dữ liệu an toàn vĩnh viễn.');
                } else {
                    console.warn('[WCM_DB] Trình duyệt chưa cấp Persistent Storage; có thể bị dọn dẹp khi ổ cứng đầy.');
                }
            }
        } catch (e) {
            console.warn('[WCM_DB] Không thể kiểm tra persistent storage:', e);
        }
    }

    // Kiểm tra và cảnh báo nếu người dùng đang ở chế độ Ẩn danh (Incognito)
    async function checkIncognitoMode() {
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const { quota } = await navigator.storage.estimate();
                // Safari private mode hoặc Chrome incognito thường giới hạn quota rất thấp (< 120MB)
                if (quota && quota < 120 * 1024 * 1024) {
                    showIncognitoWarning();
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function showIncognitoWarning() {
        window.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('incognito-warning-banner')) return;
            const warningBanner = document.createElement('div');
            warningBanner.id = 'incognito-warning-banner';
            warningBanner.style.cssText = `
                position: fixed;
                bottom: 12px;
                left: 12px;
                right: 12px;
                background: rgba(239, 68, 68, 0.95);
                color: #ffffff;
                font-family: 'Space Grotesk', sans-serif;
                font-size: 0.85rem;
                padding: 10px 14px;
                border-radius: 8px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            `;
            warningBanner.innerHTML = `
                <span>⚠️ <strong>Cảnh báo bộ nhớ:</strong> Trình duyệt có vẻ đang ở chế độ Ẩn danh hoặc hạn chế lưu trữ. Hãy mở tab thường để đảm bảo không mất dữ liệu quét!</span>
                <button type="button" style="background: rgba(255,255,255,0.25); border: none; color: #fff; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-weight: 700;">Đã hiểu ✕</button>
            `;
            warningBanner.querySelector('button').onclick = () => warningBanner.remove();
            document.body.appendChild(warningBanner);
        });
    }

    // Di trú an toàn từ localStorage sang IndexedDB
    async function migrateFromLocalStorage() {
        const db = dbInstance;
        if (!db) return;

        try {
            // 1. Di trú hàng đợi offline
            const legacyQueueStr = localStorage.getItem('wcm_offline_sync_queue');
            if (legacyQueueStr) {
                try {
                    const queue = JSON.parse(legacyQueueStr);
                    if (Array.isArray(queue) && queue.length > 0) {
                        const tx = db.transaction(STORE_QUEUE, 'readwrite');
                        const store = tx.objectStore(STORE_QUEUE);
                        for (const item of queue) {
                            if (item && item.id) {
                                store.put(item);
                            }
                        }
                        console.log(`[WCM_DB] Đã di trú ${queue.length} kiện offline từ localStorage sang IndexedDB.`);
                    }
                } catch (errQ) {
                    console.warn('[WCM_DB] Lỗi parse legacy queue:', errQ);
                }
            }

            // 2. Di trú các key trạng thái quan trọng
            const stateKeys = [
                'wcm_store_dictionary',
                'wcm_import_keys',
                'wcm_export_state',
                'wcm_backup_history',
                'wcm_backup_settings'
            ];

            const txState = db.transaction(STORE_STATE, 'readwrite');
            const stateStore = txState.objectStore(STORE_STATE);
            for (const k of stateKeys) {
                const val = localStorage.getItem(k);
                if (val !== null) {
                    stateStore.put({ key: k, value: val, updatedAt: Date.now() });
                }
            }
        } catch (err) {
            console.warn('[WCM_DB] Lỗi trong quá trình di trú dữ liệu:', err);
        }
    }

    // =========================================================================
    // CRUD CHO HÀNG ĐỢI ĐỒNG BỘ (SYNC QUEUE)
    // =========================================================================

    async function enqueueSyncItem(item) {
        if (!item || !item.id) return;
        const db = await getDB();
        if (!db) {
            const list = getLocalQueueFallback();
            list.push(item);
            saveLocalQueueFallback(list);
            return;
        }

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_QUEUE, 'readwrite');
            const store = tx.objectStore(STORE_QUEUE);
            store.put(item);
            tx.oncomplete = () => {
                mirrorQueueToLocalStorage(db);
                resolve(true);
            };
            tx.onerror = () => {
                const list = getLocalQueueFallback();
                list.push(item);
                saveLocalQueueFallback(list);
                resolve(false);
            };
        });
    }

    async function getSyncQueue() {
        const db = await getDB();
        if (!db) return getLocalQueueFallback();

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_QUEUE, 'readonly');
            const store = tx.objectStore(STORE_QUEUE);
            const request = store.getAll();
            request.onsuccess = () => {
                const items = request.result || [];
                items.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
                resolve(items);
            };
            request.onerror = () => {
                resolve(getLocalQueueFallback());
            };
        });
    }

    async function removeSyncItems(ids) {
        if (!ids || !ids.length) return;
        const db = await getDB();
        if (!db) {
            let list = getLocalQueueFallback();
            const idSet = new Set(ids);
            list = list.filter(item => !idSet.has(item.id));
            saveLocalQueueFallback(list);
            return;
        }

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_QUEUE, 'readwrite');
            const store = tx.objectStore(STORE_QUEUE);
            ids.forEach(id => store.delete(id));
            tx.oncomplete = () => {
                mirrorQueueToLocalStorage(db);
                resolve(true);
            };
            tx.onerror = () => resolve(false);
        });
    }

    async function clearSyncQueue() {
        const db = await getDB();
        if (!db) {
            localStorage.removeItem('wcm_offline_sync_queue');
            return;
        }
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_QUEUE, 'readwrite');
            const store = tx.objectStore(STORE_QUEUE);
            store.clear();
            tx.oncomplete = () => {
                localStorage.removeItem('wcm_offline_sync_queue');
                resolve(true);
            };
            tx.onerror = () => resolve(false);
        });
    }

    function mirrorQueueToLocalStorage(db) {
        try {
            const tx = db.transaction(STORE_QUEUE, 'readonly');
            const store = tx.objectStore(STORE_QUEUE);
            const req = store.getAll();
            req.onsuccess = () => {
                const items = req.result || [];
                localStorage.setItem('wcm_offline_sync_queue', JSON.stringify(items));
            };
        } catch (e) {}
    }

    function getLocalQueueFallback() {
        try {
            const str = localStorage.getItem('wcm_offline_sync_queue');
            return str ? JSON.parse(str) : [];
        } catch (e) {
            return [];
        }
    }

    function saveLocalQueueFallback(list) {
        try {
            localStorage.setItem('wcm_offline_sync_queue', JSON.stringify(list));
        } catch (e) {}
    }

    // =========================================================================
    // CRUD CHO TRẠNG THÁI ỨNG DỤNG (APP STATE)
    // =========================================================================

    async function setAppState(key, value) {
        try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        } catch (e) {}

        const db = await getDB();
        if (!db) return;

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_STATE, 'readwrite');
            const store = tx.objectStore(STORE_STATE);
            store.put({
                key: key,
                value: typeof value === 'string' ? value : JSON.stringify(value),
                updatedAt: Date.now()
            });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    }

    async function getAppState(key, defaultValue = null) {
        const localVal = localStorage.getItem(key);
        if (localVal !== null) {
            try {
                return JSON.parse(localVal);
            } catch (e) {
                return localVal;
            }
        }

        const db = await getDB();
        if (!db) return defaultValue;

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_STATE, 'readonly');
            const store = tx.objectStore(STORE_STATE);
            const req = store.get(key);
            req.onsuccess = () => {
                if (req.result && req.result.value !== undefined) {
                    try {
                        resolve(JSON.parse(req.result.value));
                    } catch (e) {
                        resolve(req.result.value);
                    }
                } else {
                    resolve(defaultValue);
                }
            };
            req.onerror = () => resolve(defaultValue);
        });
    }

    checkIncognitoMode();

    window.WCM_DB = {
        init: getDB,
        enqueueSyncItem,
        getSyncQueue,
        removeSyncItems,
        clearSyncQueue,
        setAppState,
        getAppState,
        checkIncognitoMode
    };

    getDB();
})();
