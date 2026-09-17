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
            userBadge.innerHTML = `
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
        modal.querySelectorAll('.btn-delete-user').forEach(btn => {
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

    // Initialize GIS (Google Identity Services) if configured
    function initGoogleIdentity() {
        const clientId = (window.WCM_CONFIG && window.WCM_CONFIG.GOOGLE_CLIENT_ID) ? window.WCM_CONFIG.GOOGLE_CLIENT_ID.trim() : '';
        if (!clientId) return;

        window.onGoogleLibraryLoad = function() {
            if (window.google && window.google.accounts && window.google.accounts.id) {
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: handleGoogleCredentialResponse
                });
                const btnContainer = document.getElementById('google-signin-btn-slot');
                if (btnContainer) {
                    window.google.accounts.id.renderButton(btnContainer, {
                        theme: 'filled_blue',
                        size: 'large',
                        text: 'signin_with',
                        shape: 'rectangular',
                        width: 280
                    });
                }
            }
        };

        if (window.google && window.google.accounts) {
            window.onGoogleLibraryLoad();
        }
    }

    function handleGoogleCredentialResponse(response) {
        if (!response || !response.credential) return;
        const decoded = parseJwt(response.credential);
        if (decoded && decoded.email) {
            loginWithEmail(decoded.email, decoded.name, decoded.picture);
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

            // Connect Quick Login Form in Overlay
            const formLogin = document.getElementById('form-quick-login');
            if (formLogin) {
                formLogin.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const inputEmail = document.getElementById('login-email-input');
                    if (inputEmail && inputEmail.value.trim()) {
                        loginWithEmail(inputEmail.value.trim());
                    }
                });
            }

            // Quick Super Admin button for testing
            const btnQuickAdmin = document.getElementById('btn-quick-login-admin');
            if (btnQuickAdmin) {
                btnQuickAdmin.addEventListener('click', () => {
                    loginWithEmail(getSuperAdminEmail(), 'Nguyễn Sơn Tuấn');
                });
            }
        },
        getCurrentUser,
        isSuperAdmin,
        getUserRole: () => {
            const u = getCurrentUser();
            return u ? (u.role || resolveUserRole(u.email)) : 'UNAUTHORIZED';
        },
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
