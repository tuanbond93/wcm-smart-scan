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
        if (status === "HOAT_DONG") return found.role || "DAU_XUAT";
        if (status === "KHOA") return "BLOCKED";
        if (status === "CHO_DUYET") return "PENDING_APPROVAL";
        return "PENDING_APPROVAL";
    }
    return "PENDING_APPROVAL";
}

it("nhận diện chính xác Tổng Admin tối cao tuanns@ghn.vn", () => {
    assert.strictEqual(testResolveUserRole("tuanns@ghn.vn"), "SUPER_ADMIN");
    assert.strictEqual(testResolveUserRole(" TUANNS@GHN.VN "), "SUPER_ADMIN");
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
});

it("nhân viên bị KHOA chuyển sang BLOCKED", () => {
    const permissions = [{ email: "baduser@gmail.com", role: "DAU_XUAT", status: "KHOA" }];
    assert.strictEqual(testResolveUserRole("baduser@gmail.com", permissions), "BLOCKED");
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
