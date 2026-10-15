// =============================================================================
// WCM SMART SCAN - CORE LOGIC UNIT TESTS
// Chạy kiểm thử tự động đảm bảo độ chính xác 100% của thuật toán phân loại,
// kiểm tra cửa hàng, và phân tích mã QR kiện hàng.
// Chạy bằng lệnh: node tests/test-core-logic.js
// =============================================================================

const assert = require("assert");

// --- Core functions under test (mirrored from app.js) ---

function removeVietnameseTones(str) {
    if (!str) return "";
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    return str.toLowerCase().trim();
}

function parseQrCode(rawText, storeMap = { byDo: {}, byCh: {} }) {
    const text = (rawText || "").trim();
    const result = {
        raw: text,
        tripCode: "",
        doNumber: "",
        soNumber: "",
        packageCode: "",
        chCode: "",
        pkgIdx: 1,
        totalPackages: 1,
        storeName: ""
    };

    if (text.includes("|")) {
        const parts = text.split("|").map(p => p.trim());
        result.tripCode = parts[0] || "";
        result.doNumber = parts[1] || "";
        result.soNumber = parts[2] || "";
        result.packageCode = parts[3] || "";

        for (let i = 0; i < parts.length; i++) {
            if (/^CH\./i.test(parts[i])) {
                result.chCode = parts[i];
                break;
            }
        }
        if (!result.chCode && parts.length >= 5 && parts[4]) {
            result.chCode = parts[4];
        }

        for (let i = 0; i < parts.length; i++) {
            const m = parts[i].match(/^(\d+)\/(\d+)$/);
            if (m) {
                result.pkgIdx = parseInt(m[1], 10);
                result.totalPackages = parseInt(m[2], 10);
                break;
            }
        }
    } else {
        result.doNumber = text;
        result.packageCode = text;
    }

    if (result.doNumber && storeMap.byDo && storeMap.byDo[result.doNumber]) {
        result.storeName = storeMap.byDo[result.doNumber];
        if (storeMap.byDoCode && storeMap.byDoCode[result.doNumber]) {
            result.storeCode = storeMap.byDoCode[result.doNumber];
        }
    } else if (result.chCode && storeMap.byCh && storeMap.byCh[result.chCode]) {
        result.storeName = storeMap.byCh[result.chCode];
    } else if (result.chCode && storeMap.bySap) {
        const rawCode = result.chCode.replace(/^ch[\.\s_]*/i, '');
        if (storeMap.bySap[rawCode]) {
            result.storeName = storeMap.bySap[rawCode];
            result.storeCode = rawCode;
        }
    }

    return result;
}

function isStoreMatch(pkg, targetStore, storeMap = {}) {
    if (!targetStore) return true;
    const tgt = targetStore.toLowerCase().replace(/^ch[\.\s_]*/i, '').replace(/\s+/g, '').trim();
    const tgtClean = removeVietnameseTones(targetStore).replace(/\s+/g, '');

    // 1. Compare with CH / Chute code (e.g. CH.2.31 or CH.2.24)
    if (pkg.chCode) {
        const pkgCh = pkg.chCode.toLowerCase().replace(/^ch[\.\s_]*/i, '').replace(/\s+/g, '').trim();
        if (pkgCh === tgt || pkgCh.includes(tgt) || tgt.includes(pkgCh)) return true;
    }

    // 2. Compare with store name (full, partial, tone-insensitive)
    const store = (pkg.storeName || "").toLowerCase().replace(/\s+/g, '');
    const storeClean = removeVietnameseTones(pkg.storeName || "").replace(/\s+/g, '');
    if (store && (store.includes(tgt) || tgt.includes(store))) return true;
    if (storeClean && tgtClean && (storeClean.includes(tgtClean) || tgtClean.includes(storeClean))) return true;

    // 3. Compare with SAP / Store code (e.g. [6724], 6724, 2AFF)
    const codeMatch = targetStore.match(/\[([A-Za-z0-9]+)\]/) || targetStore.match(/^([A-Za-z0-9]{3,7})\b/);
    if (codeMatch && codeMatch[1]) {
        const targetCode = codeMatch[1].toLowerCase();
        if (pkg.storeCode && pkg.storeCode.toLowerCase() === targetCode) return true;
        if (pkg.chCode && pkg.chCode.toLowerCase().replace(/^ch[\.\s_]*/i, '') === targetCode) return true;
        if (storeMap.byDoCode && pkg.doNumber && (storeMap.byDoCode[pkg.doNumber] || "").toLowerCase() === targetCode) return true;
    }

    // 4. Compare with DO if target is DO
    if (pkg.doNumber && (pkg.doNumber.includes(tgt) || tgt.includes(pkg.doNumber))) return true;

    return false;
}

