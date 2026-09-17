// =============================================================================
// WCM SMART SCAN - AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
// Super Admin: tuanns@ghn.vn
// Roles: DAU_XUAT (Chỉ thấy tính năng Xuất), DAU_NHAP (Chỉ thấy tính năng Nhập)
// =============================================================================

(function() {
    'use strict';

    const STORAGE_KEY_USER = 'wcm_auth_user';
    const STORAGE_KEY_PERMISSIONS = 'wcm_cached_permissions';
    const STORAGE_KEY_ID_TOKEN = 'wcm_google_id_token';

    function getGoogleIdToken() {
        return sessionStorage.getItem(STORAGE_KEY_ID_TOKEN) || localStorage.getItem(STORAGE_KEY_ID_TOKEN) || '';
    }

    function saveGoogleIdToken(token) {
        if (token) {
            try { sessionStorage.setItem(STORAGE_KEY_ID_TOKEN, token); } catch (e) {}
            try { localStorage.setItem(STORAGE_KEY_ID_TOKEN, token); } catch (e) {}
        } else {
            try { sessionStorage.removeItem(STORAGE_KEY_ID_TOKEN); } catch (e) {}
            try { localStorage.removeItem(STORAGE_KEY_ID_TOKEN); } catch (e) {}
        }
    }

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

    // Load cached permissions (merging WCM_CONFIG.INITIAL_PERMISSIONS with localStorage)
    function getCachedPermissions() {
        const initial = (window.WCM_CONFIG && Array.isArray(window.WCM_CONFIG.INITIAL_PERMISSIONS)) ?
            [...window.WCM_CONFIG.INITIAL_PERMISSIONS] : [];
        try {
            const saved = localStorage.getItem(STORAGE_KEY_PERMISSIONS);
            if (!saved) return initial;
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) return initial;
            // Merge initial permissions with saved permissions (saved takes precedence if modified)
            const map = new Map();
            initial.forEach(p => { if (p && p.email) map.set(p.email.toLowerCase(), p); });
            parsed.forEach(p => { if (p && p.email) map.set(p.email.toLowerCase(), p); });
            return Array.from(map.values());
        } catch (e) {
            return initial;
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

    function isAdmin() {
        if (isSuperAdmin()) return true;
        const u = getCurrentUser();
        if (!u || !u.email) return false;
        const clean = u.email.trim().toLowerCase();
        if (clean === getSuperAdminEmail()) return true;
        const role = u.role || resolveUserRole(clean);
        return role === 'ADMIN' || role === 'SUPER_ADMIN';
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
        if (found) {
            const status = (found.status || '').trim().toUpperCase();
            if (status === 'HOAT_DONG') {
                const r = (found.role || 'DAU_XUAT').trim().toUpperCase();
                if (r === 'ADMIN' || r === 'SUPER_ADMIN') return 'ADMIN';
                if (r === 'XUAT_NHAP' || r === 'BOTH' || r === 'DAU_XUAT_NHAP') return 'XUAT_NHAP';
                if (r === 'DAU_NHAP') return 'DAU_NHAP';
                return 'DAU_XUAT';
            }
            if (status === 'KHOA') {
                return 'BLOCKED';
            }
            if (status === 'CHO_DUYET') {
                return 'PENDING_APPROVAL';
            }
            // If DELETED or any other status
            return 'PENDING_APPROVAL';
        }
        // If not found in permissions list, new user enters pending queue
        return 'PENDING_APPROVAL';
    }

    // Polling & Queue management
    let approvalPollInterval = null;
    let adminCheckInterval = null;

    function startApprovalPolling(email) {
        stopApprovalPolling();
        const clean = (email || '').trim().toLowerCase();
        if (!clean || clean === getSuperAdminEmail()) return;

        approvalPollInterval = setInterval(async () => {
            try {
                await fetchPermissionsFromSheet();
                const latestRole = resolveUserRole(clean);
                if (latestRole === 'DAU_XUAT' || latestRole === 'DAU_NHAP' || latestRole === 'XUAT_NHAP' || latestRole === 'ADMIN' || latestRole === 'SUPER_ADMIN') {
                    stopApprovalPolling();
                    const curUser = getCurrentUser();
                    if (curUser && curUser.email.toLowerCase() === clean) {
                        curUser.role = latestRole;
                        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(curUser));
                    }
                    if (typeof window.showToastNotification === 'function') {
                        let roleName = 'Đầu Xuất';
                        if (latestRole === 'DAU_NHAP') roleName = 'Đầu Nhập';
                        else if (latestRole === 'XUAT_NHAP') roleName = 'Cả Xuất & Nhập';
                        else if (latestRole === 'ADMIN') roleName = 'Quản trị viên (Admin)';
                        window.showToastNotification(`🎉 Tài khoản đã được phê duyệt vào ${roleName}!`, 'SUCCESS');
                    }
                    applyRoleUI();
                } else if (latestRole === 'BLOCKED') {
                    stopApprovalPolling();
                    applyRoleUI();
                }
            } catch (err) {
                console.warn('[WCM_AUTH] Lỗi polling hàng chờ duyệt:', err);
            }
        }, 6000);
    }

    function stopApprovalPolling() {
        if (approvalPollInterval) {
            clearInterval(approvalPollInterval);
            approvalPollInterval = null;
        }
    }

    function startAdminPendingChecker() {
        if (adminCheckInterval) clearInterval(adminCheckInterval);
        if (!isAdmin()) return;
        adminCheckInterval = setInterval(async () => {
            if (!isAdmin()) {
                stopAdminPendingChecker();
                return;
            }
            await fetchPermissionsFromSheet();
        }, 15000);
    }

    function stopAdminPendingChecker() {
        if (adminCheckInterval) {
            clearInterval(adminCheckInterval);
            adminCheckInterval = null;
        }
    }

    function updateAdminPendingBadge(permissions) {
        const btn = document.getElementById('btn-manage-users');
        if (!btn || !isAdmin()) return;
        const pending = (permissions || []).filter(p => (p.status || '').trim().toUpperCase() === 'CHO_DUYET');
        if (pending.length > 0) {
            btn.innerHTML = `👥 Phân Quyền <span class="badge-pending-counter">${pending.length}</span>`;
            btn.setAttribute('title', `Có ${pending.length} nhân viên đang chờ duyệt phân quyền`);
        } else {
            btn.innerHTML = `👥 Phân Quyền`;
            btn.removeAttribute('title');
        }
    }

    // Request access into pending queue
    async function requestAccess(email, name, desiredRole) {
        const cleanEmail = (email || '').trim().toLowerCase();
        if (!cleanEmail) return { success: false, message: 'Email không hợp lệ!' };
        const cleanRole = desiredRole || 'DAU_XUAT';
        const cleanName = name || cleanEmail.split('@')[0];

        // Update local cache immediately
        const list = getCachedPermissions();
        const existingIdx = list.findIndex(p => p.email.toLowerCase() === cleanEmail);
        const reqObj = {
            email: cleanEmail,
            name: cleanName,
            role: cleanRole,
            status: 'CHO_DUYET',
            assignedBy: 'Tự đăng ký',
            assignedAt: new Date().toISOString()
        };

        if (existingIdx >= 0) {
            list[existingIdx] = reqObj;
        } else {
            list.push(reqObj);
        }
        saveCachedPermissions(list);

        // Sync to backend (Data Adapter / Google Sheets)
        try {
            if (window.WCM_DATA_ADAPTER && window.WCM_DATA_ADAPTER.requestAccess) {
                await window.WCM_DATA_ADAPTER.requestAccess({
                    email: cleanEmail,
                    name: cleanName,
                    desiredRole: cleanRole
                });
            } else if (window.OnlineSync && window.OnlineSync.getScriptUrl()) {
                await fetch(window.OnlineSync.getScriptUrl(), {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'request_access',
                        email: cleanEmail,
                        name: cleanName,
                        desiredRole: cleanRole
                    })
                });
            }
            return { success: true, permission: reqObj };
        } catch (e) {
            console.warn('[WCM_AUTH] Lỗi gửi yêu cầu duyệt tới Google Sheet:', e);
            return { success: false, error: e };
        }
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

        // If new or pending user, immediately post request_access to Google Sheets
        if (role === 'PENDING_APPROVAL') {
            requestAccess(cleanEmail, userObj.name, 'DAU_XUAT');
        }

        applyRoleUI();
        
        // Also sync operator code in online_sync if needed
        if (window.OnlineSync) {
            window.OnlineSync.setOperatorCode(userObj.name);
        }

        return { success: true, user: userObj };
    }

    function logout() {
        stopApprovalPolling();
        stopAdminPendingChecker();
        localStorage.removeItem(STORAGE_KEY_USER);
        saveGoogleIdToken('');
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
                updateAdminPendingBadge(data.permissions);

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

    // Super Admin / Admin: Update/assign role to an employee
    async function assignPermission(targetEmail, targetRole, targetName) {
        if (!isAdmin()) {
            alert('Chỉ có Quản trị viên (Admin) mới có quyền phân quyền nhân viên!');
            return { success: false };
        }

        const cleanEmail = (targetEmail || '').trim().toLowerCase();
        if (!cleanEmail) {
            alert('Vui lòng nhập email nhân viên!');
            return { success: false };
        }

        if (cleanEmail === getSuperAdminEmail()) {
            alert('Không thể thay đổi quyền của Super Admin tối cao!');
            return { success: false };
        }

        const curUser = getCurrentUser();
        const requesterEmail = (curUser && curUser.email) ? curUser.email.trim().toLowerCase() : getSuperAdminEmail();

        // Update local cache immediately
        const list = getCachedPermissions();
        const existingIdx = list.findIndex(p => p.email.toLowerCase() === cleanEmail);
        const existingUser = existingIdx >= 0 ? list[existingIdx] : null;
        const permObj = {
            email: cleanEmail,
            name: targetName || (existingUser && existingUser.name) || cleanEmail.split('@')[0],
            role: targetRole, // 'DAU_XUAT' | 'DAU_NHAP' | 'XUAT_NHAP' | 'ADMIN'
            status: 'HOAT_DONG',
            assignedBy: requesterEmail,
            assignedAt: new Date().toISOString()
        };

        if (existingIdx >= 0) {
            list[existingIdx] = permObj;
        } else {
            list.push(permObj);
        }
        saveCachedPermissions(list);

        // Sync to Google Sheets with proper CORS (no external HTTP fetch needed)
        if (window.OnlineSync && window.OnlineSync.getScriptUrl()) {
            try {
                const res = await fetch(window.OnlineSync.getScriptUrl(), {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'update_permission',
                        requester: requesterEmail,
                        email: cleanEmail,
                        name: permObj.name,
                        role: targetRole,
                        status: 'HOAT_DONG'
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.status !== 'SUCCESS') {
                        console.warn('[WCM_AUTH] Google Sheet rejected permission:', data.message);
                        return { success: false, message: data.message || 'Google Sheets từ chối phân quyền!' };
                    }
                }
            } catch (e) {
                console.error('[WCM_AUTH] Error syncing permission to Google Sheet:', e);
            }
        }

        return { success: true, permission: permObj };
    }

    // Super Admin / Admin: Revoke/delete permission
    async function revokePermission(targetEmail) {
        if (!isAdmin()) return { success: false, message: 'Chỉ Quản trị viên (Admin) mới có quyền xóa!' };
        const cleanEmail = (targetEmail || '').trim().toLowerCase();

        if (cleanEmail === getSuperAdminEmail()) {
            return { success: false, message: 'Không thể thu hồi quyền của Super Admin tối cao!' };
        }

        const curUser = getCurrentUser();
        const requesterEmail = (curUser && curUser.email) ? curUser.email.trim().toLowerCase() : getSuperAdminEmail();

        const list = getCachedPermissions().filter(p => p.email.toLowerCase() !== cleanEmail);
        saveCachedPermissions(list);

        if (window.OnlineSync && window.OnlineSync.getScriptUrl()) {
            try {
                const res = await fetch(window.OnlineSync.getScriptUrl(), {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'update_permission',
                        requester: requesterEmail,
                        email: cleanEmail,
                        status: 'DELETED'
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.status !== 'SUCCESS') {
                        console.warn('[WCM_AUTH] Google Sheet rejected revoke:', data.message);
                        return { success: false, message: data.message };
                    }
                }
            } catch (e) {
                console.error('[WCM_AUTH] Error revoking permission on Google Sheet:', e);
            }
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
        document.body.classList.remove('role-super-admin', 'role-admin', 'role-both', 'role-export-only', 'role-import-only', 'role-pending-approval', 'role-unauthorized', 'role-blocked', 'not-logged-in');

        const mainContainer = document.querySelector('.container');

        // 1. Not logged in
        if (!user) {
            stopApprovalPolling();
            stopAdminPendingChecker();
            document.body.classList.add('not-logged-in');
            if (mainContainer) mainContainer.setAttribute('inert', '');
            if (loginOverlay) loginOverlay.style.display = 'flex';
            if (blockedOverlay) blockedOverlay.style.display = 'none';
            if (userBadge) userBadge.style.display = 'none';
            if (btnManageUsers) btnManageUsers.style.display = 'none';
            return;
        }

        // Hide login overlay
        if (loginOverlay) loginOverlay.style.display = 'none';

        // Always resolve latest role from permissions
        const latestRole = isSuperAdmin() ? 'SUPER_ADMIN' : resolveUserRole(user.email);
        if (user.role !== latestRole) {
            user.role = latestRole;
            localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
        }
        const role = latestRole;

        // 2. Pending Approval Queue
        if (role === 'PENDING_APPROVAL' && !isAdmin()) {
            document.body.classList.add('role-pending-approval');
            if (mainContainer) mainContainer.setAttribute('inert', '');
            if (blockedOverlay) {
                blockedOverlay.style.display = 'flex';
                
                const card = document.getElementById('auth-blocked-card');
                if (card) {
                    card.style.borderColor = '#f59e0b';
                    card.style.boxShadow = '0 10px 40px rgba(245, 158, 11, 0.25)';
                }

                const logo = document.getElementById('auth-blocked-logo');
                if (logo) {
                    logo.textContent = '⏳';
                    logo.style.background = 'rgba(245, 158, 11, 0.2)';
                    logo.style.color = '#f59e0b';
                    logo.classList.add('pending-logo-pulse');
                }

                const title = document.getElementById('auth-blocked-title');
                if (title) {
                    title.textContent = 'HÀNG CHỜ PHÊ DUYỆT';
                    title.style.color = '#fbbf24';
                }

                const sub = document.getElementById('auth-blocked-subtitle');
                if (sub) {
                    sub.textContent = 'Tài khoản đang chờ Tổng Admin phê duyệt vị trí làm việc';
                }

                const elEmail = document.getElementById('blocked-user-email');
                if (elEmail) elEmail.textContent = user.email;

                const elPill = document.getElementById('blocked-status-pill');
                if (elPill) {
                    elPill.className = 'badge';
                    elPill.style.background = 'rgba(245, 158, 11, 0.2)';
                    elPill.style.color = '#fbbf24';
                    elPill.style.border = '1px solid #f59e0b';
                    elPill.textContent = '⏳ Đang chờ duyệt';
                }

                // Show role selection options
                const roleBox = document.getElementById('desired-role-buttons');
                if (roleBox && roleBox.parentElement) {
                    roleBox.parentElement.style.display = 'block';
                }

                // Sync current requested role with UI buttons
                const permissions = getCachedPermissions();
                const myPerm = permissions.find(p => p.email.toLowerCase() === user.email.toLowerCase());
                const curDesiredRole = (myPerm && myPerm.role) || 'DAU_XUAT';

                document.querySelectorAll('#desired-role-buttons .btn-role-choice').forEach(btn => {
                    const btnRole = btn.getAttribute('data-role');
                    if (btnRole === curDesiredRole) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }

                    btn.onclick = async () => {
                        document.querySelectorAll('#desired-role-buttons .btn-role-choice').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        const targetRole = btn.getAttribute('data-role');
                        btn.disabled = true;
                        await requestAccess(user.email, user.name, targetRole);
                        btn.disabled = false;
                        if (typeof window.showToastNotification === 'function') {
                            let label = 'Đầu Xuất';
                            if (targetRole === 'DAU_NHAP') label = 'Đầu Nhập';
                            else if (targetRole === 'XUAT_NHAP') label = 'Cả Xuất & Nhập';
                            window.showToastNotification(`Đã chuyển nguyện vọng sang: ${label}`, 'INFO');
                        }
                    };
                });

                // Manual check button
                const btnCheck = document.getElementById('btn-manual-check-approval');
                if (btnCheck) {
                    btnCheck.onclick = async () => {
                        btnCheck.disabled = true;
                        btnCheck.innerHTML = '<span class="sync-spinner" style="width: 14px; height: 14px; display: inline-block;"></span> Đang kiểm tra...';
                        await fetchPermissionsFromSheet();
                        const checkRole = resolveUserRole(user.email);
                        if (checkRole === 'DAU_XUAT' || checkRole === 'DAU_NHAP' || checkRole === 'XUAT_NHAP' || checkRole === 'ADMIN' || checkRole === 'SUPER_ADMIN') {
                            btnCheck.innerHTML = '✅ Đã được duyệt! Đang mở...';
                            user.role = checkRole;
                            localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
                            setTimeout(() => {
                                applyRoleUI();
                            }, 500);
                        } else {
                            btnCheck.innerHTML = '⏳ Vẫn đang chờ duyệt';
                            setTimeout(() => {
                                btnCheck.disabled = false;
                                btnCheck.innerHTML = '🔄 Kiểm tra duyệt ngay';
                            }, 1800);
                        }
                    };
                }
            }

            if (userBadge) {
                userBadge.style.display = 'inline-flex';
                userBadge.innerHTML = `👤 <span class="user-email-display" title="${user.email}">${user.email}</span> <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; margin-left: 6px; font-size: 0.72rem;">⏳ Chờ duyệt</span> <button type="button" class="btn-logout" id="btn-do-logout">Thoát</button>`;
                document.getElementById('btn-do-logout')?.addEventListener('click', logout);
            }
            if (btnManageUsers) btnManageUsers.style.display = 'none';

            // Start polling loop
            startApprovalPolling(user.email);
            return;
        }

        // 3. Blocked / Denied user
        if ((role === 'BLOCKED' || role === 'UNAUTHORIZED') && !isAdmin()) {
            stopApprovalPolling();
            document.body.classList.add('role-blocked');
            if (mainContainer) mainContainer.setAttribute('inert', '');
            if (blockedOverlay) {
                blockedOverlay.style.display = 'flex';

                const card = document.getElementById('auth-blocked-card');
                if (card) {
                    card.style.borderColor = '#ef4444';
                    card.style.boxShadow = '0 10px 40px rgba(239, 68, 68, 0.25)';
                }

                const logo = document.getElementById('auth-blocked-logo');
                if (logo) {
                    logo.textContent = '🚫';
                    logo.style.background = 'rgba(239, 68, 68, 0.2)';
                    logo.style.color = '#ef4444';
                    logo.classList.remove('pending-logo-pulse');
                }

                const title = document.getElementById('auth-blocked-title');
                if (title) {
                    title.textContent = 'TRUY CẬP BỊ TỪ CHỐI';
                    title.style.color = '#f87171';
                }

                const sub = document.getElementById('auth-blocked-subtitle');
                if (sub) {
                    sub.textContent = 'Tài khoản của bạn đã bị khóa hoặc từ chối truy cập!';
                }

                const elEmail = document.getElementById('blocked-user-email');
                if (elEmail) elEmail.textContent = user.email;

                const elPill = document.getElementById('blocked-status-pill');
                if (elPill) {
                    elPill.className = 'badge';
                    elPill.style.background = 'rgba(239, 68, 68, 0.2)';
                    elPill.style.color = '#f87171';
                    elPill.style.border = '1px solid #ef4444';
                    elPill.textContent = '❌ Đã bị khóa';
                }

                const roleBox = document.getElementById('desired-role-buttons');
                if (roleBox && roleBox.parentElement) {
                    roleBox.parentElement.style.display = 'none';
                }
            }

            if (userBadge) {
                userBadge.style.display = 'inline-flex';
                userBadge.innerHTML = `👤 ${user.email} <button type="button" class="btn-logout" id="btn-do-logout">Thoát</button>`;
                document.getElementById('btn-do-logout')?.addEventListener('click', logout);
            }
            if (btnManageUsers) btnManageUsers.style.display = 'none';
            return;
        }

        // 4. User is authorized!
        stopApprovalPolling();
        if (mainContainer) mainContainer.removeAttribute('inert');
        if (blockedOverlay) blockedOverlay.style.display = 'none';

        // Update User Badge in Header
        if (userBadge) {
            userBadge.style.display = 'inline-flex';
            let roleLabel = '';
            let roleClass = '';
            if (isSuperAdmin()) {
                roleLabel = '👑 Super Admin';
                roleClass = 'badge-admin';
            } else if (role === 'ADMIN') {
                roleLabel = '👑 Admin';
                roleClass = 'badge-admin';
            } else if (role === 'XUAT_NHAP') {
                roleLabel = '🔄 Xuất & Nhập';
                roleClass = 'badge-both';
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

        // Manage Users button (Admin / Super Admin)
        if (btnManageUsers) {
            btnManageUsers.style.display = isAdmin() ? 'inline-flex' : 'none';
            if (isAdmin()) {
                updateAdminPendingBadge(getCachedPermissions());
                startAdminPendingChecker();
            }
        }

        // 3. CLEAN UP UNNECESSARY CONTROLS FOR WAREHOUSE STAFF
        const hasAdminPrivilege = isAdmin();

        // Hide admin-only header buttons for regular staff (CSV upload, Sheet config, Reset session, Offline badge, Trip config)
        document.querySelectorAll('.admin-only, .file-upload-wrapper, #online-sync-pill, #btn-reset-session, #offline-badge, #btn-open-trip-config, #btn-quick-config-trips').forEach(el => {
            el.style.display = hasAdminPrivilege ? '' : 'none';
        });

        // Pilot mode button: only admin or explicit ?pilot=1
        if (window.WarehousePilot && typeof window.WarehousePilot.refreshButton === 'function') {
            window.WarehousePilot.refreshButton();
        } else {
            const btnPilot = document.getElementById('btn-open-pilot-mode');
            if (btnPilot) {
                const hasPilotParam = new URLSearchParams(window.location.search).get('pilot') === '1';
                btnPilot.style.display = (hasAdminPrivilege || hasPilotParam) ? '' : 'none';
            }
        }

        // Left panel: Hide redundant operator-code and target-store inputs for staff
        const fgOp = document.getElementById('form-group-operator-code');
        if (fgOp) fgOp.style.display = hasAdminPrivilege ? '' : 'none';

        const fgTargetStore = document.getElementById('form-group-target-store');
        if (fgTargetStore) fgTargetStore.style.display = hasAdminPrivilege ? '' : 'none';

        // 4. STRICT VIEW ISOLATION
        if (isSuperAdmin() || role === 'ADMIN') {
            document.body.classList.add(isSuperAdmin() ? 'role-super-admin' : 'role-admin');
            // Admin sees both tabs
            if (modeTabs) modeTabs.style.display = 'flex';
            if (btnModeImport) btnModeImport.style.display = 'inline-block';
            if (btnModeExport) btnModeExport.style.display = 'inline-block';
        } else if (role === 'XUAT_NHAP') {
            document.body.classList.add('role-both');
            // Nhân viên phụ trách cả 2 vị trí được thấy và chuyển đổi cả 2 đầu!
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
    function renderPendingQueueItems(list) {
        if (!list || list.length === 0) return '';
        return list.map(item => {
            const role = (item.role || '').trim().toUpperCase();
            let desiredBadge = '';
            if (role === 'DAU_NHAP') {
                desiredBadge = `<span class="badge" style="background: rgba(0, 161, 154, 0.15); color: #5eead4; border: 1px solid #00A19A; font-size: 0.72rem;">📥 Xin Đầu Nhập</span>`;
            } else if (role === 'XUAT_NHAP' || role === 'BOTH') {
                desiredBadge = `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid #a855f7; font-size: 0.72rem;">🔄 Xin Cả 2 Vị Trí</span>`;
            } else if (role === 'ADMIN') {
                desiredBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid #f59e0b; font-size: 0.72rem;">👑 Xin Admin</span>`;
            } else {
                desiredBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid #3b82f6; font-size: 0.72rem;">📤 Xin Đầu Xuất</span>`;
            }

            return `
                <div class="pending-user-row" style="background: rgba(15, 23, 42, 0.9); border: 1px solid #334155; border-radius: 6px; padding: 0.6rem 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <div style="min-width: 170px;">
                        <div style="font-weight: 700; color: #f8fafc; font-size: 0.84rem; display: flex; align-items: center; gap: 6px;">
                            <span>👤</span> ${item.name ? `${item.name} (${item.email})` : item.email}
                        </div>
                        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 3px; display: flex; gap: 8px; align-items: center;">
                            ${desiredBadge}
                            <span>🕒 ${item.assignedAt ? item.assignedAt.slice(0, 16) : 'Vừa xong'}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.3rem; align-items: center; flex-wrap: wrap;">
                        <button type="button" class="btn btn-sm btn-quick-approve" data-email="${item.email}" data-name="${item.name || ''}" data-role="DAU_XUAT" style="background: #2563eb; border-color: #2563eb; color: #fff; font-size: 0.72rem; padding: 0.25rem 0.45rem; font-weight: 600;" title="Duyệt quyền Đầu Xuất">
                            📤 Xuất
                        </button>
                        <button type="button" class="btn btn-sm btn-quick-approve" data-email="${item.email}" data-name="${item.name || ''}" data-role="DAU_NHAP" style="background: #00A19A; border-color: #00A19A; color: #fff; font-size: 0.72rem; padding: 0.25rem 0.45rem; font-weight: 600;" title="Duyệt quyền Đầu Nhập">
                            📥 Nhập
                        </button>
                        <button type="button" class="btn btn-sm btn-quick-approve" data-email="${item.email}" data-name="${item.name || ''}" data-role="XUAT_NHAP" style="background: #7c3aed; border-color: #7c3aed; color: #fff; font-size: 0.72rem; padding: 0.25rem 0.45rem; font-weight: 600;" title="Duyệt phụ trách cả 2 vị trí Xuất & Nhập">
                            🔄 Cả 2
                        </button>
                        <button type="button" class="btn btn-sm btn-quick-approve" data-email="${item.email}" data-name="${item.name || ''}" data-role="ADMIN" style="background: #d97706; border-color: #d97706; color: #fff; font-size: 0.72rem; padding: 0.25rem 0.45rem; font-weight: 600;" title="Duyệt quyền Quản trị viên (Admin)">
                            👑 Admin
                        </button>
                        <button type="button" class="btn btn-sm btn-danger btn-quick-reject" data-email="${item.email}" style="font-size: 0.72rem; padding: 0.25rem 0.45rem;" title="Từ chối yêu cầu">
                            ❌
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderUserTableRows(list) {
        if (!list || list.length === 0) {
            return `<tr><td colspan="3" style="text-align: center; color: #94a3b8; padding: 1.5rem;">Chưa có nhân viên nào được phân quyền hoạt động.</td></tr>`;
        }

        return list.map(item => {
            const isSuper = item.email.toLowerCase() === getSuperAdminEmail();
            const curRole = (item.role || 'DAU_XUAT').trim().toUpperCase();

            let roleSelectHtml = '';
            if (isSuper) {
                roleSelectHtml = `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; font-size: 0.76rem; font-weight: 700; padding: 0.25rem 0.5rem;">👑 Super Admin (Tối cao)</span>`;
            } else {
                let bg = 'rgba(59, 130, 246, 0.18)';
                let color = '#60a5fa';
                let border = '#3b82f6';
                if (curRole === 'DAU_NHAP') {
                    bg = 'rgba(0, 161, 154, 0.18)';
                    color = '#2dd4bf';
                    border = '#00a19a';
                } else if (curRole === 'XUAT_NHAP' || curRole === 'BOTH') {
                    bg = 'rgba(168, 85, 247, 0.18)';
                    color = '#c084fc';
                    border = '#a855f7';
                } else if (curRole === 'ADMIN' || curRole === 'SUPER_ADMIN') {
                    bg = 'rgba(245, 158, 11, 0.2)';
                    color = '#fbbf24';
                    border = '#f59e0b';
                }

                roleSelectHtml = `
                    <select class="select-user-role-inline" 
                            data-email="${item.email}" 
                            data-name="${item.name || ''}" 
                            data-current-role="${curRole}"
                            title="Bấm để thay đổi vị trí của nhân viên"
                            style="padding: 0.28rem 0.55rem; 
                                   background: ${bg}; 
                                   color: ${color}; 
                                   border: 1px solid ${border}; 
                                   border-radius: 6px; 
                                   font-size: 0.78rem; 
                                   font-weight: 700; 
                                   cursor: pointer; 
                                   outline: none;
                                   transition: all 0.2s ease;">
                        <option value="DAU_XUAT" ${curRole === 'DAU_XUAT' ? 'selected' : ''} style="background: #0f172a; color: #60a5fa;">📤 Đầu Xuất</option>
                        <option value="DAU_NHAP" ${curRole === 'DAU_NHAP' ? 'selected' : ''} style="background: #0f172a; color: #2dd4bf;">📥 Đầu Nhập</option>
                        <option value="XUAT_NHAP" ${(curRole === 'XUAT_NHAP' || curRole === 'BOTH') ? 'selected' : ''} style="background: #0f172a; color: #c084fc;">🔄 Cả Xuất & Nhập</option>
                        <option value="ADMIN" ${(curRole === 'ADMIN' || curRole === 'SUPER_ADMIN') ? 'selected' : ''} style="background: #0f172a; color: #fbbf24;">👑 Admin (Quản trị)</option>
                    </select>
                `;
            }

            const displayName = item.name ? `<strong>${item.name}</strong><br><span style="font-size: 0.75rem; color: #94a3b8;">${item.email}</span>` : `<span style="color: #f8fafc; font-weight: 600;">${item.email}</span>`;

            const actionBtn = isSuper ?
                `<span style="font-size: 0.72rem; color: #64748b; font-style: italic;">Mặc định</span>` :
                `<button type="button" class="btn btn-danger btn-sm btn-delete-user" data-email="${item.email}" style="font-size: 0.7rem; padding: 0.2rem 0.45rem;">Thu hồi</button>`;

            return `
                <tr style="border-bottom: 1px solid #334155;">
                    <td style="padding: 0.5rem 0.75rem;">${displayName}</td>
                    <td style="padding: 0.5rem; text-align: center;">${roleSelectHtml}</td>
                    <td style="padding: 0.5rem; text-align: center;">${actionBtn}</td>
                </tr>
            `;
        }).join('');
    }

    function openUserManagementModal() {
        if (!isAdmin()) {
            alert('Chỉ có Quản trị viên (Admin) mới có quyền truy cập trang này!');
            return;
        }

        const existing = document.getElementById('modal-user-management');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-user-management';
        modal.className = 'pilot-modal-overlay';

        function buildModalHtml() {
            const permissions = getCachedPermissions();
            const pendingUsers = permissions.filter(p => (p.status || '').trim().toUpperCase() === 'CHO_DUYET');
            const activeUsers = permissions.filter(p => (p.status || '').trim().toUpperCase() !== 'CHO_DUYET' && (p.status || '').trim().toUpperCase() !== 'DELETED');

            const pendingBlockHtml = pendingUsers.length > 0 ? `
                <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid #f59e0b; border-radius: 8px; padding: 0.85rem; margin-bottom: 1.25rem;">
                    <div style="font-weight: 700; font-size: 0.88rem; color: #fbbf24; margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center;">
                        <span style="display: flex; align-items: center; gap: 6px;">
                            <span>🔔</span> HÀNG CHỜ PHÊ DUYỆT (${pendingUsers.length} yêu cầu mới)
                        </span>
                        <span style="font-size: 0.72rem; color: #cbd5e1; font-weight: normal;">1-click duyệt vào ca trực</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 220px; overflow-y: auto;">
                        ${renderPendingQueueItems(pendingUsers)}
                    </div>
                </div>
            ` : `
                <div style="background: rgba(16, 185, 129, 0.08); border: 1px dashed rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 0.6rem 0.85rem; margin-bottom: 1rem; font-size: 0.8rem; color: #6ee7b7; display: flex; align-items: center; gap: 8px;">
                    <span>✅</span> Hiện không có yêu cầu nào trong hàng chờ duyệt.
                </div>
            `;

            return `
                <div class="pilot-modal" style="max-width: 680px;">
                    <div class="pilot-modal-header">
                        <span class="pilot-modal-title">👥 QUẢN LÝ PHÂN QUYỀN NHÂN VIÊN KHO</span>
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-close-users-modal">✕</button>
                    </div>

                    <div style="background: rgba(49, 46, 129, 0.2); border: 1px solid #4338ca; border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 1rem; font-size: 0.82rem; color: #c7d2fe; line-height: 1.5;">
                        👑 <strong>Tổng Admin tối cao:</strong> ${getSuperAdminEmail()} (Toàn quyền quản trị kho & duyệt nhân viên).<br>
                        🛡️ <strong>Quản Trị Viên (Admin):</strong> Toàn quyền phân quyền, duyệt nhân sự và thiết lập cấu hình kho.
                    </div>

                    ${pendingBlockHtml}

                    <!-- Add New User Form -->
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.85rem; margin-bottom: 1.25rem;">
                        <div style="font-weight: 700; font-size: 0.85rem; color: #38bdf8; margin-bottom: 0.5rem;">
                            ➕ CHỦ ĐỘNG CẤP QUYỀN CHO NHÂN VIÊN
                        </div>
                        <div style="display: grid; grid-template-columns: 1.3fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <input type="email" id="input-new-user-email" placeholder="Email nhân viên (@ghn.vn hoặc Gmail)..." style="padding: 0.5rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; font-size: 0.85rem;">
                            <select id="select-new-user-role" style="padding: 0.5rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; font-size: 0.83rem; font-weight: 600;">
                                <option value="DAU_XUAT">📤 Nhân viên Đầu Xuất</option>
                                <option value="DAU_NHAP">📥 Nhân viên Đầu Nhập</option>
                                <option value="XUAT_NHAP">🔄 Phụ trách Cả Xuất & Nhập</option>
                                <option value="ADMIN">👑 Quản Trị Viên (Admin)</option>
                            </select>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span id="perm-action-msg" style="font-size: 0.8rem; font-weight: 600;"></span>
                            <button type="button" class="btn btn-primary btn-sm" id="btn-submit-add-user">
                                💾 Cấp Quyền Cho Nhân Viên
                            </button>
                        </div>
                    </div>

                    <!-- Current Active Users List -->
                    <div style="font-weight: 700; font-size: 0.85rem; color: #cbd5e1; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>DANH SÁCH NHÂN SỰ ĐANG HOẠT ĐỘNG (${activeUsers.length}):</span>
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-refresh-perms" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;">🔄 Tải lại</button>
                    </div>

                    <div style="max-height: 220px; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; background: rgba(15, 23, 42, 0.6); margin-bottom: 1rem;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
                            <thead>
                                <tr style="background: #1e293b; color: #94a3b8; text-align: left;">
                                    <th style="padding: 0.5rem 0.75rem;">Email / Tên</th>
                                    <th style="padding: 0.5rem; text-align: center;">Vị Trí (Bấm đổi)</th>
                                    <th style="padding: 0.5rem; text-align: center; width: 90px;">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody id="user-perm-table-body">
                                ${renderUserTableRows(activeUsers)}
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
        }

        function refreshModalContent() {
            modal.innerHTML = buildModalHtml();
            wireModalListeners();
            updateAdminPendingBadge(getCachedPermissions());
        }

        function wireModalListeners() {
            document.getElementById('btn-close-users-modal')?.addEventListener('click', () => modal.remove());
            document.getElementById('btn-close-users-modal-2')?.addEventListener('click', () => modal.remove());

            const roleNameMap = {
                'DAU_XUAT': '📤 Đầu Xuất',
                'DAU_NHAP': '📥 Đầu Nhập',
                'XUAT_NHAP': '🔄 Cả Xuất & Nhập',
                'ADMIN': '👑 Quản Trị Viên (Admin)'
            };

            // Refresh permissions
            document.getElementById('btn-refresh-perms')?.addEventListener('click', async () => {
                const btn = document.getElementById('btn-refresh-perms');
                if (btn) btn.textContent = '⏳ Đang tải...';
                await fetchPermissionsFromSheet();
                refreshModalContent();
            });

            // Quick approve buttons
            modal.querySelectorAll('.btn-quick-approve').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const email = btn.getAttribute('data-email');
                    const role = btn.getAttribute('data-role');
                    const name = btn.getAttribute('data-name');
                    btn.disabled = true;
                    btn.textContent = '⏳...';
                    const res = await assignPermission(email, role, name);
                    if (res && res.success) {
                        const roleLabel = roleNameMap[role] || role;
                        if (typeof window.showToast === 'function') {
                            window.showToast(`✅ Đã duyệt ${email} vào ${roleLabel}!`, 'success');
                        } else if (typeof window.showToastNotification === 'function') {
                            window.showToastNotification(`✅ Đã duyệt ${email} vào ${roleLabel}!`, 'SUCCESS');
                        }
                    } else {
                        alert(res && res.message ? res.message : 'Lỗi duyệt nhân viên!');
                    }
                    refreshModalContent();
                });
            });

            // Inline role switch in active users table
            modal.querySelectorAll('.select-user-role-inline').forEach(select => {
                select.addEventListener('change', async () => {
                    const email = select.getAttribute('data-email');
                    const name = select.getAttribute('data-name');
                    const newRole = select.value;
                    const prevRole = select.getAttribute('data-current-role');
                    select.disabled = true;

                    const roleLabel = roleNameMap[newRole] || newRole;
                    const res = await assignPermission(email, newRole, name);
                    if (res && res.success) {
                        if (typeof window.showToast === 'function') {
                            window.showToast(`✅ Đã chuyển vị trí của ${email} sang ${roleLabel}!`, 'success');
                        } else if (typeof window.showToastNotification === 'function') {
                            window.showToastNotification(`✅ Đã chuyển vị trí của ${email} sang ${roleLabel}!`, 'SUCCESS');
                        }
                        refreshModalContent();
                    } else {
                        alert((res && res.message) || 'Lỗi cập nhật vị trí nhân viên!');
                        select.value = prevRole;
                        select.disabled = false;
                    }
                });
            });

            // Quick reject buttons
            modal.querySelectorAll('.btn-quick-reject').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const email = btn.getAttribute('data-email');
                    if (confirm(`Từ chối yêu cầu của ${email}?`)) {
                        btn.disabled = true;
                        btn.textContent = '⏳...';
                        await revokePermission(email);
                        refreshModalContent();
                    }
                });
            });

            // Add user submit
            document.getElementById('btn-submit-add-user')?.addEventListener('click', async () => {
                const emailInput = document.getElementById('input-new-user-email');
                const roleSelect = document.getElementById('select-new-user-role');
                const msg = document.getElementById('perm-action-msg');
                const email = emailInput?.value.trim();
                const role = roleSelect?.value;

                if (!email) {
                    if (msg) {
                        msg.style.color = '#ef4444';
                        msg.textContent = 'Vui lòng nhập email!';
                    }
                    return;
                }

                if (msg) {
                    msg.style.color = '#f59e0b';
                    msg.textContent = '⏳ Đang lưu phân quyền...';
                }

                const res = await assignPermission(email, role);
                if (res.success) {
                    if (msg) {
                        msg.style.color = '#10b981';
                        msg.textContent = '✅ Đã cấp quyền!';
                    }
                    if (emailInput) emailInput.value = '';
                    refreshModalContent();
                } else {
                    if (msg) {
                        msg.style.color = '#ef4444';
                        msg.textContent = res.message ? `❌ ${res.message}` : '❌ Lỗi cấp quyền!';
                    }
                }
            });

            // Delete active user buttons
            modal.querySelectorAll('.btn-delete-user').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const target = btn.getAttribute('data-email');
                    if (confirm(`Bạn có chắc muốn thu hồi quyền của nhân viên ${target}?`)) {
                        btn.disabled = true;
                        btn.textContent = '⏳...';
                        await revokePermission(target);
                        refreshModalContent();
                    }
                });
            });

            // Save Google Client ID
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
        }

        modal.innerHTML = buildModalHtml();
        document.body.appendChild(modal);
        wireModalListeners();
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
        const authDivider = document.getElementById('auth-divider');
        const inputClientId = document.getElementById('input-google-client-id');

        if (inputClientId && clientId) {
            inputClientId.value = clientId;
        }

        if (!clientId) {
            // No Client ID: Gracefully fallback to Email login without locking mobile screen
            if (btnSlot) btnSlot.style.display = 'none';
            if (loadingText) loadingText.style.display = 'none';
            if (authDivider) authDivider.style.display = 'none';
            return;
        }

        // Client ID exists: Show Google Sign-In button and divider
        if (btnSlot) btnSlot.style.display = 'flex';
        if (authDivider) authDivider.style.display = 'flex';
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

                let targetWidth = 300;
                if (window.innerWidth < 360) {
                    targetWidth = Math.max(240, window.innerWidth - 60);
                }

                window.google.accounts.id.renderButton(btnSlot, {
                    theme: 'filled_blue',
                    size: 'large',
                    text: 'signin_with',
                    shape: 'rectangular',
                    logo_alignment: 'left',
                    width: targetWidth
                });

                gisInitialized = true;
                if (loadingText) loadingText.style.display = 'none';

                // Attempt One Tap prompt
                try {
                    window.google.accounts.id.prompt();
                } catch (e) {}

            } catch (err) {
                console.warn('Lỗi khởi tạo Google Identity Services:', err);
                if (btnSlot) {
                    btnSlot.innerHTML = `<div style="color: #f59e0b; font-size: 0.78rem; text-align: center;">💡 Mở tùy chọn dự phòng bên dưới để vào ca</div>`;
                }
                const fallbackAcc = document.querySelector('.fallback-auth-accordion');
                if (fallbackAcc) fallbackAcc.open = true;
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
                } else if (attempts > 50) {
                    clearInterval(timer);
                    if (loadingText) {
                        loadingText.innerHTML = '<span style="color: #f59e0b; font-size: 0.78rem;">⚠️ Google SDK kết nối chậm. Bạn có thể mở mục dự phòng bên dưới để vào ca.</span>';
                    }
                    const fallbackAcc = document.querySelector('.fallback-auth-accordion');
                    if (fallbackAcc) fallbackAcc.open = true;
                }
            }, 100);
        }
    }

    // Expose for instant Google SDK onload trigger
    window.initGoogleIdentity = initGoogleIdentity;

    async function handleGoogleCredentialResponse(response) {
        if (!response || !response.credential) {
            alert('Đăng nhập Google thất bại hoặc bị hủy.');
            return;
        }
        saveGoogleIdToken(response.credential);
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

            // Connect Quick Email Login Form
            const formQuickLogin = document.getElementById('form-quick-login');
            if (formQuickLogin) {
                formQuickLogin.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const input = document.getElementById('login-email-input');
                    const email = input ? input.value.trim() : '';
                    if (!email) {
                        alert('Vui lòng nhập địa chỉ email hợp lệ!');
                        return;
                    }
                    loginWithEmail(email);
                });
            }

            // Connect Domain Autocomplete Chips
            document.querySelectorAll('.domain-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const domain = chip.getAttribute('data-domain');
                    const input = document.getElementById('login-email-input');
                    if (!input) return;
                    let val = input.value.trim();
                    if (!val) {
                        input.value = domain.startsWith('@') ? domain.slice(1) : domain;
                        input.focus();
                        return;
                    }
                    if (val.includes('@')) {
                        val = val.split('@')[0];
                    }
                    input.value = val + domain;
                    input.focus();
                });
            });

            // Connect 1-tap Super Admin bypass button
            const btnQuickAdmin = document.getElementById('btn-quick-login-admin');
            if (btnQuickAdmin) {
                btnQuickAdmin.addEventListener('click', () => {
                    loginWithEmail('tuanns@ghn.vn', 'Nguyễn Sơn Tuấn');
                });
            }
        },
        getCurrentUser,
        isSuperAdmin,
        isAdmin,
        getUserRole: () => {
            const u = getCurrentUser();
            return u ? (u.role || resolveUserRole(u.email)) : 'UNAUTHORIZED';
        },
        getGoogleClientId,
        setGoogleClientId,
        loginWithEmail,
        logout,
        requestAccess,
        startApprovalPolling,
        stopApprovalPolling,
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
