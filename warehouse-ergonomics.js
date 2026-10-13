// =============================================================================
// WCM SMART SCAN - WAREHOUSE ERGONOMICS & HARDWARE CONTROLLER
// Triển khai theo chuẩn Agency-Agents:
// 1. Mobile App Builder: Screen WakeLock API (Chống tắt màn hình khi đeo găng tay)
// 2. Mobile App Builder: Chế độ PDA / Súng Laser (Chuyển đổi nhanh khóa/mở bàn phím ảo)
// 3. UX Architect: High-Contrast Outdoor / Sunlight Mode (Giao diện Sáng rõ ngoài bãi xe)
// 4. UX Architect: Floating Thumb-Zone Quick Undo Bar (Hoàn tác 1 chạm bằng ngón cái)
// =============================================================================

(function() {
    'use strict';

    const STORAGE_KEY_THEME = 'wcm_theme_mode';
    const STORAGE_KEY_WAKELOCK = 'wcm_wakelock_enabled';
    const STORAGE_KEY_PDA_LOCK = 'wcm_pda_keyboard_locked';

    // =========================================================================
    // 1. SCREEN WAKELOCK MANAGER (Giữ màn hình luôn sáng trong ca quét)
    // =========================================================================
    let wakeLockSentinel = null;
    let isWakeLockEnabled = localStorage.getItem(STORAGE_KEY_WAKELOCK) !== 'false'; // Mặc định BẬT

    async function requestWakeLock() {
        if (!isWakeLockEnabled) return false;
        if (!('wakeLock' in navigator)) {
            updateWakeLockUI(false, false);
            return false;
        }
        try {
            if (wakeLockSentinel && !wakeLockSentinel.released) {
                updateWakeLockUI(true, true);
                return true;
            }
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            wakeLockSentinel.addEventListener('release', () => {
                updateWakeLockUI(isWakeLockEnabled, false);
            });
            updateWakeLockUI(true, true);
            return true;
        } catch (err) {
            // Có thể bị từ chối nếu trang chưa có tương tác người dùng hoặc pin yếu
            updateWakeLockUI(isWakeLockEnabled, false);
            return false;
        }
    }

    async function releaseWakeLock() {
        try {
            if (wakeLockSentinel) {
                await wakeLockSentinel.release();
                wakeLockSentinel = null;
            }
        } catch (e) {}
        updateWakeLockUI(false, false);
    }

    async function toggleWakeLock(forceState) {
        isWakeLockEnabled = typeof forceState === 'boolean' ? forceState : !isWakeLockEnabled;
        localStorage.setItem(STORAGE_KEY_WAKELOCK, isWakeLockEnabled ? 'true' : 'false');
        if (isWakeLockEnabled) {
            const ok = await requestWakeLock();
            if (typeof window.showToast === 'function') {
                window.showToast(ok ? '🔆 Đã bật Giữ sáng màn hình liên tục khi bốc hàng' : '🔆 Đã bật chế độ Giữ sáng màn hình');
            }
        } else {
            await releaseWakeLock();
            if (typeof window.showToast === 'function') {
                window.showToast('🌙 Đã tắt giữ sáng màn hình tự động');
            }
        }
    }

    function updateWakeLockUI(enabled, activeLock) {
        const btn = document.getElementById('btn-toggle-wakelock');
        const chk = document.getElementById('chk-wakelock');
        if (chk) chk.checked = Boolean(enabled);
        if (!btn) return;
        if (enabled) {
            btn.classList.add('ergo-pill-active');
            btn.innerHTML = activeLock ? '🔆 Màn hình: Luôn sáng' : '🔆 Giữ sáng: Bật';
            btn.title = 'Đang khóa sáng màn hình để không bị tắt khi đeo găng tay bốc hàng. Bấm để tắt.';
        } else {
            btn.classList.remove('ergo-pill-active');
            btn.innerHTML = '🌑 Giữ sáng: Tắt';
            btn.title = 'Màn hình sẽ tự tắt theo cài đặt điện thoại. Bấm để giữ sáng liên tục.';
        }
    }

    // Tự động xin lại WakeLock khi người dùng quay lại tab hoặc chạm vào màn hình lần đầu
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isWakeLockEnabled) {
            requestWakeLock();
        }
    });

    document.addEventListener('pointerdown', function onFirstTap() {
        if (isWakeLockEnabled && (!wakeLockSentinel || wakeLockSentinel.released)) {
            requestWakeLock();
        }
    }, { passive: true });

    // =========================================================================
    // 2. OUTDOOR / SUNLIGHT HIGH-CONTRAST THEME MANAGER (Ngoài trời vs Trong kho)
    // =========================================================================
    let currentTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'dark';

    function applyTheme(theme) {
        currentTheme = (theme === 'light') ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY_THEME, currentTheme);

        if (currentTheme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            document.body.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
            document.body.removeAttribute('data-theme');
        }

        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute('content', currentTheme === 'light' ? '#ffffff' : '#00A19A');
        }

        const btnTheme = document.getElementById('btn-toggle-theme');
        if (btnTheme) {
            if (currentTheme === 'light') {
                btnTheme.innerHTML = '☀️ Ngoài Trời (Sáng)';
                btnTheme.classList.add('ergo-pill-sunlight');
                btnTheme.title = 'Đang ở chế độ Tương phản cao ngoài trời nắng. Bấm để chuyển về nền tối.';
            } else {
                btnTheme.innerHTML = '🌙 Trong Kho (Tối)';
                btnTheme.classList.remove('ergo-pill-sunlight');
                btnTheme.title = 'Đang ở chế độ Trong kho (Tiết kiệm pin). Bấm để bật chế độ Ngoài trời nắng gắt.';
            }
        }
    }

    function toggleTheme() {
        const next = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(next);
        if (typeof window.showToast === 'function') {
            window.showToast(
                next === 'light'
                    ? '☀️ Đã bật giao diện NGOÀI TRỜI (Chữ đậm chống chói nắng bãi xe)'
                    : '🌙 Đã bật giao diện TRONG KHO (Nền tối dịu mắt & tiết kiệm pin)'
            );
        }
    }

    // Apply saved theme immediately to prevent flash
    applyTheme(currentTheme);

    // =========================================================================
    // 3. PDA LASER / VIRTUAL KEYBOARD CONTROLLER (`inputmode="none"` vs `"text"`)
    // =========================================================================
    let isPdaKeyboardLocked = localStorage.getItem(STORAGE_KEY_PDA_LOCK) !== 'false'; // Mặc định KHÓA phím ảo cho PDA

    function applyPdaKeyboardMode(locked, focusInput = false) {
        isPdaKeyboardLocked = Boolean(locked);
        localStorage.setItem(STORAGE_KEY_PDA_LOCK, isPdaKeyboardLocked ? 'true' : 'false');

        const scanInput = document.getElementById('manual-scan-input');
        const btnToggleKb = document.getElementById('btn-toggle-virtual-kb');
        const hintEl = document.getElementById('pda-keyboard-hint-text');

        if (scanInput) {
            if (isPdaKeyboardLocked) {
                scanInput.setAttribute('inputmode', 'none');
                scanInput.placeholder = 'Bóp cò PDA / Súng Laser để quét mã kiện...';
            } else {
                scanInput.setAttribute('inputmode', 'text');
                scanInput.placeholder = 'Gõ tay mã kiện / số DO bằng bàn phím...';
            }
            if (focusInput) {
                scanInput.blur();
                setTimeout(() => scanInput.focus(), 40);
            }
        }

        if (btnToggleKb) {
            if (isPdaKeyboardLocked) {
                btnToggleKb.innerHTML = '⌨️ Bật phím gõ tay';
                btnToggleKb.className = 'btn btn-secondary btn-kb-toggle';
                btnToggleKb.title = 'Đang khóa bàn phím ảo để bắn PDA không bị che màn hình. Bấm vào đây nếu cần gõ tay mã rách.';
            } else {
                btnToggleKb.innerHTML = '🔫 Khóa phím ảo (PDA)';
                btnToggleKb.className = 'btn btn-primary btn-kb-toggle active-kb';
                btnToggleKb.title = 'Đang mở bàn phím ảo để gõ tay. Bấm để khóa lại khi dùng cò súng PDA.';
            }
        }

        if (hintEl) {
            hintEl.innerHTML = isPdaKeyboardLocked
                ? '💡 <strong>Chế độ PDA:</strong> Đã khóa bàn phím ảo chống che màn hình. Bấm <strong>"⌨️ Bật phím gõ tay"</strong> nếu tem bị rách cần nhập số DO.'
                : '⌨️ <strong>Chế độ Gõ tay:</strong> Bàn phím ảo đang mở để nhập mã thủ công. Bấm <strong>"🔫 Khóa phím ảo (PDA)"</strong> khi quay lại bắn súng.';
        }
    }

    function toggleVirtualKeyboard() {
        applyPdaKeyboardMode(!isPdaKeyboardLocked, true);
    }

    // =========================================================================
    // 4. FLOATING THUMB-ZONE QUICK UNDO BAR (Hoàn tác 1 chạm trong 8 giây)
    // =========================================================================
    let quickUndoTimer = null;

    function ensureQuickUndoBarElement() {
        let bar = document.getElementById('wcm-thumb-quick-undo-bar');
        if (bar) return bar;

        bar = document.createElement('div');
        bar.id = 'wcm-thumb-quick-undo-bar';
        bar.className = 'thumb-quick-undo-bar';
        bar.style.display = 'none';
        bar.innerHTML = `
            <div class="thumb-undo-info">
                <span class="thumb-undo-badge">VỪA BẮN</span>
                <div class="thumb-undo-text-wrap">
                    <strong id="thumb-undo-pkg-code">-</strong>
                    <span id="thumb-undo-store-label">-</span>
                </div>
            </div>
            <div class="thumb-undo-actions">
                <button type="button" id="btn-thumb-quick-undo" class="btn-thumb-undo">
                    ↩️ HOÀN TÁC NGAY
                </button>
                <button type="button" id="btn-thumb-dismiss-undo" class="btn-thumb-dismiss" title="Ẩn thanh này">✕</button>
            </div>
        `;
        document.body.appendChild(bar);

        const btnUndo = bar.querySelector('#btn-thumb-quick-undo');
        const btnDismiss = bar.querySelector('#btn-thumb-dismiss-undo');

        if (btnUndo) {
            btnUndo.addEventListener('click', () => {
                hideQuickUndoBar();
                if (typeof window.quickUndoLastScanNoConfirm === 'function') {
                    window.quickUndoLastScanNoConfirm();
                } else {
                    const existingUndoBtn = document.getElementById('btn-undo-last-scan');
                    if (existingUndoBtn) existingUndoBtn.click();
                }
            });
        }
        if (btnDismiss) {
            btnDismiss.addEventListener('click', () => hideQuickUndoBar());
        }

        return bar;
    }

    function showQuickUndoBar(scanSummary) {
        if (!scanSummary || !scanSummary.packageCode) return;
        const bar = ensureQuickUndoBarElement();
        const codeEl = document.getElementById('thumb-undo-pkg-code');
        const storeEl = document.getElementById('thumb-undo-store-label');

        if (codeEl) codeEl.textContent = scanSummary.packageCode;
        if (storeEl) {
            const parts = [];
            if (scanSummary.storeCode) parts.push(`CH ${scanSummary.storeCode}`);
            if (scanSummary.pkgIdxText) parts.push(`Kiện ${scanSummary.pkgIdxText}`);
            if (scanSummary.progressText) parts.push(`(${scanSummary.progressText})`);
            storeEl.textContent = parts.join(' • ') || scanSummary.storeName || '';
        }

        bar.style.display = 'flex';
        bar.classList.remove('thumb-undo-out');
        bar.classList.add('thumb-undo-in');

        if (quickUndoTimer) clearTimeout(quickUndoTimer);
        quickUndoTimer = setTimeout(() => {
            hideQuickUndoBar();
        }, 8500);
    }

    function hideQuickUndoBar() {
        if (quickUndoTimer) {
            clearTimeout(quickUndoTimer);
            quickUndoTimer = null;
        }
        const bar = document.getElementById('wcm-thumb-quick-undo-bar');
        if (bar) {
            bar.style.display = 'none';
        }
    }

    // =========================================================================
    // INITIALIZE CONTROLS ON DOM READY
    // =========================================================================
    function initErgonomics() {
        applyTheme(currentTheme);
        applyPdaKeyboardMode(isPdaKeyboardLocked, false);
        ensureQuickUndoBarElement();

        const btnTheme = document.getElementById('btn-toggle-theme');
        if (btnTheme) {
            btnTheme.addEventListener('click', toggleTheme);
        }

        const btnWake = document.getElementById('btn-toggle-wakelock');
        if (btnWake) {
            btnWake.addEventListener('click', () => toggleWakeLock());
        }

        const chkWake = document.getElementById('chk-wakelock');
        if (chkWake) {
            chkWake.checked = isWakeLockEnabled;
            chkWake.addEventListener('change', (e) => toggleWakeLock(e.target.checked));
        }

        const btnToggleKb = document.getElementById('btn-toggle-virtual-kb');
        if (btnToggleKb) {
            btnToggleKb.addEventListener('click', toggleVirtualKeyboard);
        }

        if (isWakeLockEnabled) {
            requestWakeLock();
        }
    }

    window.WCM_ERGONOMICS = {
        init: initErgonomics,
        requestWakeLock,
        releaseWakeLock,
        toggleWakeLock,
        applyTheme,
        toggleTheme,
        applyPdaKeyboardMode,
        toggleVirtualKeyboard,
        showQuickUndoBar,
        hideQuickUndoBar
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initErgonomics);
    } else {
        initErgonomics();
    }
})();