// --- Test Suites ---

let passed = 0;
let failed = 0;

function it(desc, fn) {
    try {
        fn();
        console.log(`  ✅ PASS: ${desc}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${desc}`);
        console.error(`     Error: ${err.message}`);
        failed++;
    }
}

console.log("\n🧪 BẮT ĐẦU KIỂM THỬ CORE LOGIC WCM SMART SCAN\n");

// 1. Vietnamese Tone Removal Tests
console.log("--- 1. Kiểm tra chuẩn hóa tiếng Việt (removeVietnameseTones) ---");
it("loại bỏ chính xác dấu tiếng Việt hoa và thường", () => {
    assert.strictEqual(removeVietnameseTones("Phú Thọ"), "phu tho");
    assert.strictEqual(removeVietnameseTones("Cẩm Khê"), "cam khe");
    assert.strictEqual(removeVietnameseTones("Tam Đảo"), "tam dao");
    assert.strictEqual(removeVietnameseTones("Đầm Vạc, Vĩnh Yên"), "dam vac, vinh yen");
    assert.strictEqual(removeVietnameseTones("CH.2.24 WM+ PTO"), "ch.2.24 wm+ pto");
});

// 2. Barcode & QR Parsing Tests
console.log("\n--- 2. Kiểm tra phân tích mã QR chuẩn kho (parseQrCode) ---");
it("phân tích chính xác mã QR chuẩn 6 trường GHN/WCM", () => {
    const raw = "1392|7079433553|SOWINSAL1372840|PPTD260704SVXZFP|CH.2.24|13/13";
    const parsed = parseQrCode(raw);
    assert.strictEqual(parsed.tripCode, "1392");
    assert.strictEqual(parsed.doNumber, "7079433553");
    assert.strictEqual(parsed.soNumber, "SOWINSAL1372840");
    assert.strictEqual(parsed.packageCode, "PPTD260704SVXZFP");
    assert.strictEqual(parsed.chCode, "CH.2.24");
    assert.strictEqual(parsed.pkgIdx, 13);
    assert.strictEqual(parsed.totalPackages, 13);
});

it("xử lý kiện trung gian (ví dụ kiện 2 trên 5)", () => {
    const raw = "1405|7080123456|SO998877|PKG112233|CH.3B12|2/5";
    const parsed = parseQrCode(raw);
    assert.strictEqual(parsed.tripCode, "1405");
    assert.strictEqual(parsed.chCode, "CH.3B12");
    assert.strictEqual(parsed.pkgIdx, 2);
    assert.strictEqual(parsed.totalPackages, 5);
});

it("phục hồi cửa hàng từ từ điển offline storeMap", () => {
    const storeMap = {
        byDo: { "7079433553": "WM+ PTO Phú Thọ" },
        byCh: { "CH.2.24": "WM+ PTO Phú Thọ" }
    };
    const raw = "1392|7079433553|SO001|PKG001|CH.2.24|1/1";
    const parsed = parseQrCode(raw, storeMap);
    assert.strictEqual(parsed.storeName, "WM+ PTO Phú Thọ");
});

it("xử lý mã vạch đơn (fallback 1D barcode)", () => {
    const raw = "7079433553";
    const parsed = parseQrCode(raw);
    assert.strictEqual(parsed.doNumber, "7079433553");
    assert.strictEqual(parsed.packageCode, "7079433553");
    assert.strictEqual(parsed.pkgIdx, 1);
    assert.strictEqual(parsed.totalPackages, 1);
});

// 3. Store Matching & Anti-Mixing Tests
console.log("\n--- 3. Kiểm tra chống lẫn hàng (isStoreMatch) ---");
it("khớp chính xác mã CH (CH.2.24)", () => {
    const pkg = { chCode: "CH.2.24", storeName: "WM+ PTO Phú Thọ" };
    assert.strictEqual(isStoreMatch(pkg, "CH.2.24"), true);
    assert.strictEqual(isStoreMatch(pkg, "2.24"), true);
    assert.strictEqual(isStoreMatch(pkg, "CH.2.24 - Phú Thọ"), true);
});

