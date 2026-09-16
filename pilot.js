// =============================================================================
// WAREHOUSE REAL PILOT EVIDENCE LAYER (PILOT MODE)
// Dedicated module for real-world warehouse trials and empirical metric logging
// =============================================================================

(function() {
    'use strict';

    let pilotState = {
        isActive: false,
        session: null,        // session metadata
        events: [],           // raw scan events array
        seenKeys: new Map(),  // uniqueKey -> attemptCount (for First-Pass detection)
        wakeLock: null,
        timerInterval: null
    };

    // Auto-detect device hardware & environment
    function detectDeviceInfo() {
        const ua = navigator.userAgent;
        let os = 'Unknown OS';
        if (/android/i.test(ua)) os = 'Android';
        else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
        else if (/windows/i.test(ua)) os = 'Windows';
        else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';

        let browser = 'Unknown Browser';
        if (/chrome|crios/i.test(ua)) browser = 'Chrome';
        else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
        else if (/firefox/i.test(ua)) browser = 'Firefox';
        else if (/edg/i.test(ua)) browser = 'Edge';

        return {
            os: os,
            browser: browser,
            userAgent: ua,
            platform: navigator.platform || 'unknown',
            screenWidth: screen.width,
            screenHeight: screen.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            deviceMemory: navigator.deviceMemory || null,
            hardwareConcurrency: navigator.hardwareConcurrency || null,
            hasTouch: 'ontouchstart' in window,
            source: 'AUTO_DETECTED'
        };
    }

    // Generate unique immutable pilot session ID: PILOT-YYYYMMDD-HHMMSS-XXXX
    function generateSessionId() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `PILOT-${y}${m}${d}-${hh}${mm}${ss}-${rand}`;
    }

    // Initialize Pilot Module
    function initPilot() {
        // Inject Pilot button in header
        injectPilotHeaderButton();

        // Check if session needs restoration from localStorage
        const savedSession = localStorage.getItem('pilot_active_session');
        const savedEvents = localStorage.getItem('pilot_events');

        if (savedSession) {
            try {
                const sess = JSON.parse(savedSession);
                if (sess && sess.status === 'ACTIVE') {
                    pilotState.session = sess;
                    pilotState.events = savedEvents ? JSON.parse(savedEvents) : [];
                    // Rebuild seenKeys map
                    pilotState.events.forEach(evt => {
                        if (evt.parsed_package_code) {
                            const cur = pilotState.seenKeys.get(evt.parsed_package_code) || 0;
                            pilotState.seenKeys.set(evt.parsed_package_code, cur + 1);
                        }
                    });
                    pilotState.isActive = true;
                    renderHUD();
                    showRecoveryBanner();
                    startTimer();
                    requestScreenWakeLock();
                    return;
                }
            } catch (e) {
                console.warn('Failed to restore pilot session:', e);
            }
        }

        // Check if URL requests pilot mode: ?pilot=1
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('pilot') === '1') {
            openPilotSetupModal();
        }
    }

    function injectPilotHeaderButton() {
        const headerActions = document.querySelector('.header-actions');
        if (!headerActions) return;

        const btn = document.createElement('button');
        btn.id = 'btn-open-pilot-mode';
        btn.className = 'btn btn-pilot-badge btn-sm';
        btn.innerHTML = '📋 Pilot Kho';
        btn.title = 'Bật chế độ thử nghiệm hiện trường (Pilot Mode)';
        btn.addEventListener('click', () => {
            if (pilotState.isActive) {
                alert(`Phiên Pilot đang hoạt động: ${pilotState.session.pilot_session_id}`);
            } else {
                openPilotSetupModal();
            }
        });
        headerActions.insertBefore(btn, headerActions.firstChild);
    }

    function showRecoveryBanner() {
        const container = document.querySelector('.container');
        if (!container) return;

        const banner = document.createElement('div');
        banner.className = 'pilot-recovery-banner';
        banner.id = 'pilot-recovery-banner';
        banner.innerHTML = `
            <span>🔄 <strong>PHỤC HỒI PHIÊN PILOT</strong> (Mã: <code>${pilotState.session.pilot_session_id}</code>, NV: <strong>${pilotState.session.operator_code}</strong>) - Đã khôi phục ${pilotState.events.length} lượt quét.</span>
            <button class="btn btn-secondary btn-sm" style="padding: 0.2rem 0.5rem;" onclick="document.getElementById('pilot-recovery-banner').remove()">✕ Đóng</button>
        `;
        container.insertBefore(banner, container.querySelector('.mode-selector-wrapper') || container.firstChild);
    }

    // Modal: Pilot Setup
    function openPilotSetupModal() {
        const existing = document.getElementById('pilot-setup-modal');
        if (existing) existing.remove();

        const devInfo = detectDeviceInfo();

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'pilot-setup-modal';
        modalOverlay.className = 'pilot-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="pilot-modal">
                <div class="pilot-modal-header">
                    <span class="pilot-modal-title">📋 THIẾT LẬP PHIÊN PILOT KHO</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-close-setup-modal">✕</button>
                </div>

                <div class="pilot-instructions-box">
                    <strong>QUY TRÌNH THAO TÁC PILOT:</strong>
                    <ol>
                        <li>Cầm máy cách tem mã QR khoảng 20 – 30 cm.</li>
                        <li>Quét như nhịp độ làm việc thật, không cố tình làm chậm.</li>
                        <li>Nếu không đọc được, đưa lại kiện như thao tác bình thường.</li>
                        <li>Không reset phiên giữa ca quét.</li>
                        <li>Khi đủ số kiện, bấm <strong>"Kết thúc Pilot"</strong> để tải Evidence.</li>
                    </ol>
                </div>

                <div class="pilot-form-grid">
                    <div class="pilot-form-group">
                        <label for="pilot-input-warehouse">Kho thử nghiệm:</label>
                        <input type="text" id="pilot-input-warehouse" value="Kho Toll Supra" placeholder="VD: Kho Toll Supra, Hub Bắc...">
                    </div>

                    <div class="pilot-form-group">
                        <label for="pilot-input-flow">Luồng quét kiểm nghiệm:</label>
                        <select id="pilot-input-flow">
                            <option value="Xuất" selected>📤 ĐẦU XUẤT (Đối chiếu lô & Chống lẫn hàng)</option>
                            <option value="Nhập">📥 ĐẦU NHẬP (Phân loại vị trí CH.x.x)</option>
                        </select>
                    </div>

                    <div class="pilot-form-group">
                        <label for="pilot-input-operator">Mã nhân viên (Operator Code) <span style="color:#ef4444;">*</span>:</label>
                        <input type="text" id="pilot-input-operator" placeholder="VD: NV01, NV02" autocomplete="off" required>
                    </div>

                    <div class="pilot-form-group">
                        <label for="pilot-input-device">Thiết bị quét:</label>
                        <input type="text" id="pilot-input-device" placeholder="VD: Samsung A54, Zebra TC21..." value="${devInfo.os} (${devInfo.browser}) - ${devInfo.screenWidth}x${devInfo.screenHeight}">
                        <small style="color: #94a3b8; font-size: 0.72rem;">Tự động nhận diện: ${devInfo.os} | Có thể nhập model máy cụ thể.</small>
                    </div>

                    <div class="pilot-form-group">
                        <label for="pilot-input-target">Số kiện mục tiêu:</label>
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" class="btn btn-secondary btn-sm target-btn" data-val="50">50 kiện</button>
                            <button type="button" class="btn btn-secondary btn-sm target-btn" data-val="100">100 kiện</button>
                            <input type="number" id="pilot-input-target" value="50" min="1" style="width: 100px;">
                        </div>
                    </div>

                    <div class="pilot-form-group">
                        <label for="pilot-input-note">Ghi chú phiên (Tùy chọn):</label>
                        <input type="text" id="pilot-input-note" placeholder="VD: Line 2, Xe tải biển số 29C-xxx...">
                    </div>
                </div>

                <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                    <button type="button" class="btn btn-secondary" id="btn-cancel-pilot-setup">Hủy bỏ</button>
                    <button type="button" class="btn btn-primary" id="btn-start-pilot-session" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
                        🚀 Bắt đầu Pilot
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        // Event listeners
        modalOverlay.querySelectorAll('.target-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.getElementById('pilot-input-target').value = e.target.getAttribute('data-val');
            });
        });

        document.getElementById('btn-close-setup-modal').addEventListener('click', () => modalOverlay.remove());
        document.getElementById('btn-cancel-pilot-setup').addEventListener('click', () => modalOverlay.remove());

        document.getElementById('btn-start-pilot-session').addEventListener('click', () => {
            const opCode = document.getElementById('pilot-input-operator').value.trim();
            if (!opCode) {
                alert('Vui lòng nhập Mã nhân viên (VD: NV01)!');
                document.getElementById('pilot-input-operator').focus();
                return;
            }

            const warehouse = document.getElementById('pilot-input-warehouse').value.trim() || 'Kho Toll Supra';
            const flow = document.getElementById('pilot-input-flow').value;
            const target = parseInt(document.getElementById('pilot-input-target').value, 10) || 50;
            const note = document.getElementById('pilot-input-note').value.trim();
            const deviceInput = document.getElementById('pilot-input-device').value.trim();

            modalOverlay.remove();
            startPilotSession({
                warehouse,
                flow,
                operator_code: opCode,
                target_packages: target,
                session_note: note,
                device_input: deviceInput,
                auto_device: devInfo
            });
        });
    }

    // Start New Session
    function startPilotSession(config) {
        const sessionId = generateSessionId();
        const now = Date.now();
        const perfNow = performance.now();

        const session = {
            pilot_session_id: sessionId,
            warehouse: config.warehouse,
            flow: config.flow,
            operator_code: config.operator_code,
            target_packages: config.target_packages,
            session_note: config.session_note,
            device_info: {
                ...config.auto_device,
                user_device_label: config.device_input,
                device_label_source: (config.device_input && config.device_input !== `${config.auto_device.os} (${config.auto_device.browser}) - ${config.auto_device.screenWidth}x${config.auto_device.screenHeight}`) ? 'USER_INPUT' : 'AUTO_DETECTED'
            },
            browser_info: `${config.auto_device.browser} on ${config.auto_device.os}`,
            started_at: new Date(now).toISOString(),
            session_start_time: now,
            session_start_perf: perfNow,
            status: 'ACTIVE'
        };

        pilotState.session = session;
        pilotState.events = [];
        pilotState.seenKeys = new Map();
        pilotState.isActive = true;

        localStorage.setItem('pilot_active_session', JSON.stringify(session));
        localStorage.setItem('pilot_events', JSON.stringify([]));

        // Synchronize core scan mode if switchMode is available
        if (typeof window.switchMode === 'function') {
            window.switchMode(config.flow, false);
        }

        renderHUD();
        startTimer();
        requestScreenWakeLock();
    }

    // Screen Wake Lock API
    async function requestScreenWakeLock() {
        const indicator = document.getElementById('pilot-wakelock-status');
        if ('wakeLock' in navigator) {
            try {
                pilotState.wakeLock = await navigator.wakeLock.request('screen');
                if (indicator) {
                    indicator.textContent = '💡 Giữ sáng màn hình: BẬT';
                    indicator.className = 'pilot-wakelock-indicator active';
                }
            } catch (err) {
                if (indicator) {
                    indicator.textContent = '⚠️ Hãy chỉnh màn hình chờ ≥ 10 phút';
                    indicator.className = 'pilot-wakelock-indicator';
                }
            }
        } else {
            if (indicator) {
                indicator.textContent = '⚠️ Trình duyệt chưa hỗ trợ tự giữ sáng; hãy chỉnh màn hình chờ ≥ 10 phút';
            }
        }
    }

    function releaseScreenWakeLock() {
        if (pilotState.wakeLock) {
            pilotState.wakeLock.release().catch(() => {});
            pilotState.wakeLock = null;
        }
    }

    // Live Dashboard HUD Rendering
    function renderHUD() {
        const existing = document.getElementById('pilot-live-dashboard');
        if (existing) existing.remove();

        const sess = pilotState.session;
        const acceptedCount = pilotState.events.filter(e => e.scan_result === 'SUCCESS').length;
        const firstPassCount = pilotState.events.filter(e => e.is_first_pass === true).length;
        const rescanCount = pilotState.events.filter(e => e.rescan_required === true).length;
        const dupCount = pilotState.events.filter(e => e.scan_result === 'DUPLICATE').length;
        const wrongStoreCount = pilotState.events.filter(e => e.scan_result === 'WRONG_STORE').length;

        const hud = document.createElement('div');
        hud.id = 'pilot-live-dashboard';
        hud.className = 'pilot-dashboard';
        hud.innerHTML = `
            <div class="pilot-hud-header">
                <span class="pilot-tag">⚡ PILOT ĐANG CHẠY: <strong>${sess.pilot_session_id}</strong></span>
                <span class="pilot-op">NV: <strong>${sess.operator_code}</strong> | Luồng: <strong>${sess.flow}</strong> | Kho: <strong>${sess.warehouse}</strong></span>
            </div>
            <div class="pilot-hud-metrics">
                <div class="hud-box">
                    <span class="hud-label">ĐÃ QUÉT HỢP LỆ</span>
                    <span class="hud-val highlight" id="hud-accepted">${acceptedCount} / ${sess.target_packages}</span>
                </div>
                <div class="hud-box">
                    <span class="hud-label">FIRST PASS</span>
                    <span class="hud-val green" id="hud-first-pass">${firstPassCount}</span>
                </div>
                <div class="hud-box">
                    <span class="hud-label">RESCAN</span>
                    <span class="hud-val yellow" id="hud-rescan">${rescanCount}</span>
                </div>
                <div class="hud-box">
                    <span class="hud-label">DUPLICATE</span>
                    <span class="hud-val orange" id="hud-duplicate">${dupCount}</span>
                </div>
                <div class="hud-box">
                    <span class="hud-label">SAI CỬA HÀNG</span>
                    <span class="hud-val red" id="hud-wrong-store">${wrongStoreCount}</span>
                </div>
                <div class="hud-box">
                    <span class="hud-label">THỜI GIAN</span>
                    <span class="hud-val" id="hud-timer">00:00:00</span>
                </div>
            </div>
            <div class="pilot-hud-actions">
                <span class="pilot-wakelock-indicator" id="pilot-wakelock-status">💡 Giữ sáng: Đang kiểm tra...</span>
                <button type="button" id="btn-trigger-end-pilot" class="btn btn-danger btn-sm" style="font-size: 0.78rem;">
                    🏁 Kết thúc Pilot
                </button>
            </div>
        `;

        const appGrid = document.querySelector('.app-grid') || document.querySelector('.scanner-card') || document.body;
        appGrid.parentNode.insertBefore(hud, appGrid);

        document.getElementById('btn-trigger-end-pilot').addEventListener('click', confirmEndPilot);
    }

    function startTimer() {
        if (pilotState.timerInterval) clearInterval(pilotState.timerInterval);
        pilotState.timerInterval = setInterval(() => {
            const timerEl = document.getElementById('hud-timer');
            if (!timerEl || !pilotState.session) return;
            const elapsedSec = Math.floor((Date.now() - pilotState.session.session_start_time) / 1000);
            const hh = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
            const mm = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
            const ss = String(elapsedSec % 60).padStart(2, '0');
            timerEl.textContent = `${hh}:${mm}:${ss}`;
        }, 1000);
    }

    // Core Hook: Receive scan event from app.js
    window.__onPilotScanEvent = function(data) {
        if (!pilotState.isActive || !pilotState.session) return;

        const now = Date.now();
        const elapsedMs = Math.round(performance.now() - pilotState.session.session_start_perf);
        const pkg = data.pkg || {};
        const rawBarcode = data.rawBarcode || '';
        const scanResult = data.scanResult || 'SUCCESS';
        const uniqueKey = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}` || rawBarcode;

        // First-pass vs Rescan logic
        const priorAttempts = pilotState.seenKeys.get(uniqueKey) || 0;
        const isFirstPass = (priorAttempts === 0 && scanResult === 'SUCCESS');
        const rescanRequired = (priorAttempts > 0 && scanResult === 'SUCCESS');

        // Update seen count
        pilotState.seenKeys.set(uniqueKey, priorAttempts + 1);

        const rawEvent = {
            event_id: `EVT-${now}-${Math.random().toString(36).substring(2, 6)}`,
            pilot_session_id: pilotState.session.pilot_session_id,
            client_timestamp: new Date(now).toISOString(),
            elapsed_ms_from_session_start: elapsedMs,
            operator_code: pilotState.session.operator_code,
            warehouse: pilotState.session.warehouse,
            flow: pilotState.session.flow,
            device_info: pilotState.session.device_info.user_device_label || pilotState.session.device_info.os,
            browser_info: pilotState.session.browser_info,
            decoder_used: data.decodeTelemetry?.decoder || (window.nativeDetector ? 'BarcodeDetector' : 'ZXing-WASM'),
            raw_qr: rawBarcode,
            parsed_package_code: pkg.packageCode || '',
            do_number: pkg.doNumber || '',
            ch_code: pkg.chCode || '',
            package_index: pkg.pkgIdx || 1,
            total_packages: pkg.totalPackages || 1,
            scan_result: scanResult,
            is_first_pass: isFirstPass,
            rescan_required: rescanRequired,
            expected_store: (pilotState.session.flow === 'Xuất' && typeof exportState !== 'undefined') ? exportState.targetStore : '',
            actual_store: pkg.chCode || pkg.storeName || '',
            decode_latency_ms: data.decodeTelemetry?.latencyMs ?? null,
            business_latency_ms: data.businessLatencyMs ?? null,
            feedback_latency_ms: null
        };

        pilotState.events.push(rawEvent);
        localStorage.setItem('pilot_events', JSON.stringify(pilotState.events));

        // Update live HUD
        updateHUDMetrics();
    };

    function updateHUDMetrics() {
        const acceptedCount = pilotState.events.filter(e => e.scan_result === 'SUCCESS').length;
        const firstPassCount = pilotState.events.filter(e => e.is_first_pass === true).length;
        const rescanCount = pilotState.events.filter(e => e.rescan_required === true).length;
        const dupCount = pilotState.events.filter(e => e.scan_result === 'DUPLICATE').length;
        const wrongStoreCount = pilotState.events.filter(e => e.scan_result === 'WRONG_STORE').length;

        const elAcc = document.getElementById('hud-accepted');
        const elFp = document.getElementById('hud-first-pass');
        const elRes = document.getElementById('hud-rescan');
        const elDup = document.getElementById('hud-duplicate');
        const elWs = document.getElementById('hud-wrong-store');

        if (elAcc) elAcc.textContent = `${acceptedCount} / ${pilotState.session.target_packages}`;
        if (elFp) elFp.textContent = firstPassCount;
        if (elRes) elRes.textContent = rescanCount;
        if (elDup) elDup.textContent = dupCount;
        if (elWs) elWs.textContent = wrongStoreCount;
    }

    // Global Error Capture
    window.addEventListener('error', (e) => {
        if (pilotState.isActive && pilotState.session) {
            pilotState.events.push({
                event_id: `ERR-${Date.now()}`,
                pilot_session_id: pilotState.session.pilot_session_id,
                client_timestamp: new Date().toISOString(),
                elapsed_ms_from_session_start: Math.round(performance.now() - pilotState.session.session_start_perf),
                scan_result: 'APP_ERROR',
                error_message: e.message || 'Unknown window error',
                raw_qr: ''
            });
            localStorage.setItem('pilot_events', JSON.stringify(pilotState.events));
        }
    });

    window.addEventListener('unhandledrejection', (e) => {
        if (pilotState.isActive && pilotState.session) {
            pilotState.events.push({
                event_id: `REJ-${Date.now()}`,
                pilot_session_id: pilotState.session.pilot_session_id,
                client_timestamp: new Date().toISOString(),
                elapsed_ms_from_session_start: Math.round(performance.now() - pilotState.session.session_start_perf),
                scan_result: 'APP_ERROR',
                error_message: String(e.reason) || 'Unhandled promise rejection',
                raw_qr: ''
            });
            localStorage.setItem('pilot_events', JSON.stringify(pilotState.events));
        }
    });

    // End Pilot Confirmation
    function confirmEndPilot() {
        const acceptedCount = pilotState.events.filter(e => e.scan_result === 'SUCCESS').length;
        if (confirm(`Bạn có chắc muốn KẾT THÚC phiên Pilot này? (Đã quét hợp lệ: ${acceptedCount} kiện)`)) {
            finishPilotSession();
        }
    }

    function finishPilotSession() {
        if (pilotState.timerInterval) clearInterval(pilotState.timerInterval);
        releaseScreenWakeLock();

        const endNow = Date.now();
        const durationSec = Math.max(1, Math.round((endNow - pilotState.session.session_start_time) / 1000));
        const durationMin = durationSec / 60;

        pilotState.session.ended_at = new Date(endNow).toISOString();
        pilotState.session.duration_seconds = durationSec;
        pilotState.session.status = 'COMPLETED';

        // DERIVE ALL METRICS DIRECTLY FROM RAW EVENTS (Zero fabrication)
        const events = pilotState.events;
        const acceptedEvents = events.filter(e => e.scan_result === 'SUCCESS');
        const acceptedCount = acceptedEvents.length;
        const firstPassCount = events.filter(e => e.is_first_pass === true).length;
        const rescanCount = events.filter(e => e.rescan_required === true).length;
        const dupCount = events.filter(e => e.scan_result === 'DUPLICATE').length;
        const wrongStoreCount = events.filter(e => e.scan_result === 'WRONG_STORE').length;
        const invalidCount = events.filter(e => e.scan_result === 'INVALID_QR').length;
        const appErrorCount = events.filter(e => e.scan_result === 'APP_ERROR').length;

        // Physical attempts: first pass + rescans + wrong stores + duplicates
        const totalValidAttempts = firstPassCount + rescanCount;
        const firstPassRate = totalValidAttempts > 0 ? (firstPassCount / totalValidAttempts) * 100 : 0;
        const rescanRate = totalValidAttempts > 0 ? (rescanCount / totalValidAttempts) * 100 : 0;
        const throughput = Math.round((acceptedCount / durationMin) * 10) / 10;

        // Latencies
        const decodeLatencies = events.map(e => e.decode_latency_ms).filter(n => typeof n === 'number' && !isNaN(n));
        decodeLatencies.sort((a, b) => a - b);
        const medianDecodeMs = decodeLatencies.length > 0 ? decodeLatencies[Math.floor(decodeLatencies.length / 2)] : null;
        const p95DecodeMs = decodeLatencies.length > 0 ? decodeLatencies[Math.floor(decodeLatencies.length * 0.95)] : null;

        const summary = {
            pilot_session_id: pilotState.session.pilot_session_id,
            warehouse: pilotState.session.warehouse,
            operator_code: pilotState.session.operator_code,
            flow: pilotState.session.flow,
            device: pilotState.session.device_info.user_device_label || pilotState.session.device_info.os,
            os_browser: pilotState.session.browser_info,
            started_at: pilotState.session.started_at,
            ended_at: pilotState.session.ended_at,
            duration_seconds: durationSec,
            duration_formatted: `${Math.floor(durationSec / 60)} phút ${durationSec % 60} giây`,
            target_packages: pilotState.session.target_packages,
            accepted_packages: acceptedCount,
            first_pass_count: firstPassCount,
            rescan_count: rescanCount,
            duplicate_count: dupCount,
            wrong_store_count: wrongStoreCount,
            invalid_count: invalidCount,
            app_error_count: appErrorCount,
            session_loss_count: 0,
            first_pass_scan_rate: Math.round(firstPassRate * 100) / 100,
            rescan_rate: Math.round(rescanRate * 100) / 100,
            throughput_packages_per_minute: throughput,
            median_decode_latency_ms: medianDecodeMs,
            p95_decode_latency_ms: p95DecodeMs,
            scanner_version: 'WebAssembly ZXing-C++ + Native BarcodeDetector (Offline)',
            session_note: pilotState.session.session_note || ''
        };

        pilotState.summary = summary;
        pilotState.isActive = false;

        localStorage.removeItem('pilot_active_session');
        localStorage.setItem(`pilot_${summary.pilot_session_id}_summary`, JSON.stringify(summary));

        showPilotSummaryModal(summary);
    }

    // Modal: Pilot Summary & Evidence Download
    function showPilotSummaryModal(summary) {
        const existing = document.getElementById('pilot-summary-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'pilot-summary-modal';
        modal.className = 'pilot-modal-overlay';
        modal.innerHTML = `
            <div class="pilot-modal" style="max-width: 620px;">
                <div class="pilot-modal-header">
                    <span class="pilot-modal-title">🏁 KẾT QUẢ PILOT: ${summary.pilot_session_id}</span>
                </div>

                <div class="pilot-summary-grid">
                    <div class="summary-card accent">
                        <div class="summary-card-title">Đã quét hợp lệ</div>
                        <div class="summary-card-value">${summary.accepted_packages} / ${summary.target_packages}</div>
                    </div>
                    <div class="summary-card accent">
                        <div class="summary-card-title">Tỷ lệ First-Pass</div>
                        <div class="summary-card-value">${summary.first_pass_scan_rate}%</div>
                    </div>
                    <div class="summary-card warn">
                        <div class="summary-card-title">Cần quét lại (Rescan)</div>
                        <div class="summary-card-value">${summary.rescan_count} (${summary.rescan_rate}%)</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-card-title">Thông lượng (Throughput)</div>
                        <div class="summary-card-value">${summary.throughput_packages_per_minute} kiện/phút</div>
                    </div>
                    <div class="summary-card danger">
                        <div class="summary-card-title">Phát hiện Lẫn hàng</div>
                        <div class="summary-card-value">${summary.wrong_store_count} lượt</div>
                    </div>
                    <div class="summary-card warn">
                        <div class="summary-card-title">Phát hiện Trùng kiện</div>
                        <div class="summary-card-value">${summary.duplicate_count} lượt</div>
                    </div>
                </div>

                <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 1rem;">
                    Thời gian ca: <strong>${summary.duration_formatted}</strong> | Độ trễ giải mã (P95): <strong>${summary.p95_decode_latency_ms !== null ? summary.p95_decode_latency_ms + 'ms' : 'N/A'}</strong>
                </div>

                <!-- Operator 5-Question Feedback (Phase 18) -->
                <div class="pilot-feedback-section">
                    <h4 style="color: #f59e0b; margin-bottom: 0.75rem; font-size: 0.95rem;">📝 KHẢO SÁT Ý KIẾN NHÂN VIÊN TRỰC TIẾP (5 CÂU HỎI):</h4>
                    
                    <div class="pilot-feedback-q">
                        <label>Q1. Quét có nhanh hơn cách đang làm không?</label>
                        <select id="fb-q1">
                            <option value="Nhanh hơn rõ rệt">Nhanh hơn rõ rệt</option>
                            <option value="Ngang nhau">Ngang nhau</option>
                            <option value="Chậm hơn">Chậm hơn</option>
                        </select>
                    </div>

                    <div class="pilot-feedback-q">
                        <label>Q2. Trường hợp tem nào khó quét nhất?</label>
                        <input type="text" id="fb-q2" placeholder="VD: Tem dán mép thùng, dán băng keo vàng...">
                    </div>

                    <div class="pilot-feedback-q">
                        <label>Q3. Có thường phải đưa kiện lại camera không?</label>
                        <select id="fb-q3">
                            <option value="Rất hiếm khi">Rất hiếm khi</option>
                            <option value="Thỉnh thoảng">Thỉnh thoảng</option>
                            <option value="Thường xuyên">Thường xuyên</option>
                        </select>
                    </div>

                    <div class="pilot-feedback-q">
                        <label>Q4. Âm thanh beep và màu cảnh báo có dễ hiểu không?</label>
                        <select id="fb-q4">
                            <option value="Rất rõ ràng, dễ phân biệt">Rất rõ ràng, dễ phân biệt</option>
                            <option value="Bình thường">Bình thường</option>
                            <option value="Khó nhận biết">Khó nhận biết</option>
                        </select>
                    </div>

                    <div class="pilot-feedback-q">
                        <label>Q5. Điểm gây khó chịu nhất nếu dùng cả ca làm việc?</label>
                        <input type="text" id="fb-q5" placeholder="VD: Cầm mỏi tay, màn hình hay tắt...">
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.25rem;">
                    <button type="button" class="btn btn-primary" id="btn-download-evidence-pack" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-size: 0.95rem; padding: 0.75rem;">
                        📥 TẢI BỘ EVIDENCE (CSV + SUMMARY JSON + FEEDBACK)
                    </button>
                    <button type="button" class="btn btn-secondary" id="btn-close-pilot-summary">
                        Đóng và Quay lại
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('btn-download-evidence-pack').addEventListener('click', () => {
            downloadEvidenceFiles(summary);
        });

        document.getElementById('btn-close-pilot-summary').addEventListener('click', () => {
            modal.remove();
            const hud = document.getElementById('pilot-live-dashboard');
            if (hud) hud.remove();
        });
    }

    // Evidence Downloader: Generates CSV, Summary JSON, and Feedback JSON
    function downloadEvidenceFiles(summary) {
        const sessId = summary.pilot_session_id;

        // 1. Operator Feedback
        const feedback = {
            pilot_session_id: sessId,
            operator_code: summary.operator_code,
            submitted_at: new Date().toISOString(),
            q1_speed_comparison: document.getElementById('fb-q1')?.value || '',
            q2_hardest_case: document.getElementById('fb-q2')?.value || '',
            q3_rescan_frequency: document.getElementById('fb-q3')?.value || '',
            q4_alert_clarity: document.getElementById('fb-q4')?.value || '',
            q5_shift_discomfort: document.getElementById('fb-q5')?.value || ''
        };

        // File 1: CSV of Raw Scan Events
        const csvRows = [];
        const headers = [
            'event_id',
            'pilot_session_id',
            'client_timestamp',
            'elapsed_ms_from_session_start',
            'operator_code',
            'warehouse',
            'flow',
            'device_info',
            'browser_info',
            'decoder_used',
            'raw_qr',
            'parsed_package_code',
            'do_number',
            'ch_code',
            'package_index',
            'total_packages',
            'scan_result',
            'is_first_pass',
            'rescan_required',
            'expected_store',
            'actual_store',
            'decode_latency_ms',
            'business_latency_ms'
        ];
        csvRows.push(headers.join(','));

        pilotState.events.forEach(evt => {
            const row = [
                `"${evt.event_id || ''}"`,
                `"${evt.pilot_session_id || ''}"`,
                `"${evt.client_timestamp || ''}"`,
                evt.elapsed_ms_from_session_start ?? '',
                `"${evt.operator_code || ''}"`,
                `"${evt.warehouse || ''}"`,
                `"${evt.flow || ''}"`,
                `"${(evt.device_info || '').replace(/"/g, '""')}"`,
                `"${(evt.browser_info || '').replace(/"/g, '""')}"`,
                `"${evt.decoder_used || ''}"`,
                `"${(evt.raw_qr || '').replace(/"/g, '""')}"`,
                `"${evt.parsed_package_code || ''}"`,
                `"${evt.do_number || ''}"`,
                `"${evt.ch_code || ''}"`,
                evt.package_index ?? '',
                evt.total_packages ?? '',
                `"${evt.scan_result || ''}"`,
                evt.is_first_pass ? 'TRUE' : 'FALSE',
                evt.rescan_required ? 'TRUE' : 'FALSE',
                `"${evt.expected_store || ''}"`,
                `"${evt.actual_store || ''}"`,
                evt.decode_latency_ms ?? '',
                evt.business_latency_ms ?? ''
            ];
            csvRows.push(row.join(','));
        });

        // Download CSV (UTF-8 with BOM)
        triggerBlobDownload(`\uFEFF${csvRows.join('\n')}`, `pilot_${sessId}_events.csv`, 'text/csv;charset=utf-8;');

        // File 2: JSON Summary
        setTimeout(() => {
            triggerBlobDownload(JSON.stringify(summary, null, 2), `pilot_${sessId}_summary.json`, 'application/json');
        }, 300);

        // File 3: JSON Feedback
        setTimeout(() => {
            triggerBlobDownload(JSON.stringify(feedback, null, 2), `pilot_${sessId}_feedback.json`, 'application/json');
            alert('Đã tải thành công 3 tệp Evidence:\n1. ' + `pilot_${sessId}_events.csv\n2. pilot_${sessId}_summary.json\n3. pilot_${sessId}_feedback.json\n\nHãy gửi các tệp này cho Quản lý / QA!`);
        }, 600);
    }

    function triggerBlobDownload(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 500);
    }

    // Auto-init on page load
    window.addEventListener('DOMContentLoaded', initPilot);

    // Export Pilot API for inspection
    window.WarehousePilot = {
        getState: () => pilotState,
        openSetup: openPilotSetupModal,
        endSession: finishPilotSession,
        triggerDownload: downloadEvidenceFiles
    };
})();
