// =============================================================================
// WCM SMART SCAN - SERVICE WORKER (OFFLINE PWA ENGINE)
// Hỗ trợ cài đặt màn hình chính (Add to Home Screen), khởi động tức thì,
// hoạt động ngoại tuyến 100% không cần kết nối mạng.
// =============================================================================

const CACHE_NAME = 'wcm-smart-scan-v1.14';

const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './pilot.css',
    './config.js',
    './db.js',
    './auth.js',
    './online_sync.js',
    './data-adapter.js',
    './app.js',
    './onboarding.js',
    './pilot.js',
    './stores_data.json',
    './zxing-wasm.js',
    './zxing_reader.wasm',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg'
];

// Install: Precache tất cả tài nguyên tĩnh
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Đang nạp sẵn tài nguyên offline...');
            // addAll với fallback mềm nếu 1 file ảnh phụ chưa sẵn sàng
            return Promise.allSettled(
                STATIC_ASSETS.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn(`[ServiceWorker] Không thể cache asset: ${url}`, err);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// Activate: Dọn dẹp cache phiên bản cũ & claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[ServiceWorker] Xóa cache cũ:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Strategy:
// - API calls (Google Script, Google OAuth, Tokeninfo): Network Only (không lưu cache dữ liệu động)
// - Static assets (JS, CSS, HTML, WASM, Fonts): Stale-While-Revalidate (hoặc Cache First)
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Bỏ qua POST requests hoặc các request chrome-extension
    if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
        return;
    }

    // Network-Only đối với API Google Sheets & Google OAuth
    if (url.hostname.includes('script.google.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('accounts.google.com')) {
        event.respondWith(
            fetch(request).catch(() => {
                return new Response(JSON.stringify({
                    status: 'OFFLINE',
                    message: 'Mất kết nối mạng. Dữ liệu đang được lưu tạm trên máy.'
                }), {
                    headers: { 'Content-Type': 'application/json;charset=utf-8' }
                });
            })
        );
        return;
    }

    // Stale-While-Revalidate cho toàn bộ tài nguyên app
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Mất mạng và không có cache -> Trả về index.html nếu là request điều hướng
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return cachedResponse;
            });

            return cachedResponse || fetchPromise;
        })
    );
});

// Lắng nghe lệnh cập nhật từ giao diện
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