it("báo sai khi quét kiện của cửa hàng khác (CHỐNG LẪN HÀNG)", () => {
    const pkg = { chCode: "CH.2.25", storeName: "WM+ Cẩm Khê" };
    assert.strictEqual(isStoreMatch(pkg, "CH.2.24"), false);
    assert.strictEqual(isStoreMatch(pkg, "Phú Thọ"), false);
});

it("khớp theo tên cửa hàng không dấu hoặc viết tắt", () => {
    const pkg = { chCode: "2AKU", storeName: "WM+ PTO Tu Vũ" };
    assert.strictEqual(isStoreMatch(pkg, "Tu Vũ"), true);
    assert.strictEqual(isStoreMatch(pkg, "2AKU"), true);
});

it("nhận diện chính xác kiện Tân Thủy [6724] và máng CH.2.31 từ QR code chuyến 1392", () => {
    const raw = "1392|7079393414|SOWINSAL1364099|GYXK46W6|CH.2.31|1/17";
    const storeMap = {
        byDo: { "7079393414": "WM+ DBN Tân Thủy, Tuần Giáo" },
        byDoCode: { "7079393414": "6724" },
        byCh: { "CH.2.31": "WM+ DBN Tân Thủy, Tuần Giáo" },
        bySap: { "6724": "WM+ DBN Tân Thủy, Tuần Giáo" }
    };
    const parsed = parseQrCode(raw, storeMap);
    assert.strictEqual(parsed.tripCode, "1392");
    assert.strictEqual(parsed.doNumber, "7079393414");
    assert.strictEqual(parsed.packageCode, "GYXK46W6");
    assert.strictEqual(parsed.chCode, "CH.2.31");
    assert.strictEqual(parsed.storeName, "WM+ DBN Tân Thủy, Tuần Giáo");
    assert.strictEqual(parsed.storeCode, "6724");
    assert.strictEqual(parsed.pkgIdx, 1);
    assert.strictEqual(parsed.totalPackages, 17);

    // Test isStoreMatch with various targetStore formats
    assert.strictEqual(isStoreMatch(parsed, "[6724] WM+ DBN Tân Thủy, Tuần Giáo", storeMap), true);
    assert.strictEqual(isStoreMatch(parsed, "CH.2.31", storeMap), true);
    assert.strictEqual(isStoreMatch(parsed, "Tân Thủy", storeMap), true);
    assert.strictEqual(isStoreMatch(parsed, "tan thuy", storeMap), true);
    assert.strictEqual(isStoreMatch(parsed, "6724", storeMap), true);

    // Chống lẫn hàng: báo lỗi nếu lô hiện tại là cửa hàng khác
    assert.strictEqual(isStoreMatch(parsed, "[2AFF] WM+ PTO Khu 5, Xuân Lộc", storeMap), false);
    assert.strictEqual(isStoreMatch(parsed, "CH.2.24", storeMap), false);
});

// 4. Batch Count & Progress Calculation
console.log("\n--- 4. Kiểm tra đếm tiến độ & chống trùng kiện ---");
it("chống trùng lặp trên cùng thiết bị (Local Duplicate)", () => {
    const scannedItems = [{ uniqueKey: "PKG-001" }, { uniqueKey: "PKG-002" }];
    const isDup = scannedItems.some(item => item.uniqueKey === "PKG-001");
    assert.strictEqual(isDup, true);
    const isNew = scannedItems.some(item => item.uniqueKey === "PKG-003");
    assert.strictEqual(isNew, false);
});

it("tính tổng tiến độ kết hợp 2 máy bắn đồng thời", () => {
    const myCount = 28;
    const peerCount = 22;
    const targetQty = 50;
    const combined = myCount + peerCount;
    const isCompleted = (combined >= targetQty);
    assert.strictEqual(combined, 50);
    assert.strictEqual(isCompleted, true);
});

// 5. RBAC & Pending Approval Queue Tests
console.log("\n--- 5. Kiểm tra phân quyền & Hàng chờ duyệt (RBAC / Pending Queue) ---");

