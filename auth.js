// =============================================================================
// WCM SMART SCAN - AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
// Super Admin: tuanns@ghn.vn
// Roles: DAU_XUAT (Chỉ thấy tính năng Xuất), DAU_NHAP (Chỉ thấy tính năng Nhập)
// =============================================================================

(function() {
    'use strict';

    const STORAGE_KEY_USER = 'wcm_auth_user';
    const STORAGE_KEY_PERMISSIONS = 'wcm_cached_permissions';

    function getSuperAdminEmail() {
        return (window.WCM_CONFIG && window.WCM_CONFIG.SUPER_ADMIN_EMAIL) ? 
            window.WCM_CONFIG.SUPER_ADMIN_EMAIL.trim().toLowerCase() : 'tuanns@ghn.vn';
    }

    // Parse JWT token from Google Identity Services
    function parseJwt(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonPayload);
        } catch (e) {
            return null;
        }
    }

    // Load cached permissions
    function getCachedPermissions() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_PERMISSIONS);
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    }

    function saveCachedPermissions(list) {
        localStorage.setItem(STORAGE_KEY_PERMISSIONS, JSON.stringify(list || []));
    }

    // Get current logged-in user
    function getCurrentUser() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_USER);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    }

    function isSuperAdmin() {
        const u = getCurrentUser();
        if (!u || !u.email) return false;
        return u.email.trim().toLowerCase() === getSuperAdminEmail();
    }

    // Determine user role
    function resolveUserRole(email) {
        if (!email) return 'UNAUTHORIZED';
        const clean = email.trim().toLowerCase();
        if (clean === getSuperAdminEmail()) {
            return 'SUPER_ADMIN';
        }
        const permissions = getCachedPermissions();
        const found = permissions.find(p => p.email.trim().toLowerCase() === clean);
        if (found && found.status !== 'DELETED' && found.status !== 'KHOA') {
            return found.role; // 'DAU_XUAT' | 'DAU_NHAP'
        }
        return 'UNAUTHORIZED';
    }

    // Log in user
    function loginWithEmail(email, name, picture) {
        const cleanEmail = (email || '').trim().toLowerCase();
        if (!cleanEmail) return { success: false, message: 'Email không hợp lệ!' };

        const role = resolveUserRole(cleanEmail);
        const userObj = {
            email: cleanEmail,
            name: name || cleanEmail.split('@')[0],
            picture: picture || '',
            role: role,
            loggedAt: new Date().toISOString()
        };

        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userObj));
        applyRoleUI();
        
        // Also sync operator code in online_sync if needed
        if (window.OnlineSync) {
            window.OnlineSync.setOperatorCode(userObj.name);
        }

        return { success: true, user: userObj };
    }

    function logout() {
        localStorage.removeItem(STORAGE_KEY_USER);
        if (window.google && window.google.accounts && window.google.accounts.id) {
            try {
                window.google.accounts.id.disableAutoSelect();
            } catch (e) {}
        }
        applyRoleUI();
    }

    // Fetch permissions from Google Sheets Web App
    async function fetchPermissionsFromSheet() {
        if (!window.OnlineSync) return [];
        const scriptUrl = window.OnlineSync.getScriptUrl();
        if (!scriptUrl) return getCachedPermissions();

        try {
            const separator = scriptUrl.includes('?') ? '&' : '?';
            const res = await fetch(`${scriptUrl}${separator}action=get_permissions&_t=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.status === 'SUCCESS' && Array.isArray(data.permissions)) {
                saveCachedPermissions(data.permissions);
                // If user is currently logged in, refresh their role
                const current = getCurrentUser();
                if (current && !isSuperAdmin()) {
                    const newRole = resolveUserRole(current.email);
                    if (newRole !== current.role) {
                        current.role = newRole;
                        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(current));
                        applyRoleUI();
                    }
                }
                return data.permissions;
            }
        } catch (e) {
            console.warn('Cannot fetch permissions from Google Sheets:', e);
        }
        return getCachedPermissions();
    }

    // Super Admin: Update/assign role to an employee
    async function assignPermission(targetEmail, targetRole, targetName) {
        if (!isSuperAdmin()) {
            alert('Chỉ có Super Admin (tuanns@ghn.vn) mới có quyền phân quyền nhân viên!');
            return { success: false };
        }

        const cleanEmail = (targetEmail || '').trim().toLowerCase();
        if (!cleanEmail) {
            alert('Vui lòng nhập email nhân viên!');
            return { success: false };
        }

        // Update local cache immediately
        const list = getCachedPermissions();
        const existingIdx = list.findIndex(p => p.email.toLowerCase() === cleanEmail);
        const permObj = {
            email: cleanEmail,
            name: targetName || cleanEmail.split('@')[0],
            role: targetRole, // 'DAU_XUAT' | 'DAU_NHAP'
            status: 'HOAT_DONG',
            assignedBy: getSuperAdminEmail(),
            assignedAt: new Date().toISOString()
        };

        if (existingIdx >= 0) {
            list[existingIdx] = permObj;
        } else {
            list.push(permObj);
        }
        saveCachedPermissions(list);

        // Sync to Google Sheets in background
        if (window.OnlineSync && window.OnlineSync.getScriptUrl()) {
            try {
                fetch(window.OnlineSync.getScriptUrl(), {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'update_permission',
                        requester: getSuperAdminEmail(),
                        email: cleanEmail,
                        name: permObj.name,
                        role: targetRole,
                        status: 'HOAT_DONG'
                    })
                });
            } catch (e) {
                console.error('Error syncing permission to Google Sheet:', e);
            }
        }

        return { success: true, permission: permObj };
    }

    // Super Admin: Revoke/delete permission
    async function revokePermission(targetEmail) {
        if (!isSuperAdmin()) return { success: false };
        const cleanEmail = (targetEmail || '').trim().toLowerCase();

        const list = getCachedPermissions().filter(p => p.email.toLowerCase() !== cleanEmail);
        saveCachedPermissions(list);

        if (window.OnlineSync && window.OnlineSync.getScriptUrl()) {
            try {
                fetch(window.OnlineSync.getScriptUrl(), {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'update_permission',
                        requester: getSuperAdminEmail(),
                        email: cleanEmail,
                        status: 'DELETED'
                    })
                });
            } catch (e) {}
        }
        return { success: true };
    }

    // =========================================================================
    // ROLE UI ENFORCEMENT (VIEW ISOLATION)
    // =========================================================================
    function applyRoleUI() {
        const user = getCurrentUser();
        const loginOverlay = document.getElementById('auth-login-overlay');
        const blockedOverlay = document.getElementById('auth-blocked-overlay');
        const userBadge = document.getElementById('auth-user-badge');
        const btnManageUsers = document.getElementById('btn-manage-users');
        const modeTabs = document.querySelector('.mode-toggle');
        const btnModeImport = document.getElementById('btn-mode-import');
        const btnModeExport = document.getElementById('btn-mode-export');

        // Remove all role classes from body
        document.body.classList.remove('role-super-admin', 'role-export-only', 'role-import-only', 'role-unauthorized', 'not-logged-in');

        // 1. Not logged in
        if (!user) {
            document.body.classList.add('not-logged-in');
            if (loginOverlay) loginOverlay.style.display = 'flex';
            if (blockedOverlay) blockedOverlay.style.display = 'none';
            if (userBadge) userBadge.style.display = 'none';
            if (btnManageUsers) btnManageUsers.style.display = 'none';
            return;
        }

        // Hide login overlay
        if (loginOverlay) loginOverlay.style.display = 'none';

        const role = user.role || resolveUserRole(user.email);

        // 2. Unauthorized user
        if (role === 'UNAUTHORIZED' && !isSuperAdmin()) {
            document.body.classList.add('role-unauthorized');
            if (blockedOverlay) {
                blockedOverlay.style.display = 'flex';
                const elEmail = document.getElementById('blocked-user-email');
                if (elEmail) elEmail.textContent = user.email;
            }
            if (userBadge) {
                userBadge.style.display = 'inline-flex';
                userBadge.innerHTML = `👤 ${user.email} <button type="button" class="btn-logout" id="btn-do-logout">Thoát</button>`;
                document.getElementById('btn-do-logout')?.addEventListener('click', logout);
            }
            if (btnManageUsers) btnManageUsers.style.display = 'none';
            return;
        }

        // User is authorized!
        if (blockedOverlay) blockedOverlay.style.display = 'none';

        // Update User Badge in Header
        if (userBadge) {
            userBadge.style.display = 'inline-flex';
            let roleLabel = '';
            let roleClass = '';
            if (isSuperAdmin()) {
                roleLabel = '👑 Super Admin';
                roleClass = 'badge-admin';
            } else if (role === 'DAU_XUAT') {
                roleLabel = '📤 Đầu Xuất';
                roleClass = 'badge-export';
            } else if (role === 'DAU_NHAP') {
                roleLabel = '📥 Đầu Nhập';
                roleClass = 'badge-import';
            }
            const avatarHtml = (user.picture && user.picture.startsWith('http')) ?
                `<img src="${user.picture}" alt="avatar" class="user-avatar" style="width: 22px; height: 22px; border-radius: 50%; object-fit: cover; border: 1px solid #38bdf8; vertical-align: middle;">` :
                `👤`;
            userBadge.innerHTML = `
                ${avatarHtml}
                <span class="user-email-display" title="${user.email}">${user.email}</span>
                <span class="user-role-pill ${roleClass}">${roleLabel}</span>
                <button type="button" class="btn-logout" id="btn-do-logout" title="Đăng xuất khỏi hệ thống">Đăng xuất</button>
            `;
            document.getElementById('btn-do-logout')?.addEventListener('click', logout);
        }

        // Manage Users button (Super Admin only)
        if (btnManageUsers) {
            btnManageUsers.style.display = isSuperAdmin() ? 'inline-flex' : 'none';
        }

        // 3. STRICT VIEW ISOLATION
        if (isSuperAdmin()) {
            document.body.classList.add('role-super-admin');
            // Super admin sees both tabs
            if (modeTabs) modeTabs.style.display = 'flex';
            if (btnModeImport) btnModeImport.style.display = 'inline-block';
            if (btnModeExport) btnModeExport.style.display = 'inline-block';
        } else if (role === 'DAU_XUAT') {
            document.body.classList.add('role-export-only');
            // Hide import tab completely!
            if (btnModeImport) btnModeImport.style.display = 'none';
            if (btnModeExport) btnModeExport.style.display = 'none';
            if (modeTabs) modeTabs.style.display = 'none';
            // Force switch to Export mode if app.js is ready
            if (typeof window.switchMode === 'function') {
                window.switchMode('Xuất');
            }
        } else if (role === 'DAU_NHAP') {
            document.body.classList.add('role-import-only');
            // Hide export tab completely!
            if (btnModeImport) btnModeImport.style.display = 'none';
            if (btnModeExport) btnModeExport.style.display = 'none';
            if (modeTabs) modeTabs.style.display = 'none';
            // Force switch to Import mode if app.js is ready
            if (typeof window.switchMode === 'function') {
                window.switchMode('Nhập');
            }
        }
    }

    // =========================================================================
    // MODAL: SUPER ADMIN USER PERMISSIONS MANAGEMENT
    // =========================================================================
    function openUserManagementModal() {
        if (!isSuperAdmin()) {
            alert('Chỉ có Super Admin (tuanns@ghn.vn) mới có quyền truy cập trang này!');
            return;
        }

        const existing = document.getElementById('modal-user-management');
        if (existing) existing.remove();

        const permissions = getCachedPermissions();

        const modal = document.createElement('div');
        modal.id = 'modal-user-management';
        modal.className = 'pilot-modal-overlay';
        modal.innerHTML = `
            <div class="pilot-modal" style="max-width: 650px;">
                <div class="pilot-modal-header">
                    <span class="pilot-modal-title">👥 QUẢN LÝ PHÂN QUYỀN NHÂN VIÊN KHO</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-close-users-modal">✕</button>
                </div>

                <div style="background: rgba(49, 46, 129, 0.2); border: 1px solid #4338ca; border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 1rem; font-size: 0.82rem; color: #c7d2fe;">
                    👑 <strong>Super Admin:</strong> ${getSuperAdminEmail()} (Toàn quyền quản trị kho & cấp quyền cho nhân viên).
                </div>

                <!-- Add New User Form -->
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.85rem; margin-bottom: 1.25rem;">
                    <div style="font-weight: 700; font-size: 0.85rem; color: #38bdf8; margin-bottom: 0.5rem;">
                        ➕ CẤP QUYỀN CHO NHÂN VIÊN MỚI
                    </div>
                    <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <input type="email" id="input-new-user-email" placeholder="Email nhân viên (@ghn.vn hoặc Gmail)..." style="padding: 0.5rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; font-size: 0.85rem;">
                        <select id="select-new-user-role" style="padding: 0.5rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; font-size: 0.85rem; font-weight: 600;">
                            <option value="DAU_XUAT">📤 Nhân viên Đầu Xuất</option>
                            <option value="DAU_NHAP">📥 Nhân viên Đầu Nhập</option>
                        </select>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span id="perm-action-msg" style="font-size: 0.8rem; font-weight: 600;"></span>
                        <button type="button" class="btn btn-primary btn-sm" id="btn-submit-add-user">
                            💾 Cấp Quyền Cho Nhân Viên
                        </button>
                    </div>
                </div>

                <!-- Current Users List -->
                <div style="font-weight: 700; font-size: 0.85rem; color: #cbd5e1; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>DANH SÁCH NHÂN SỰ ĐÃ PHÂN QUYỀN (${permissions.length}):</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-refresh-perms" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;">🔄 Tải lại</button>
                </div>

                <div style="max-height: 250px; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; background: rgba(15, 23, 42, 0.6); margin-bottom: 1rem;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
                        <thead>
                            <tr style="background: #1e293b; color: #94a3b8; text-align: left;">
                                <th style="padding: 0.5rem 0.75rem;">Email</th>
                                <th style="padding: 0.5rem; text-align: center;">Vị Trí</th>
                                <th style="padding: 0.5rem; text-align: center; width: 80px;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="user-perm-table-body">
                            ${renderUserTableRows(permissions)}
                        </tbody>
                    </table>
                </div>

                <!-- Google Client ID Settings for Super Admin -->
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.85rem; margin-bottom: 1rem;">
                    <div style="font-weight: 700; font-size: 0.85rem; color: #f59e0b; margin-bottom: 0.4rem; display: flex; align-items: center; gap: 6px;">
                        <span>⚙️</span> CẤU HÌNH GOOGLE OAUTH CLIENT ID
                    </div>
                    <div style="font-size: 0.78rem; color: #94a3b8; margin-bottom: 0.5rem; line-height: 1.4;">
                        Google Client ID để kích hoạt Đăng nhập Google (OAuth 2.0) cho toàn bộ nhân viên kho:
                    </div>
                    <div style="display: flex; gap: 6px; margin-bottom: 0.4rem;">
                        <input type="text" id="modal-input-google-client-id" value="${getGoogleClientId()}" placeholder="vd: 123456...apps.googleusercontent.com" style="flex: 1; padding: 0.45rem 0.65rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; font-size: 0.78rem;">
                        <button type="button" class="btn btn-primary btn-sm" id="modal-btn-save-client-id" style="white-space: nowrap;">Lưu Client ID</button>
                    </div>
                    <div id="modal-clientid-msg" style="font-size: 0.75rem; font-weight: 600;"></div>
                </div>

                <div style="display: flex; justify-content: flex-end;">
                    <button type="button" class="btn btn-secondary" id="btn-close-users-modal-2">Đóng</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('btn-close-users-modal').addEventListener('click', () => modal.remove());
        document.getElementById('btn-close-users-modal-2').addEventListener('click', () => modal.remove());

        // Refresh permissions
        document.getElementById('btn-refresh-perms').addEventListener('click', async () => {
            const btn = document.getElementById('btn-refresh-perms');
            btn.textContent = '⏳ Đang tải...';
            const updated = await fetchPermissionsFromSheet();
            document.getElementById('user-perm-table-body').innerHTML = renderUserTableRows(updated);
            btn.textContent = '🔄 Tải lại';
            attachUserActionListeners(modal);
        });

        // Add user submit
        document.getElementById('btn-submit-add-user').addEventListener('click', async () => {
            const emailInput = document.getElementById('input-new-user-email');
            const roleSelect = document.getElementById('select-new-user-role');
            const msg = document.getElementById('perm-action-msg');
            const email = emailInput.value.trim();
            const role = roleSelect.value;

            if (!email) {
                msg.style.color = '#ef4444';
                msg.textContent = 'Vui lòng nhập email!';
                return;
            }

            msg.style.color = '#f59e0b';
            msg.textContent = '⏳ Đang lưu phân quyền...';

            const res = await assignPermission(email, role);
            if (res.success) {
                msg.style.color = '#10b981';
                msg.textContent = '✅ Đã cấp quyền!';
                emailInput.value = '';
                const updated = getCachedPermissions();
                document.getElementById('user-perm-table-body').innerHTML = renderUserTableRows(updated);
                attachUserActionListeners(modal);
            } else {
                msg.style.color = '#ef4444';
                msg.textContent = '❌ Lỗi cấp quyền!';
            }
        });

        // Save Google Client ID from Modal
        document.getElementById('modal-btn-save-client-id')?.addEventListener('click', () => {
            const val = document.getElementById('modal-input-google-client-id')?.value?.trim() || '';
            const msg = document.getElementById('modal-clientid-msg');
            if (!val) {
                if (msg) {
                    msg.style.color = '#ef4444';
                    msg.textContent = 'Vui lòng nhập Client ID!';
                }
                return;
            }
            setGoogleClientId(val);
            if (msg) {
                msg.style.color = '#10b981';
                msg.textContent = '✅ Đã cập nhật Google Client ID thành công!';
            }
        });

        attachUserActionListeners(modal);
    }

    function renderUserTableRows(list) {
        if (!list || list.length === 0) {
            return `<tr><td colspan="3" style="text-align: center; color: #94a3b8; padding: 1.5rem;">Chưa có nhân viên nào được phân quyền.</td></tr>`;
        }

        return list.map(item => {
            const roleBadge = item.role === 'DAU_XUAT' ? 
                `<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">📤 Đầu Xuất</span>` :
                `<span class="badge badge-success" style="background: rgba(0, 161, 154, 0.15); color: #00a19a;">📥 Đầu Nhập</span>`;

            return `
                <tr style="border-bottom: 1px solid #334155;">
                    <td style="padding: 0.5rem 0.75rem; font-weight: 600; color: #f8fafc;">${item.email}</td>
                    <td style="padding: 0.5rem; text-align: center;">${roleBadge}</td>
                    <td style="padding: 0.5rem; text-align: center;">
                        <button type="button" class="btn btn-danger btn-sm btn-delete-user" data-email="${item.email}" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;">
                            Xóa
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function attachUserActionListeners(modal) {
        modal.querySelectorAll('.btn-delete-user, .btn-del-user').forEach(btn => {
            btn.addEventListener('click', async () => {
                const target = btn.getAttribute('data-email');
                if (confirm(`Bạn có chắc muốn xóa quyền của nhân viên ${target}?`)) {
                    await revokePermission(target);
                    const updated = getCachedPermissions();
                    document.getElementById('user-perm-table-body').innerHTML = renderUserTableRows(updated);
                    attachUserActionListeners(modal);
                }
            });
        });
    }

    // Google OAuth Client ID resolution
    function getGoogleClientId() {
        if (window.WCM_CONFIG && window.WCM_CONFIG.GOOGLE_CLIENT_ID && window.WCM_CONFIG.GOOGLE_CLIENT_ID.trim()) {
            return window.WCM_CONFIG.GOOGLE_CLIENT_ID.trim();
        }
        try {
            const saved = localStorage.getItem('wcm_google_client_id');
            if (saved && saved.trim()) return saved.trim();
        } catch (e) {}
        return '';
    }

    function setGoogleClientId(clientId) {
        const clean = (clientId || '').trim();
        if (clean) {
            localStorage.setItem('wcm_google_client_id', clean);
            if (window.WCM_CONFIG) window.WCM_CONFIG.GOOGLE_CLIENT_ID = clean;
            gisInitialized = false;
            initGoogleIdentity();
            return true;
        }
        return false;
    }

    // Initialize GIS (Google Identity Services)
    let gisInitialized = false;

    function initGoogleIdentity() {
        const clientId = getGoogleClientId();
        const setupCard = document.getElementById('google-clientid-setup-card');
        const btnSlot = document.getElementById('google-signin-btn-slot');
        const loadingText = document.getElementById('gis-loading-text');

        if (!clientId) {
            if (setupCard) setupCard.style.display = 'block';
            if (loadingText) {
                loadingText.innerHTML = '<span style="color: #f59e0b; font-weight: 600;">⚠️ Chưa có Google Client ID</span>';
            }
            return;
        }

        // Client ID exists: Hide setup card
        if (setupCard) setupCard.style.display = 'none';
        if (loadingText) {
            loadingText.style.display = 'flex';
            loadingText.innerHTML = '<span class="sync-spinner" style="width: 14px; height: 14px; display: inline-block;"></span> Đang nạp nút Đăng nhập Google...';
        }

        function renderGisButton() {
            if (gisInitialized) return;
            if (!window.google || !window.google.accounts || !window.google.accounts.id) return;

            try {
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: handleGoogleCredentialResponse,
                    auto_select: false,
                    cancel_on_tap_outside: false
                });

                if (btnSlot) {
                    btnSlot.innerHTML = '';
                    window.google.accounts.id.renderButton(btnSlot, {
                        theme: 'filled_blue',
                        size: 'large',
                        text: 'signin_with',
                        shape: 'rectangular',
                        logo_alignment: 'left',
                        width: 320
                    });
                }

                gisInitialized = true;
                if (loadingText) loadingText.style.display = 'none';

                // Attempt One Tap prompt
                try {
                    window.google.accounts.id.prompt();
                } catch (e) {}

            } catch (err) {
                console.error('Lỗi khởi tạo Google Identity Services:', err);
                if (btnSlot) {
                    btnSlot.innerHTML = `<div style="color: #ef4444; font-size: 0.8rem; text-align: center;">⚠️ Lỗi Google OAuth: ${err.message || 'Client ID không hợp lệ'}</div>`;
                }
                if (setupCard) setupCard.style.display = 'block';
            }
        }

        if (window.google && window.google.accounts && window.google.accounts.id) {
            renderGisButton();
        } else {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (window.google && window.google.accounts && window.google.accounts.id) {
                    clearInterval(timer);
                    renderGisButton();
                } else if (attempts > 60) {
                    clearInterval(timer);
                    if (loadingText) {
                        loadingText.innerHTML = '⚠️ Không thể tải Google Identity SDK. Kiểm tra mạng!';
                    }
                }
            }, 100);
        }
    }

    async function handleGoogleCredentialResponse(response) {
        if (!response || !response.credential) {
            alert('Đăng nhập Google thất bại hoặc bị hủy.');
            return;
        }
        const decoded = parseJwt(response.credential);
        if (!decoded || !decoded.email) {
            alert('Không thể trích xuất email từ tài khoản Google.');
            return;
        }

        const email = decoded.email.trim().toLowerCase();
        const name = decoded.name || email.split('@')[0];
        const picture = decoded.picture || '';

        // Show status message during login
        const statusMsg = document.getElementById('auth-status-message');
        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.style.background = 'rgba(59, 130, 246, 0.15)';
            statusMsg.style.color = '#60a5fa';
            statusMsg.style.border = '1px solid #3b82f6';
            statusMsg.textContent = `Đang đồng bộ quyền hạn cho ${email}...`;
        }

        try {
            await fetchPermissionsFromSheet();
        } catch (e) {
            console.warn('Lỗi đồng bộ phân quyền từ Google Sheet:', e);
        }

        loginWithEmail(email, name, picture);

        if (statusMsg) {
            statusMsg.style.display = 'none';
        }
    }

    // Public API
    window.WCM_AUTH = {
        init: function() {
            applyRoleUI();
            fetchPermissionsFromSheet();
            initGoogleIdentity();

            // Connect Manage Users button
            const btnManage = document.getElementById('btn-manage-users');
            if (btnManage) {
                btnManage.addEventListener('click', openUserManagementModal);
            }

            // Connect Save Client ID button on login overlay
            const btnSaveClientId = document.getElementById('btn-save-client-id');
            if (btnSaveClientId) {
                btnSaveClientId.addEventListener('click', () => {
                    const input = document.getElementById('input-google-client-id');
                    const val = input ? input.value.trim() : '';
                    if (!val) {
                        alert('Vui lòng dán Google Client ID (dạng xxxxx.apps.googleusercontent.com)!');
                        return;
                    }
                    setGoogleClientId(val);
                    alert('✅ Đã lưu Google Client ID! Hệ thống đang kích hoạt nút Đăng nhập Google...');
                });
            }
        },
        getCurrentUser,
        isSuperAdmin,
        getUserRole: () => {
            const u = getCurrentUser();
            return u ? (u.role || resolveUserRole(u.email)) : 'UNAUTHORIZED';
        },
        getGoogleClientId,
        setGoogleClientId,
        loginWithEmail,
        logout,
        assignPermission,
        revokePermission,
        fetchPermissionsFromSheet,
        openUserManagementModal,
        applyRoleUI,
        handleGoogleCredentialResponse
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.WCM_AUTH.init());
    } else {
        window.WCM_AUTH.init();
    }
})();
