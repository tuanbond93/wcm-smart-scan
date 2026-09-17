// =============================================================================
// WCM SMART SCAN - DATA ADAPTER ABSTRACTION LAYER
// Cho phép chuyển đổi linh hoạt giữa Google Sheets Web App và Supabase REST/Realtime
// =============================================================================

(function() {
    'use strict';

    /**
     * Interface chuẩn DataAdapter
     */
    class BaseDataAdapter {
        async recordScan(scanData) { throw new Error("Not implemented"); }
        async undoScan(payload) { throw new Error("Not implemented"); }
        async fetchTripManifest(tripCode) { throw new Error("Not implemented"); }
        async syncPeerScans(tripCode, mode) { throw new Error("Not implemented"); }
        async getAllTripsProgress() { throw new Error("Not implemented"); }
        async getPermissions() { throw new Error("Not implemented"); }
        async updatePermission(data) { throw new Error("Not implemented"); }
        async requestAccess(data) { throw new Error("Not implemented"); }
    }

    /**
     * Adapter cho Google Sheets Web App (Apps Script)
     */
    class GoogleSheetsAdapter extends BaseDataAdapter {
        constructor() {
            super();
            this.name = "GoogleSheets";
        }

        async recordScan(scanData) {
            if (window.OnlineSync && window.OnlineSync.recordScan) {
                return window.OnlineSync.recordScan(scanData);
            }
            return { status: "OFFLINE_QUEUED" };
        }

        async undoScan(payload) {
            if (window.OnlineSync && window.OnlineSync.undoScan) {
                return window.OnlineSync.undoScan(payload);
            }
            return { status: "OFFLINE_QUEUED" };
        }

        async fetchTripManifest(tripCode) {
            if (window.OnlineSync && window.OnlineSync.fetchTripManifest) {
                return window.OnlineSync.fetchTripManifest(tripCode);
            }
            throw new Error("OnlineSync chưa được tải!");
        }

        async syncPeerScans(tripCode, mode = "Xuất") {
            const url = window.OnlineSync ? window.OnlineSync.getScriptUrl() : "";
            if (!url) return { status: "ERROR", message: "Chưa cấu hình URL" };

            const sep = url.includes("?") ? "&" : "?";
            const reqUrl = `${url}${sep}action=sync_peer_scans&tripCode=${encodeURIComponent(tripCode)}&mode=${encodeURIComponent(mode)}&_t=${Date.now()}`;
            const res = await fetch(reqUrl, { method: "GET", mode: "cors" });
            return await res.json();
        }

        async getAllTripsProgress() {
            if (window.OnlineSync && window.OnlineSync.getAllTripsProgress) {
                return window.OnlineSync.getAllTripsProgress();
            }
            return [];
        }

        async getPermissions() {
            const url = window.OnlineSync ? window.OnlineSync.getScriptUrl() : "";
            if (!url) return [];
            const sep = url.includes("?") ? "&" : "?";
            const reqUrl = `${url}${sep}action=get_permissions&_t=${Date.now()}`;
            const res = await fetch(reqUrl, { method: "GET", mode: "cors" });
            const data = await res.json();
            return data.permissions || [];
        }

        async updatePermission(payload) {
            const url = window.OnlineSync ? window.OnlineSync.getScriptUrl() : "";
            if (!url) throw new Error("Chưa cấu hình URL Google Sheets");

            const res = await fetch(url, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                    action: "update_permission",
                    ...payload
                })
            });
            return await res.json();
        }

        async requestAccess(payload) {
            const url = window.OnlineSync ? window.OnlineSync.getScriptUrl() : "";
            if (!url) throw new Error("Chưa cấu hình URL Google Sheets");

            const res = await fetch(url, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                    action: "request_access",
                    email: payload.email,
                    name: payload.name,
                    desiredRole: payload.desiredRole
                })
            });
            return await res.json();
        }
    }

    /**
     * Adapter cho Supabase REST & Realtime Database
     */
    class SupabaseAdapter extends BaseDataAdapter {
        constructor(supabaseUrl, anonKey) {
            super();
            this.name = "Supabase";
            this.baseUrl = (supabaseUrl || "").replace(/\/+$/, "");
            this.apiKey = anonKey || "";
        }

        _getHeaders() {
            return {
                "apikey": this.apiKey,
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            };
        }

        async recordScan(scanData) {
            if (!this.baseUrl || !this.apiKey) {
                console.warn("[SupabaseAdapter] Chưa cấu hình Supabase URL hoặc Anon Key!");
                return { status: "ERROR", message: "Supabase unconfigured" };
            }

            const table = scanData.action === "inbound_scan" ? "inbound_scans" : "export_scans";
            const row = {
                trip_code: scanData.tripCode,
                operator_code: scanData.operatorCode,
                package_code: scanData.packageCode,
                do_number: scanData.doNumber,
                ch_code: scanData.chCode,
                store_name: scanData.storeName,
                pkg_idx_text: scanData.pkgIdxText,
                status: scanData.status || "Hợp lệ",
                raw_barcode: scanData.rawBarcode,
                scanned_at: scanData.timestamp || new Date().toISOString()
            };

            const res = await fetch(`${this.baseUrl}/rest/v1/${table}`, {
                method: "POST",
                headers: this._getHeaders(),
                body: JSON.stringify(row)
            });

            if (!res.ok) throw new Error(`Supabase insert failed: ${res.statusText}`);
            return { status: "SUCCESS" };
        }

        async undoScan(payload) {
            const table = "export_scans";
            const url = `${this.baseUrl}/rest/v1/${table}?trip_code=eq.${encodeURIComponent(payload.tripCode)}&package_code=eq.${encodeURIComponent(payload.packageCode)}`;
            const res = await fetch(url, {
                method: "PATCH",
                headers: this._getHeaders(),
                body: JSON.stringify({ status: "ĐÃ_HỦY_QUÉT_NHẦM" })
            });
            if (!res.ok) throw new Error(`Supabase undo failed: ${res.statusText}`);
            return { status: "SUCCESS" };
        }

        async fetchTripManifest(tripCode) {
            const url = `${this.baseUrl}/rest/v1/export_scans?trip_code=eq.${encodeURIComponent(tripCode)}&status=neq.ĐÃ_HỦY_QUÉT_NHẦM&select=*`;
            const res = await fetch(url, { headers: this._getHeaders() });
            if (!res.ok) throw new Error(`Supabase query failed: ${res.statusText}`);
            const data = await res.json();
            return {
                status: "SUCCESS",
                tripCode: tripCode,
                packages: data
            };
        }

        async syncPeerScans(tripCode, mode = "Xuất") {
            const table = mode === "Nhập" ? "inbound_scans" : "export_scans";
            const url = `${this.baseUrl}/rest/v1/${table}?trip_code=eq.${encodeURIComponent(tripCode)}&status=neq.ĐÃ_HỦY_QUÉT_NHẦM&select=package_code,operator_code,scanned_at`;
            const res = await fetch(url, { headers: this._getHeaders() });
            if (!res.ok) throw new Error(`Supabase query failed: ${res.statusText}`);
            const data = await res.json();
            return {
                status: "SUCCESS",
                tripCode: tripCode,
                scannedItems: data.map(d => ({
                    packageCode: d.package_code,
                    operator: d.operator_code,
                    timestamp: d.scanned_at
                }))
            };
        }

        async getAllTripsProgress() {
            const url = `${this.baseUrl}/rest/v1/export_scans?status=neq.ĐÃ_HỦY_QUÉT_NHẦM&select=trip_code,store_name,ch_code,operator_code,scanned_at`;
            const res = await fetch(url, { headers: this._getHeaders() });
            if (!res.ok) return [];
            const rows = await res.json();

            const tripsMap = {};
            rows.forEach(r => {
                const trip = r.trip_code;
                if (!trip) return;
                if (!tripsMap[trip]) {
                    tripsMap[trip] = {
                        tripCode: trip,
                        totalExported: 0,
                        totalInbound: 0,
                        stores: {},
                        operators: {},
                        lastActive: r.scanned_at
                    };
                }
                const t = tripsMap[trip];
                t.totalExported++;
                const sKey = r.ch_code || r.store_name || "CH";
                if (!t.stores[sKey]) {
                    t.stores[sKey] = { code: r.ch_code, name: r.store_name, count: 0 };
                }
                t.stores[sKey].count++;
                const op = r.operator_code || "NV";
                t.operators[op] = (t.operators[op] || 0) + 1;
            });

            return Object.values(tripsMap).map(t => ({
                tripCode: t.tripCode,
                totalExported: t.totalExported,
                totalInbound: t.totalInbound,
                stores: Object.values(t.stores),
                operators: t.operators,
                lastActive: t.lastActive
            }));
        }

        async getPermissions() {
            const url = `${this.baseUrl}/rest/v1/user_permissions?select=*`;
            const res = await fetch(url, { headers: this._getHeaders() });
            if (!res.ok) return [];
            return await res.json();
        }

        async updatePermission(payload) {
            const url = `${this.baseUrl}/rest/v1/user_permissions`;
            const res = await fetch(url, {
                method: "POST",
                headers: { ...this._getHeaders(), "Prefer": "resolution=merge-duplicates" },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`Supabase update permission failed: ${res.statusText}`);
            return { status: "SUCCESS" };
        }

        async requestAccess(payload) {
            if (!this.baseUrl || !this.apiKey) {
                return { status: "ERROR", message: "Supabase unconfigured" };
            }
            const row = {
                email: (payload.email || "").trim().toLowerCase(),
                name: payload.name || "",
                role: payload.desiredRole || "DAU_XUAT",
                status: "CHO_DUYET",
                assigned_by: "Tự đăng ký",
                assigned_at: new Date().toISOString()
            };
            const res = await fetch(`${this.baseUrl}/rest/v1/user_permissions`, {
                method: "POST",
                headers: { ...this._getHeaders(), "Prefer": "resolution=merge-duplicates" },
                body: JSON.stringify(row)
            });
            if (!res.ok) throw new Error(`Supabase request access failed: ${res.statusText}`);
            return { status: "SUCCESS", role: row.role, userStatus: "CHO_DUYET" };
        }
    }

    // Factory method
    function createAdapter() {
        const backend = (window.WCM_CONFIG && window.WCM_CONFIG.BACKEND) || 'google_sheets';
        if (backend === 'supabase' && window.WCM_CONFIG.SUPABASE_URL) {
            return new SupabaseAdapter(window.WCM_CONFIG.SUPABASE_URL, window.WCM_CONFIG.SUPABASE_ANON_KEY);
        }
        return new GoogleSheetsAdapter();
    }

    window.WCM_DATA_ADAPTER = createAdapter();
    window.GoogleSheetsAdapter = GoogleSheetsAdapter;
    window.SupabaseAdapter = SupabaseAdapter;

    console.log(`[DataAdapter] Đang sử dụng adapter: ${window.WCM_DATA_ADAPTER.name}`);
})();