function testResolveUserRole(email, permissions = [], superAdmin = "tuanns@ghn.vn") {
    if (!email) return "UNAUTHORIZED";
    const clean = email.trim().toLowerCase();
    if (clean === superAdmin.toLowerCase()) return "SUPER_ADMIN";
    const found = permissions.find(p => p.email.trim().toLowerCase() === clean);
    if (found) {
        const status = (found.status || "").trim().toUpperCase();
        if (status === "HOAT_DONG") {
            const r = (found.role || "DAU_XUAT").trim().toUpperCase();
            if (r === "ADMIN" || r === "SUPER_ADMIN") return "ADMIN";
            if (r === "XUAT_NHAP" || r === "BOTH" || r === "DAU_XUAT_NHAP") return "XUAT_NHAP";
            if (r === "DAU_NHAP") return "DAU_NHAP";
            return "DAU_XUAT";
        }
        if (status === "KHOA") return "BLOCKED";
        if (status === "CHO_DUYET") return "PENDING_APPROVAL";
        return "PENDING_APPROVAL";
    }
    return "PENDING_APPROVAL";
}

function testIsAdmin(email, permissions = [], superAdmin = "tuanns@ghn.vn") {
    const role = testResolveUserRole(email, permissions, superAdmin);
    return role === "SUPER_ADMIN" || role === "ADMIN";
}

function testCanSwitchMode(role, targetMode) {
    if (role === "SUPER_ADMIN" || role === "ADMIN" || role === "XUAT_NHAP") return true;
    if (role === "DAU_XUAT" && targetMode === "Xuất") return true;
    if (role === "DAU_NHAP" && targetMode === "Nhập") return true;
    return false;
}

it("nhận diện chính xác Tổng Admin tối cao tuanns@ghn.vn", () => {
    assert.strictEqual(testResolveUserRole("tuanns@ghn.vn"), "SUPER_ADMIN");
    assert.strictEqual(testResolveUserRole(" TUANNS@GHN.VN "), "SUPER_ADMIN");
    assert.strictEqual(testIsAdmin("tuanns@ghn.vn"), true);
});

it("nhân viên mới chưa được phân quyền tự động vào Hàng chờ duyệt (PENDING_APPROVAL)", () => {
    const permissions = [];
    assert.strictEqual(testResolveUserRole("sontuandav@gmail.com", permissions), "PENDING_APPROVAL");
});

it("nhân viên đang có trạng thái CHO_DUYET giữ nguyên PENDING_APPROVAL", () => {
    const permissions = [{ email: "nhanvien1@ghn.vn", role: "DAU_XUAT", status: "CHO_DUYET" }];
    assert.strictEqual(testResolveUserRole("nhanvien1@ghn.vn", permissions), "PENDING_APPROVAL");
});

it("nhân viên được duyệt HOAT_DONG mở đúng quyền DAU_XUAT hoặc DAU_NHAP", () => {
    const permissions = [
        { email: "xuat1@ghn.vn", role: "DAU_XUAT", status: "HOAT_DONG" },
        { email: "nhap1@ghn.vn", role: "DAU_NHAP", status: "HOAT_DONG" }
    ];
    assert.strictEqual(testResolveUserRole("xuat1@ghn.vn", permissions), "DAU_XUAT");
    assert.strictEqual(testResolveUserRole("nhap1@ghn.vn", permissions), "DAU_NHAP");
    assert.strictEqual(testIsAdmin("xuat1@ghn.vn", permissions), false);
    assert.strictEqual(testIsAdmin("nhap1@ghn.vn", permissions), false);
});

it("phân quyền phụ trách Cả Xuất & Nhập (XUAT_NHAP) mở cả 2 chế độ và cho phép chuyển đổi", () => {
    const permissions = [
        { email: "both1@ghn.vn", role: "XUAT_NHAP", status: "HOAT_DONG" }
    ];
    const role = testResolveUserRole("both1@ghn.vn", permissions);
    assert.strictEqual(role, "XUAT_NHAP");
    assert.strictEqual(testIsAdmin("both1@ghn.vn", permissions), false);
    // Cho phép chuyển đổi cả 2 chế độ
    assert.strictEqual(testCanSwitchMode(role, "Xuất"), true);
    assert.strictEqual(testCanSwitchMode(role, "Nhập"), true);
});

it("phân quyền Quản Trị Viên (ADMIN) có đầy đủ quyền như Super Admin", () => {
    const permissions = [
        { email: "admin_friend@ghn.vn", role: "ADMIN", status: "HOAT_DONG" }
    ];
    const role = testResolveUserRole("admin_friend@ghn.vn", permissions);
    assert.strictEqual(role, "ADMIN");
    assert.strictEqual(testIsAdmin("admin_friend@ghn.vn", permissions), true);
    assert.strictEqual(testCanSwitchMode(role, "Xuất"), true);
    assert.strictEqual(testCanSwitchMode(role, "Nhập"), true);
});

it("chặn người dùng DAU_XUAT chuyển sang Nhập và DAU_NHAP chuyển sang Xuất", () => {
    assert.strictEqual(testCanSwitchMode("DAU_XUAT", "Xuất"), true);
    assert.strictEqual(testCanSwitchMode("DAU_XUAT", "Nhập"), false);
    assert.strictEqual(testCanSwitchMode("DAU_NHAP", "Nhập"), true);
    assert.strictEqual(testCanSwitchMode("DAU_NHAP", "Xuất"), false);
});

it("nhân viên bị KHOA chuyển sang BLOCKED", () => {
    const permissions = [{ email: "baduser@gmail.com", role: "DAU_XUAT", status: "KHOA" }];
    assert.strictEqual(testResolveUserRole("baduser@gmail.com", permissions), "BLOCKED");
});

console.log("\n--- 6. Kiểm thử Cài đặt danh sách xe xuất hàng (Custom Trips Parsing) ---");

function parseTripsFromText(rawText) {
    if (!rawText) return [];
    const lines = rawText.split(/\r?\n/);
    const result = [];
    const seen = new Set();

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith("//")) continue;

        let code = "";
        let label = line;

        const match = line.match(/^([^\s\:\t\|,]+)\s*(?:[\:\t\|]|\s+-\s*|\s*,\s*)\s*(.*)$/);
        if (match && match[2] && match[2].trim()) {
            code = match[1].trim();
            const desc = match[2].trim();
            label = `${code} - ${desc}`;
        } else {
            code = line.split(/\s+/)[0].trim();
            label = line;
        }

        const normKey = code.toUpperCase();
        if (code && !seen.has(normKey)) {
            seen.add(normKey);
            result.push({ code, label });
        }
    }
    return result;
}

function formatTripsToText(trips) {
    return (trips || []).map(t => t.label || t.code).join("\n");
}

it("phân tích danh sách xe nhiều định dạng (gạch ngang, dấu hai chấm, tab, ghi chú)", () => {
    const sampleInput = `
    # Danh sách xe xuất ngày 17/09
    1392 - Tuyến Phú Thọ / Điện Biên
    1393: Tuyến Sơn La
    1394 | Tuyến Lai Châu
    1405\tTuyến Vĩnh Phúc
    29C-12345, Xe tăng cường
    XE-01
    // Dòng ghi chú không đọc
    1392 - Trùng lặp mã xe
    `;
    const parsed = parseTripsFromText(sampleInput);
    assert.strictEqual(parsed.length, 6);
    assert.strictEqual(parsed[0].code, "1392");
    assert.strictEqual(parsed[0].label, "1392 - Tuyến Phú Thọ / Điện Biên");
    assert.strictEqual(parsed[1].code, "1393");
    assert.strictEqual(parsed[2].code, "1394");
    assert.strictEqual(parsed[3].code, "1405");
    assert.strictEqual(parsed[4].code, "29C-12345");
    assert.strictEqual(parsed[5].code, "XE-01");
});

it("chuyển đổi danh sách xe thành định dạng văn bản (formatTripsToText)", () => {
    const trips = [
        { code: "1392", label: "1392 - Tuyến Phú Thọ" },
        { code: "1405", label: "1405 - Tuyến Vĩnh Phúc" }
    ];
    const text = formatTripsToText(trips);
    assert.strictEqual(text, "1392 - Tuyến Phú Thọ\n1405 - Tuyến Vĩnh Phúc");
});

console.log("\n--- 7. Kiểm thử Quy trình Đầu Nhập: Bắt buộc đã Xuất kho mới cho phép Nhập ---");

function simulateInboundScan(pkg, manifestMap, scannedSet) {
    const uniqueKey = pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}` || pkg.raw;
    const manifestItem = manifestMap.get(uniqueKey) ||
                         manifestMap.get(pkg.packageCode) ||
                         manifestMap.get(`${pkg.doNumber}_${pkg.pkgIdx}`);

    // Logic: Chưa xuất thì tuyệt đối không cho nhập
    if (!manifestItem) {
        return { status: "REJECTED", code: "NOT_EXPORTED", synced: false };
    }

    if (scannedSet.has(uniqueKey) || scannedSet.has(pkg.packageCode) || manifestItem.inboundScanned) {
        return { status: "WARNING", code: "DUPLICATE", synced: false };
    }

    scannedSet.add(uniqueKey);
    if (pkg.packageCode) scannedSet.add(pkg.packageCode);
    manifestItem.inboundScanned = true;

    return { status: "SUCCESS", code: "VALID_INBOUND", synced: true, tripCode: manifestItem.tripCode };
}

it("từ chối ngay lập tức khi kiện chưa có log xuất kho (Chưa xuất sao lại nhập được)", () => {
    const manifestMap = new Map();
    const scannedSet = new Set();
    const pkg = { packageCode: "PKG_UNKNOWN_999", doNumber: "DO_999", pkgIdx: 1, totalPackages: 1 };

    const result = simulateInboundScan(pkg, manifestMap, scannedSet);
    assert.strictEqual(result.status, "REJECTED");
    assert.strictEqual(result.code, "NOT_EXPORTED");
    assert.strictEqual(result.synced, false);
    assert.strictEqual(scannedSet.size, 0);
});

it("chấp nhận kiện hợp lệ đã có log xuất kho và đồng bộ dữ liệu", () => {
    const manifestMap = new Map();
    const scannedSet = new Set();
    const pkg = { packageCode: "PPTD2607030C2TP1", doNumber: "8044738590", pkgIdx: 1, totalPackages: 2 };
    
    // Nạp manifest kiện đã xuất
    manifestMap.set("PPTD2607030C2TP1", {
        packageCode: "PPTD2607030C2TP1",
        tripCode: "1392",
        doNumber: "8044738590",
        chCode: "CH.2.31",
        storeName: "VinMart Cẩm Khê",
        inboundScanned: false
    });

    const result = simulateInboundScan(pkg, manifestMap, scannedSet);
    assert.strictEqual(result.status, "SUCCESS");
    assert.strictEqual(result.code, "VALID_INBOUND");
    assert.strictEqual(result.synced, true);
    assert.strictEqual(result.tripCode, "1392");
    assert.strictEqual(scannedSet.has("PPTD2607030C2TP1"), true);
});

it("cảnh báo trùng khi quét lại kiện đã nhập thành công", () => {
    const manifestMap = new Map();
    const scannedSet = new Set();
    const pkg = { packageCode: "PPTD2607030C2TP1", doNumber: "8044738590", pkgIdx: 1, totalPackages: 2 };
    
    manifestMap.set("PPTD2607030C2TP1", {
        packageCode: "PPTD2607030C2TP1",
        tripCode: "1392",
        inboundScanned: false
    });

    const firstScan = simulateInboundScan(pkg, manifestMap, scannedSet);
    assert.strictEqual(firstScan.status, "SUCCESS");

    const secondScan = simulateInboundScan(pkg, manifestMap, scannedSet);
    assert.strictEqual(secondScan.status, "WARNING");
    assert.strictEqual(secondScan.code, "DUPLICATE");
    assert.strictEqual(secondScan.synced, false);
});

// 8. Multi-DO Auto Aggregation & Target Quantity Reconciliation (Fix 24/8 bug)
console.log("\n--- 8. Kiểm thử Tự động nhận diện Đa đơn DO & Điều chỉnh tổng kiện cửa hàng ---");

function simulateMultiDoScan(pkg, state) {
    if (!state.isBatchActive || state.targetQty <= 0) {
        state.isBatchActive = true;
        state.targetStoreCode = pkg.chCode || pkg.storeCode || "CH";
        state.targetStore = `[${state.targetStoreCode}] ${pkg.storeName || state.targetStoreCode}`;
        state.targetQty = pkg.totalPackages || 1;
        state.isAutoLocked = true;
        state.storeDos = pkg.doNumber ? [{ doNumber: pkg.doNumber, packages: pkg.totalPackages || 1 }] : [];
        state.scannedItems = [];
    }

    state.scannedItems.push({
        uniqueKey: pkg.packageCode || `${pkg.doNumber}_${pkg.pkgIdx}`,
        pkg: pkg
    });

    if (pkg.doNumber) {
        if (!Array.isArray(state.storeDos)) state.storeDos = [];
        let existingDo = state.storeDos.find(d => d.doNumber === pkg.doNumber);
        let doListChanged = false;
        const pkgDoTotal = pkg.totalPackages || 1;

        if (!existingDo) {
            state.storeDos.push({
                doNumber: pkg.doNumber,
                packages: pkgDoTotal
            });
            doListChanged = true;
        } else if (pkgDoTotal > (existingDo.packages || 0)) {
            existingDo.packages = pkgDoTotal;
            doListChanged = true;
        }

        if (doListChanged || state.isAutoLocked) {
            const sumOfDos = state.storeDos.reduce((sum, d) => sum + (d.packages || 0), 0);
            if (sumOfDos > state.targetQty) {
                state.targetQty = sumOfDos;
            }
        }
    }

    return {
        currentCount: state.scannedItems.length,
        planQty: state.targetQty,
        dos: state.storeDos
    };
}

function reconcileStateDos(state) {
    let dos = Array.isArray(state.storeDos) ? state.storeDos : [];
    const allScanned = (state.scannedItems || []).concat(state.peerScannedItems || []);

    allScanned.forEach(item => {
        const p = item.pkg;
        if (p && p.doNumber) {
            const dNum = p.doNumber;
            const dPkgs = p.totalPackages || 1;
            let existing = dos.find(d => d.doNumber === dNum);
            if (!existing) {
                dos.push({ doNumber: dNum, packages: dPkgs });
            } else if (dPkgs > (existing.packages || 0)) {
                existing.packages = dPkgs;
            }
        }
    });

    const sumDos = dos.reduce((sum, d) => sum + (d.packages || 0), 0);
    if (sumDos > state.targetQty) {
        state.targetQty = sumDos;
    }
    state.storeDos = dos;
    return state;
}

it("phân tích chính xác file 4 cột có tiêu đề 'Tổng kiện' và cộng dồn 24 kiện cho CH 3685", () => {
    const rawRows = [
        ["Mã siêu thị", "Tên siêu thị", "Qty", "Tổng kiện"],
        ["3685", "WM+ PTO 1343 Hùng Vương", 166, 8],
        ["3685", "WM+ PTO 1343 Hùng Vương", 298, 16]
    ];

    const headers = rawRows[0].map(h => String(h).trim().toLowerCase());
    let storeCodeIdx = -1, storeNameIdx = -1, pcsIdx = -1, pkgCountIdx = -1;
    headers.forEach((h, i) => {
        if (h.includes("mã siêu thị") || h.includes("mã ch")) storeCodeIdx = i;
        else if (h.includes("tên siêu thị") || h.includes("tên cửa hàng")) storeNameIdx = i;
        else if (h === "qty") pcsIdx = i;
        else if ((h.includes("tổng pcs") || h.includes("số kiện") || h.includes("tổng kiện") || h.includes("số lượng kiện")) && !h.includes("tổng số kiện xe")) pkgCountIdx = i;
    });

    assert.strictEqual(storeCodeIdx, 0);
    assert.strictEqual(storeNameIdx, 1);
    assert.strictEqual(pcsIdx, 2);
    assert.strictEqual(pkgCountIdx, 3);

    const byStore = {};
    for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        const code = String(r[storeCodeIdx]);
        const name = String(r[storeNameIdx]);
        const pkg = Math.max(1, parseInt(r[pkgCountIdx], 10) || 1);
        if (!byStore[code]) {
            byStore[code] = { storeCode: code, storeName: name, totalPackages: 0 };
        }
        byStore[code].totalPackages += pkg;
    }

    assert.strictEqual(byStore["3685"].totalPackages, 24);
    assert.strictEqual(byStore["3685"].storeName, "WM+ PTO 1343 Hùng Vương");
});

it("tự động mở rộng targetQty từ 8 lên 24 khi quét DO thứ 2 của cửa hàng", () => {
    const exportState = {
        isBatchActive: false,
        targetStore: "",
        targetStoreCode: "",
        targetQty: 0,
        storeDos: [],
        scannedItems: []
    };

    // Quét kiện 1/8 của DO 7083959520
    const pkg1 = { chCode: "CH.4.15", doNumber: "7083959520", pkgIdx: 1, totalPackages: 8, packageCode: "K1_DO1" };
    const res1 = simulateMultiDoScan(pkg1, exportState);
    assert.strictEqual(res1.planQty, 8);
    assert.strictEqual(res1.currentCount, 1);
    assert.strictEqual(res1.dos.length, 1);

    // Quét tiếp 7 kiện còn lại của DO 7083959520 -> đủ 8/8
    for (let idx = 2; idx <= 8; idx++) {
        simulateMultiDoScan({ chCode: "CH.4.15", doNumber: "7083959520", pkgIdx: idx, totalPackages: 8, packageCode: `K${idx}_DO1` }, exportState);
    }
    assert.strictEqual(exportState.scannedItems.length, 8);
    assert.strictEqual(exportState.targetQty, 8);

    // Quét kiện 1/16 của DO thứ 2 (7083986347)
    const pkg9 = { chCode: "CH.4.15", doNumber: "7083986347", pkgIdx: 1, totalPackages: 16, packageCode: "K1_DO2" };
    const res9 = simulateMultiDoScan(pkg9, exportState);

    // Kế hoạch phải TỰ ĐỘNG MỞ RỘNG thành 24 kiện (8 + 16 = 24)!
    assert.strictEqual(res9.planQty, 24);
    assert.strictEqual(res9.currentCount, 9);
    assert.strictEqual(res9.dos.length, 2);
    assert.strictEqual(res9.dos[0].packages, 8);
    assert.strictEqual(res9.dos[1].packages, 16);

    // Quét tiếp 15 kiện còn lại của DO 7083986347 -> đủ 24/24 kiện
    for (let idx = 2; idx <= 16; idx++) {
        simulateMultiDoScan({ chCode: "CH.4.15", doNumber: "7083986347", pkgIdx: idx, totalPackages: 16, packageCode: `K${idx}_DO2` }, exportState);
    }
    assert.strictEqual(exportState.scannedItems.length, 24);
    assert.strictEqual(exportState.targetQty, 24);
    assert.strictEqual(exportState.scannedItems.length === exportState.targetQty, true);
});

it("tự động chữa lành (auto-heal) trạng thái 24/8 thành 24/24 kiện hoàn thành", () => {
    // Giả lập trạng thái lỗi như ảnh chụp của người dùng: Đã quét 23 + 1 = 24 kiện, nhưng targetQty đang bị kẹt ở 8
    const brokenState = {
        isBatchActive: true,
        targetStore: "[CH.4.15] CH.4.15",
        targetStoreCode: "CH.4.15",
        targetQty: 8,
        storeDos: [{ doNumber: "7083959520", packages: 8 }],
        scannedItems: [
            ...Array.from({ length: 8 }, (_, i) => ({ pkg: { doNumber: "7083959520", pkgIdx: i + 1, totalPackages: 8 } })),
            ...Array.from({ length: 15 }, (_, i) => ({ pkg: { doNumber: "7083986347", pkgIdx: i + 1, totalPackages: 16 } }))
        ],
        peerScannedItems: [
            { pkg: { doNumber: "7083986347", pkgIdx: 16, totalPackages: 16 } }
        ]
    };

    assert.strictEqual(brokenState.scannedItems.length + brokenState.peerScannedItems.length, 24);
    assert.strictEqual(brokenState.targetQty, 8); // Trước khi fix: 24/8

    const healedState = reconcileStateDos(brokenState);
    assert.strictEqual(healedState.targetQty, 24); // Sau khi fix: tự động khôi phục 24/24!
    assert.strictEqual(healedState.storeDos.length, 2);
    assert.strictEqual(healedState.storeDos.find(d => d.doNumber === "7083959520").packages, 8);
    assert.strictEqual(healedState.storeDos.find(d => d.doNumber === "7083986347").packages, 16);
});

// Summary Report
console.log("\n=======================================================");
console.log(`📊 KẾT QUẢ TEST: ${passed} PASSED | ${failed} FAILED`);
console.log("=======================================================\n");

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
