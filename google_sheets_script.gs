/**
 * =============================================================================
 * WCM SMART SCAN - GOOGLE APPS SCRIPT WEB APP API
 * =============================================================================
 * Hỗ trợ:
 * 1. Bắn đồng thời 2 thiết bị tại Đầu Xuất (Đồng bộ số lượng và chống trùng chéo)
 * 2. Lưu trữ toàn bộ dữ liệu quét lên Google Sheets thời gian thực
 * 3. Đầu Nhập dỡ hàng tải danh sách chuyến xuất về để quét đối chiếu
 * 
 * HƯỚNG DẪN CÀI ĐẶT TRONG 1 PHÚT:
 * 1. Mở Google Sheets mới (hoặc trang tính sẵn có).
 * 2. Trên thanh menu, chọn: Tiện ích mở rộng -> Apps Script.
 * 3. Xóa toàn bộ mã cũ, dán toàn bộ nội dung file này vào.
 * 4. Bấm nút "Lưu" (biểu tượng đĩa mềm 💾).
 * 5. Bấm nút "Triển khai" (Deploy) -> "Tùy chọn triển khai mới" (New deployment).
 * 6. Chọn loại: "Ứng dụng web" (Web app).
 *    - Mô tả: WCM Smart Scan Sync API
 *    - Thực thi dưới dạng: "Tôi" (Me)
 *    - Ai có quyền truy cập: "Bất kỳ ai" (Anyone) -> RẤT QUAN TRỌNG ĐỂ ĐIỆN THOẠI GỌI ĐƯỢC.
 * 7. Bấm "Triển khai", cấp quyền truy cập tài khoản Google nếu hỏi.
 * 8. Sao chép "URL ứng dụng web" (Web app URL) và dán vào ô "Cấu hình Google Sheet" trên app.
 * =============================================================================
 */

// =============================================================================
// CẤU HÌNH LIÊN KẾT GOOGLE SHEETS
// =============================================================================
// 👉 CÁCH 1 (Khuyên dùng): Mở file Google Sheets -> chọn "Tiện ích mở rộng" -> "Apps Script" -> Dán code.
//    Khi đó SPREADSHEET_ID để trống: "" (hệ thống tự nhận diện bảng tính đang mở).
//
// 👉 CÁCH 2 (Dành cho Script tạo độc lập từ script.google.com):
//    Nếu tạo script độc lập, hãy copy ID file Google Sheet dán vào giữa cặp dấu ngoặc kép bên dưới:
//    Ví dụ link Sheet: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
//    -> SPREADSHEET_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const SPREADSHEET_ID = "13kQlNZcuVyJbiPmyZlbi5I5H9X8Fqbcyr0TqUHsVYTA";

function getSpreadsheet() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;

  if (typeof SPREADSHEET_ID !== "undefined" && SPREADSHEET_ID && SPREADSHEET_ID.trim()) {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
    } catch (err) {
      throw new Error("Không thể mở Google Sheet với ID '" + SPREADSHEET_ID + "': " + err.message);
    }
  }

  throw new Error("LỖI LIÊN KẾT: Script này được tạo độc lập tại script.google.com nên không tìm thấy Google Sheets nào!\n\n👉 Cách sửa:\n1. Mở file Google Sheets của bạn -> Chọn menu 'Tiện ích mở rộng' -> 'Apps Script' rồi dán mã vào đó;\nHOẶC:\n2. Điền ID file Google Sheet của bạn vào biến SPREADSHEET_ID ở dòng 35 trong file code này.");
}

const SHEET_XUAT = "XUAT_KHO";
const SHEET_NHAP = "NHAP_KHO";
const SHEET_DOI_CHIEU = "DOI_CHIEU_TONG_HOP";
const SHEET_PHAN_QUYEN = "PHAN_QUYEN";
const SHEET_KHO_TONG = "KHO_TONG_CHOT";
const SHEET_AUDIT = "AUDIT_LOG";

// Tự động khởi tạo cấu trúc các Tab khi lần đầu chạy
function setupSheets() {
  const ss = getSpreadsheet();
  
  // 1. Tab Xuất Kho
  let sXuat = ss.getSheetByName(SHEET_XUAT);
  if (!sXuat) {
    sXuat = ss.insertSheet(SHEET_XUAT);
    const headers = [
      "Thời Gian", "Mã Chuyến/Lô", "Mã Kiện", "Số DO", "Mã Cửa Hàng (CH)", 
      "Tên Siêu Thị", "Số Kiện (x/y)", "Nhân Viên Xuất", "Thiết Bị", "Trạng Thái", "Mã QR Gốc"
    ];
    sXuat.appendRow(headers);
    sXuat.getRange("A1:K1").setBackground("#1e293b").setFontColor("#f8fafc").setFontWeight("bold");
    sXuat.setFrozenRows(1);
  }
  
  // 2. Tab Nhập Kho
  let sNhap = ss.getSheetByName(SHEET_NHAP);
  if (!sNhap) {
    sNhap = ss.insertSheet(SHEET_NHAP);
    const headers = [
      "Thời Gian", "Mã Chuyến/Lô", "Mã Kiện", "Số DO", "Mã Cửa Hàng (CH)",
      "Tên Siêu Thị", "Nhân Viên Nhập", "Thiết Bị", "Kết Quả Đối Chiếu", "Ghi Chú Lỗi"
    ];
    sNhap.appendRow(headers);
    sNhap.getRange("A1:J1").setBackground("#0f766e").setFontColor("#f8fafc").setFontWeight("bold");
    sNhap.setFrozenRows(1);
  }

  // 3. Tab Tổng Hợp Đối Chiếu
  let sDoiChieu = ss.getSheetByName(SHEET_DOI_CHIEU);
  if (!sDoiChieu) {
    sDoiChieu = ss.insertSheet(SHEET_DOI_CHIEU);
    const headers = [
      "Mã Chuyến/Lô", "Cửa Hàng", "Tổng Kiện Xuất", "Đã Nhập Đối Chiếu", 
      "Còn Thiếu", "Kiện Lạ/Lẫn Hàng", "Tỷ Lệ Khớp (%)", "Trạng Thái Chuyến", "Cập Nhật Cuối"
    ];
    sDoiChieu.appendRow(headers);
    sDoiChieu.getRange("A1:I1").setBackground("#b45309").setFontColor("#f8fafc").setFontWeight("bold");
    sDoiChieu.setFrozenRows(1);
  }

  // 4. Tab Phân Quyền Người Dùng
  let sPhanQuyen = ss.getSheetByName(SHEET_PHAN_QUYEN);
  if (!sPhanQuyen) {
    sPhanQuyen = ss.insertSheet(SHEET_PHAN_QUYEN);
    const headers = ["Email", "Họ Tên", "Vị Trí", "Trạng Thái", "Người Cấp Quyền", "Thời Gian"];
    sPhanQuyen.appendRow(headers);
    // Super Admin mặc định
    sPhanQuyen.appendRow(["tuanns@ghn.vn", "Nguyễn Sơn Tuấn", "SUPER_ADMIN", "HOAT_DONG", "Hệ thống", new Date().toISOString()]);
    sPhanQuyen.getRange("A1:F1").setBackground("#312e81").setFontColor("#f8fafc").setFontWeight("bold");
    sPhanQuyen.setFrozenRows(1);
  }

  // 5. Tab File Kho Tổng Chốt (Đồng bộ danh sách DO - Cửa hàng - Xe - Số kiện)
  let sKhoTong = ss.getSheetByName(SHEET_KHO_TONG);
  if (!sKhoTong) {
    sKhoTong = ss.insertSheet(SHEET_KHO_TONG);
    const headers = [
      "Số DO", "Số SO", "Mã Siêu Thị", "Tên Siêu Thị", "Số Kiện (PCS/Mã chuyến)",
      "Qty PCS", "STT CH", "Mã Giờ (Lot)", "BKS Xe", "Lái Xe", "Trọng Tải", "Tỉnh", "Quận", "Tên File Nguồn", "Thời Gian Nạp"
    ];
    sKhoTong.appendRow(headers);
    sKhoTong.getRange("A1:O1").setBackground("#0369a1").setFontColor("#f8fafc").setFontWeight("bold");
    sKhoTong.setFrozenRows(1);
  }

  // 6. Tab Audit Log Bảo Mật (Theo chuẩn Identity & Access Engineer)
  let sAudit = ss.getSheetByName(SHEET_AUDIT);
  if (!sAudit) {
    sAudit = ss.insertSheet(SHEET_AUDIT);
    const headers = ["Thời Gian", "Hành Động", "Người Thực Hiện", "Phương Thức Xác Thực", "Đối Tượng Tác Động", "Chi Tiết"];
    sAudit.appendRow(headers);
    sAudit.getRange("A1:F1").setBackground("#4c1d95").setFontColor("#f8fafc").setFontWeight("bold");
    sAudit.setFrozenRows(1);
  }
  
  return { sXuat, sNhap, sDoiChieu, sPhanQuyen, sKhoTong, sAudit };
}

// Ghi nhận lịch sử thao tác nhạy cảm vào tab AUDIT_LOG
function writeAuditLog(ss, actionName, actorEmail, authMethod, target, detail) {
  try {
    if (!ss) ss = getSpreadsheet();
    let sAudit = ss.getSheetByName(SHEET_AUDIT);
    if (!sAudit) {
      setupSheets();
      sAudit = ss.getSheetByName(SHEET_AUDIT);
    }
    const ts = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");
    sAudit.appendRow([ts, actionName, actorEmail || "unknown", authMethod || "session", target || "-", detail || ""]);
  } catch (e) {}
}

// Xác thực quyền Admin / Super Admin ở phía Server (Identity & Access Engineer Rule #2)
function verifyAdminAuthority(ss, body) {
  const requester = String((body && body.requester) || "").trim().toLowerCase();
  const credential = String((body && body.credential) || "").trim();
  let verifiedEmail = "";
  let authMethod = "email_session";

  if (credential) {
    try {
      const parts = credential.split(".");
      if (parts.length === 3) {
        let payloadStr = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        while (payloadStr.length % 4 !== 0) payloadStr += "=";
        const decodedBytes = Utilities.base64Decode(payloadStr);
        const decodedJson = Utilities.newBlob(decodedBytes).getDataAsString("UTF-8");
        const tokenData = JSON.parse(decodedJson);
        const iss = String(tokenData.iss || "");
        const exp = Number(tokenData.exp || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        if ((iss === "accounts.google.com" || iss === "https://accounts.google.com") && (!exp || exp + 3600 > nowSec)) {
          verifiedEmail = String(tokenData.email || "").trim().toLowerCase();
          authMethod = "google_jwt";
        }
      }
    } catch (eTok) {}
  }

  const effectiveAdmin = verifiedEmail || requester;
  if (!effectiveAdmin) {
    return { allowed: false, email: "", authMethod: "none", message: "Thiếu thông tin người yêu cầu!" };
  }

  let hasAdminRight = (effectiveAdmin === "tuanns@ghn.vn");
  if (!hasAdminRight) {
    const sPQ = ss.getSheetByName(SHEET_PHAN_QUYEN);
    const data = sPQ ? sPQ.getDataRange().getValues() : [];
    for (let i = 1; i < data.length; i++) {
      const rowEmail = String(data[i][0] || "").trim().toLowerCase();
      const rowRole = String(data[i][2] || "").trim().toUpperCase();
      const rowStatus = String(data[i][3] || "").trim().toUpperCase();
      if (rowEmail === effectiveAdmin && (rowRole === "ADMIN" || rowRole === "SUPER_ADMIN") && rowStatus === "HOAT_DONG") {
        hasAdminRight = true;
        break;
      }
    }
  }

  return {
    allowed: hasAdminRight,
    email: effectiveAdmin,
    authMethod: authMethod,
    message: hasAdminRight ? "OK" : ("Từ chối: Tài khoản " + effectiveAdmin + " không có quyền Quản trị viên (Admin)!")
  };
}

// Xử lý yêu cầu GET (Lấy danh sách chuyến, tải manifest đối chiếu, đồng bộ chéo giữa 2 máy)
function doGet(e) {
  try {
    setupSheets();
    const params = e.parameter || {};
    const action = params.action || "ping";
    
    // 1. Health Check
    if (action === "ping") {
      return jsonResponse({
        status: "SUCCESS",
        message: "WCM Smart Scan Sync API is online and ready!",
        serverTime: new Date().toISOString()
      });
    }

    // 2. Lấy danh sách các chuyến xe gần đây
    if (action === "get_trip_list") {
      const ss = getSpreadsheet();
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const data = sXuat.getDataRange().getValues();
      const tripsMap = {};

      for (let i = 1; i < data.length; i++) {
        const trip = String(data[i][1] || "").trim();
        const store = String(data[i][4] || "").trim();
        if (trip) {
          if (!tripsMap[trip]) {
            tripsMap[trip] = { tripCode: trip, store: store, totalPackages: 0, lastTime: data[i][0] };
          }
          tripsMap[trip].totalPackages++;
        }
      }

      const tripList = Object.keys(tripsMap).map(k => tripsMap[k]);
      return jsonResponse({ status: "SUCCESS", trips: tripList });
    }

    // 3. Đầu Nhập tải danh sách kiện đã xuất để bắn đối chiếu (hỗ trợ 1 chuyến hoặc TẤT CẢ chuyến)
    if (action === "get_trip_manifest") {
      const tripCode = String(params.tripCode || "").trim();
      const isAllTrips = !tripCode || tripCode === "ALL";

      const ss = getSpreadsheet();
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const sNhap = ss.getSheetByName(SHEET_NHAP);

      const xuatData = sXuat.getDataRange().getValues();
      const nhapData = sNhap.getDataRange().getValues();

      // Danh sách các kiện đã nhập
      const scannedInboundMap = {};
      for (let j = 1; j < nhapData.length; j++) {
        const rowTrip = String(nhapData[j][1] || "").trim();
        const rowPkg = String(nhapData[j][2] || "").trim();
        if ((isAllTrips || rowTrip === tripCode) && rowPkg) {
          scannedInboundMap[rowPkg] = {
            operator: nhapData[j][6],
            timestamp: nhapData[j][0],
            status: nhapData[j][8]
          };
          if (rowTrip) {
            scannedInboundMap[`${rowTrip}___${rowPkg}`] = scannedInboundMap[rowPkg];
          }
        }
      }

      const packages = [];
      for (let i = 1; i < xuatData.length; i++) {
        const rowTrip = String(xuatData[i][1] || "").trim();
        const rowStatus = String(xuatData[i][9] || "").trim();
        if (rowStatus === "ĐÃ_HỦY_QUÉT_NHẦM") continue;

        if (isAllTrips || rowTrip === tripCode) {
          const pkgCode = String(xuatData[i][2] || "").trim();
          const isInboundScanned = !!scannedInboundMap[pkgCode] || !!scannedInboundMap[`${rowTrip}___${pkgCode}`];
          const inboundMeta = scannedInboundMap[`${rowTrip}___${pkgCode}`] || scannedInboundMap[pkgCode] || {};

          packages.push({
            tripCode: rowTrip,
            packageCode: pkgCode,
            doNumber: String(xuatData[i][3] || ""),
            chCode: String(xuatData[i][4] || ""),
            storeName: String(xuatData[i][5] || ""),
            pkgIdxText: String(xuatData[i][6] || ""),
            exportOperator: String(xuatData[i][7] || ""),
            exportTime: String(xuatData[i][0] || ""),
            inboundScanned: isInboundScanned,
            inboundOperator: isInboundScanned ? inboundMeta.operator : "",
            inboundTime: isInboundScanned ? inboundMeta.timestamp : ""
          });
        }
      }

      return jsonResponse({
        status: "SUCCESS",
        tripCode: tripCode || "ALL",
        totalExported: packages.length,
        totalInboundReceived: packages.filter(p => p.inboundScanned).length,
        packages: packages
      });
    }

    // 4. Đồng bộ thời gian thực giữa 2 máy đang bắn cùng 1 chuyến (Hỗ trợ Delta Sync theo sinceRow)
    if (action === "sync_peer_scans") {
      const tripCode = String(params.tripCode || "").trim();
      const mode = String(params.mode || "Xuất").trim();
      const sinceRowParam = parseInt(params.sinceRow || "0", 10) || 0;
      const ss = getSpreadsheet();
      const sheet = ss.getSheetByName(mode === "Nhập" ? SHEET_NHAP : SHEET_XUAT);
      const data = sheet.getDataRange().getValues();
      const totalRowsInSheet = data.length;
      const useDelta = (sinceRowParam > 1 && sinceRowParam <= totalRowsInSheet);
      const startIndex = useDelta ? sinceRowParam : 1;

      const scannedKeys = [];
      const revokedKeys = [];

      // Luôn kiểm tra các kiện bị hủy (ĐÃ_HỦY_QUÉT_NHẦM) của chuyến này để đồng bộ xóa ngay
      for (let r = 1; r < totalRowsInSheet; r++) {
        const rTrip = String(data[r][1] || "").trim();
        if (rTrip !== tripCode) continue;
        const rStatus = String(data[r][mode === "Nhập" ? 8 : 9] || "").trim();
        if (rStatus === "ĐÃ_HỦY_QUÉT_NHẦM") {
          revokedKeys.push(String(data[r][2] || "").trim());
        }
      }

      for (let i = startIndex; i < totalRowsInSheet; i++) {
        const rowTrip = String(data[i][1] || "").trim();
        const rowStatus = String(data[i][mode === "Nhập" ? 8 : 9] || "").trim();
        if (rowStatus === "ĐÃ_HỦY_QUÉT_NHẦM") continue;

        if (rowTrip === tripCode) {
          scannedKeys.push({
            packageCode: String(data[i][2] || "").trim(),
            operator: String(data[i][mode === "Nhập" ? 6 : 7] || "").trim(),
            timestamp: String(data[i][0] || "")
          });
        }
      }

      return jsonResponse({
        status: "SUCCESS",
        tripCode: tripCode,
        isDelta: useDelta,
        lastRow: totalRowsInSheet,
        totalScanned: scannedKeys.length,
        scannedItems: scannedKeys,
        revokedKeys: revokedKeys
      });
    }

    // 5. Lấy danh sách phân quyền nhân viên (Tab PHAN_QUYEN)
    if (action === "get_permissions") {
      const ss = getSpreadsheet();
      const sPQ = ss.getSheetByName(SHEET_PHAN_QUYEN);
      const data = sPQ ? sPQ.getDataRange().getValues() : [];
      const permissions = [];
      for (let i = 1; i < data.length; i++) {
        const email = String(data[i][0] || "").trim().toLowerCase();
        if (email) {
          permissions.push({
            email: email,
            name: String(data[i][1] || ""),
            role: String(data[i][2] || "DAU_XUAT").trim(),
            status: String(data[i][3] || "HOAT_DONG").trim(),
            assignedBy: String(data[i][4] || ""),
            assignedAt: String(data[i][5] || "")
          });
        }
      }
      return jsonResponse({ status: "SUCCESS", permissions: permissions });
    }

    // 6. Lấy tiến độ tổng thể tất cả chuyến xe (Dashboard Tiến Độ)
    if (action === "get_all_trips_progress") {
      const ss = getSpreadsheet();
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const sNhap = ss.getSheetByName(SHEET_NHAP);

      const xuatData = sXuat ? sXuat.getDataRange().getValues() : [];
      const nhapData = sNhap ? sNhap.getDataRange().getValues() : [];

      const tripsMap = {};

      for (let i = 1; i < xuatData.length; i++) {
        const rowTrip = String(xuatData[i][1] || "").trim();
        const rowStatus = String(xuatData[i][9] || "").trim();
        if (!rowTrip || rowStatus === "ĐÃ_HỦY_QUÉT_NHẦM") continue;

        if (!tripsMap[rowTrip]) {
          tripsMap[rowTrip] = {
            tripCode: rowTrip,
            totalExported: 0,
            totalInbound: 0,
            stores: {},
            operators: {},
            lastActive: xuatData[i][0]
          };
        }

        const t = tripsMap[rowTrip];
        t.totalExported++;

        const chCode = String(xuatData[i][4] || "").trim();
        const storeName = String(xuatData[i][5] || "").trim();
        const op = String(xuatData[i][7] || "NV").trim();

        if (chCode || storeName) {
          const sKey = chCode || storeName;
          if (!t.stores[sKey]) {
            t.stores[sKey] = { code: chCode, name: storeName, count: 0 };
          }
          t.stores[sKey].count++;
        }

        t.operators[op] = (t.operators[op] || 0) + 1;
        t.lastActive = xuatData[i][0];
      }

      // Đếm số kiện đã nhập
      for (let j = 1; j < nhapData.length; j++) {
        const rowTrip = String(nhapData[j][1] || "").trim();
        if (rowTrip && tripsMap[rowTrip]) {
          tripsMap[rowTrip].totalInbound++;
        }
      }

      const tripsArray = Object.keys(tripsMap).map(k => {
        const t = tripsMap[k];
        return {
          tripCode: t.tripCode,
          totalExported: t.totalExported,
          totalInbound: t.totalInbound,
          stores: Object.keys(t.stores).map(sk => t.stores[sk]),
          operators: t.operators,
          lastActive: t.lastActive
        };
      });

      // Tự động đồng bộ cập nhật tab DOI_CHIEU_TONG_HOP khi mở Dashboard
      try { updateDoiChieuTongHopSheet(ss); } catch (eSummary) {}

      return jsonResponse({
        status: "SUCCESS",
        trips: tripsArray,
        serverTime: new Date().toISOString()
      });
    }

    // 7. Cập nhật và tính toán lại Tab DOI_CHIEU_TONG_HOP
    if (action === "recalculate_summary") {
      const ss = getSpreadsheet();
      const updatedCount = updateDoiChieuTongHopSheet(ss);
      return jsonResponse({
        status: "SUCCESS",
        message: `Đã cập nhật bảng Đối Chiếu Tổng Hợp (${updatedCount} dòng)`,
        rowsCount: updatedCount
      });
    }

    // 8. Lấy dữ liệu File Kho Tổng Chốt mới nhất từ Tab KHO_TONG_CHOT
    if (action === "get_master_dispatch") {
      const ss = getSpreadsheet();
      const sKhoTong = ss.getSheetByName(SHEET_KHO_TONG);
      const data = sKhoTong ? sKhoTong.getDataRange().getValues() : [];
      const rows = [];
      let fileName = "File Kho Tổng Chốt (Cloud)";
      let updatedAt = "";

      for (let i = 1; i < data.length; i++) {
        const doNum = String(data[i][0] || "").trim();
        const stCode = String(data[i][2] || "").trim();
        if (!doNum || !stCode) continue;
        if (!fileName && data[i][13]) fileName = String(data[i][13]).trim();
        if (data[i][13]) fileName = String(data[i][13]).trim();
        if (data[i][14]) updatedAt = String(data[i][14]).trim();

        rows.push({
          doNumber: doNum,
          soNumber: String(data[i][1] || "").trim(),
          storeCode: stCode,
          storeName: String(data[i][3] || "").trim(),
          packages: parseInt(data[i][4], 10) || 1,
          qtyPcs: parseInt(data[i][5], 10) || 0,
          sttCh: String(data[i][6] || "").trim(),
          lotCode: String(data[i][7] || "").trim(),
          bks: String(data[i][8] || "").trim(),
          driver: String(data[i][9] || "").trim(),
          tonnage: String(data[i][10] || "").trim(),
          province: String(data[i][11] || "").trim(),
          district: String(data[i][12] || "").trim()
        });
      }

      return jsonResponse({
        status: "SUCCESS",
        fileName: fileName,
        updatedAt: updatedAt,
        totalRows: rows.length,
        rows: rows
      });
    }

    return jsonResponse({ status: "ERROR", message: "Unknown action: " + action });

  } catch (err) {
    return jsonResponse({ status: "ERROR", message: err.toString() });
  }
}

// Xử lý yêu cầu POST (Ghi nhận lượt bắn từ điện thoại/PDA)
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Chờ khóa trong 10 giây để đảm bảo 2 máy gửi cùng lúc không bị xung đột ghi đè
    lock.waitLock(10000);
    setupSheets();

    const rawContent = e.postData.contents;
    const body = JSON.parse(rawContent);
    const action = body.action || "export_scan";
    const ss = getSpreadsheet();

    // -------------------------------------------------------------------------
    // ACTION 1: GHI NHẬN LƯỢT BẮN ĐẦU XUẤT (2 NGƯỜI CÙNG BẮN)
    // -------------------------------------------------------------------------
    if (action === "export_scan" || action === "batch_export") {
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const scans = Array.isArray(body.scans) ? body.scans : [body];
      const results = [];

      // Kiểm tra trùng trong toàn bộ sheet
      const existingData = sXuat.getDataRange().getValues();
      const existingKeySet = new Set();
      for (let i = 1; i < existingData.length; i++) {
        const trip = String(existingData[i][1] || "").trim();
        const pkg = String(existingData[i][2] || "").trim();
        if (trip && pkg) {
          existingKeySet.add(`${trip}___${pkg}`);
        }
      }

      const rowsToAppend = [];
      const timestampNow = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");

      for (let k = 0; k < scans.length; k++) {
        const item = scans[k];
        const tripCode = String(item.tripCode || "CHUA_DAT_TEN").trim();
        const pkgCode = String(item.packageCode || item.uniqueKey || "").trim();
        const checkKey = `${tripCode}___${pkgCode}`;

        if (existingKeySet.has(checkKey)) {
          results.push({
            packageCode: pkgCode,
            status: "DUPLICATE",
            message: "Kiện này đã được ghi nhận trước đó trên Google Sheet!"
          });
          continue;
        }

        existingKeySet.add(checkKey);
        rowsToAppend.push([
          item.timestamp || timestampNow,
          tripCode,
          pkgCode,
          item.doNumber || "",
          item.chCode || "",
          item.storeName || "",
          item.pkgIdxText || "",
          item.operatorCode || "NV",
          item.deviceInfo || "",
          item.status || "Hợp lệ",
          item.rawBarcode || ""
        ]);

        results.push({
          packageCode: pkgCode,
          status: "SUCCESS"
        });
      }

      if (rowsToAppend.length > 0) {
        sXuat.getRange(sXuat.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
        try { updateDoiChieuTongHopSheet(ss); } catch (eSum1) {}
      }

      return jsonResponse({
        status: "SUCCESS",
        acceptedCount: rowsToAppend.length,
        results: results
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 2: GHI NHẬN LƯỢT BẮN ĐẦU NHẬP (ĐỐI CHIẾU DỠ HÀNG)
    // -------------------------------------------------------------------------
    if (action === "inbound_scan" || action === "batch_inbound") {
      const sNhap = ss.getSheetByName(SHEET_NHAP);
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const scans = Array.isArray(body.scans) ? body.scans : [body];
      const timestampNow = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");

      // Nạp danh sách đã xuất để đối chiếu
      const xuatData = sXuat.getDataRange().getValues();
      const exportedMap = {};
      for (let i = 1; i < xuatData.length; i++) {
        const trip = String(xuatData[i][1] || "").trim();
        const pkg = String(xuatData[i][2] || "").trim();
        const rowStatus = String(xuatData[i][9] || "").trim();
        if (rowStatus === "ĐÃ_HỦY_QUÉT_NHẦM") continue;

        if (pkg) {
          const info = {
            tripCode: trip,
            doNumber: xuatData[i][3],
            chCode: xuatData[i][4],
            storeName: xuatData[i][5],
            pkgIdxText: xuatData[i][6]
          };
          if (trip) exportedMap[`${trip}___${pkg}`] = info;
          if (!exportedMap[pkg]) exportedMap[pkg] = info;
        }
      }

      // Nạp danh sách đã nhập để kiểm tra trùng
      const nhapData = sNhap.getDataRange().getValues();
      const inboundSet = new Set();
      for (let j = 1; j < nhapData.length; j++) {
        const trip = String(nhapData[j][1] || "").trim();
        const pkg = String(nhapData[j][2] || "").trim();
        if (pkg) {
          if (trip) inboundSet.add(`${trip}___${pkg}`);
          inboundSet.add(pkg);
        }
      }

      const rowsToAppend = [];
      const results = [];

      for (let k = 0; k < scans.length; k++) {
        const item = scans[k];
        let tripCode = String(item.tripCode || "").trim();
        const pkgCode = String(item.packageCode || item.uniqueKey || "").trim();
        let checkKey = `${tripCode}___${pkgCode}`;

        // 1. TÌM KIẾM THÔNG TIN XUẤT KHO CỦA KIỆN HÀNG
        let expInfo = exportedMap[checkKey] || exportedMap[pkgCode];

        // QUY TẮC CỐT LÕI: CHƯA XUẤT SAO LẠI NHẬP ĐƯỢC!
        // Nếu không có log xuất kho -> TỪ CHỐI TUYỆT ĐỐI VÀ KHÔNG ĐƯỢC GHI VÀO TAB NHAP_KHO!
        if (!expInfo) {
          results.push({
            packageCode: pkgCode,
            status: "REJECTED",
            verdict: "TỪ CHỐI NHẬP: KIỆN CHƯA CÓ LOG XUẤT KHO",
            note: "Kiện chưa từng được quét xuất kho trong hệ thống. Vi phạm quy trình: Chưa xuất không thể nhập!"
          });
          continue; // BỎ QUA, KHÔNG GHI DÒNG VÀO SHEET NHAP_KHO!
        }

        // Tự động nhận diện đúng chuyến xe từ log xuất kho nếu client gửi ALL hoặc rỗng
        if ((!tripCode || tripCode === "ALL" || tripCode === "CHUA_DAT_TEN") && expInfo.tripCode) {
          tripCode = expInfo.tripCode;
          checkKey = `${tripCode}___${pkgCode}`;
        }

        // 2. KIỂM TRA QUÉT TRÙNG TẠI ĐẦU NHẬP
        if (inboundSet.has(checkKey) || inboundSet.has(pkgCode)) {
          results.push({
            packageCode: pkgCode,
            status: "DUPLICATE",
            verdict: "TRÙNG ĐÃ NHẬP",
            note: "Kiện đã được quét trước đó tại đầu nhập"
          });
          continue; // ĐÃ NHẬP RỒI, KHÔNG GHI TRÙNG DÒNG MỚI!
        }

        inboundSet.add(checkKey);
        inboundSet.add(pkgCode);

        const verdict = "KHỚP ĐÚNG CHUYẾN";
        const note = item.note || "Nhập kho hợp lệ (đã khớp xuất kho)";

        rowsToAppend.push([
          item.timestamp || timestampNow,
          tripCode,
          pkgCode,
          item.doNumber || expInfo.doNumber || "",
          item.chCode || expInfo.chCode || "",
          item.storeName || expInfo.storeName || "",
          item.operatorCode || "NV_NHAP",
          item.deviceInfo || "",
          verdict,
          note
        ]);

        results.push({
          packageCode: pkgCode,
          status: "SUCCESS",
          verdict: verdict,
          tripCode: tripCode,
          note: note
        });
      }

      if (rowsToAppend.length > 0) {
        sNhap.getRange(sNhap.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
        try { updateDoiChieuTongHopSheet(ss); } catch (eSum2) {}
      }

      return jsonResponse({
        status: "SUCCESS",
        acceptedCount: rowsToAppend.length,
        results: results
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 3: CẬP NHẬT PHÂN QUYỀN (CHỈ DÀNH CHO SUPER ADMIN / ADMIN)
    // -------------------------------------------------------------------------
    if (action === "update_permission") {
      const sPQ = ss.getSheetByName(SHEET_PHAN_QUYEN);
      const targetEmail = String(body.email || "").trim().toLowerCase();
      const targetRole = String(body.role || "DAU_XUAT").trim();
      const targetName = String(body.name || targetEmail.split("@")[0]).trim();
      const targetStatus = String(body.status || "HOAT_DONG").trim();

      const authCheck = verifyAdminAuthority(ss, body);
      if (!authCheck.allowed) {
        writeAuditLog(ss, "UPDATE_PERMISSION_DENIED", authCheck.email, authCheck.authMethod, targetEmail, authCheck.message);
        return jsonResponse({ status: "ERROR", message: authCheck.message });
      }

      const effectiveAdmin = authCheck.email;

      // Bảo vệ tài khoản Tổng Admin tối cao: không ai được xóa hoặc đổi role của tuanns@ghn.vn
      if (targetEmail === "tuanns@ghn.vn" && (targetStatus === "DELETED" || targetRole !== "SUPER_ADMIN")) {
        return jsonResponse({ status: "ERROR", message: "Không thể thay đổi quyền của Tổng Admin tối cao (tuanns@ghn.vn)!" });
      }

      if (!targetEmail) {
        return jsonResponse({ status: "ERROR", message: "Email nhân viên không được để trống!" });
      }

      const data = sPQ.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0] || "").trim().toLowerCase() === targetEmail) {
          foundRow = i + 1; // 1-indexed for Sheet
          break;
        }
      }

      const timestamp = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");

      if (foundRow > 0) {
        if (targetStatus === "DELETED") {
          sPQ.deleteRow(foundRow);
        } else {
          sPQ.getRange(foundRow, 2).setValue(targetName);
          sPQ.getRange(foundRow, 3).setValue(targetRole);
          sPQ.getRange(foundRow, 4).setValue(targetStatus);
          sPQ.getRange(foundRow, 5).setValue(effectiveAdmin);
          sPQ.getRange(foundRow, 6).setValue(timestamp);
        }
      } else if (targetStatus !== "DELETED") {
        sPQ.appendRow([targetEmail, targetName, targetRole, targetStatus, effectiveAdmin, timestamp]);
      }

      writeAuditLog(ss, "UPDATE_PERMISSION", effectiveAdmin, authCheck.authMethod, targetEmail, `Role=${targetRole}, Status=${targetStatus}`);

      return jsonResponse({
        status: "SUCCESS",
        message: `Đã phân quyền thành công cho ${targetEmail}: ${targetRole}`
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 3B: YÊU CẦU CẤP QUYỀN VÀO HÀNG CHỜ DUYỆT (TỪ NHÂN VIÊN MỚI ĐĂNG NHẬP)
    // -------------------------------------------------------------------------
    if (action === "request_access") {
      const sPQ = ss.getSheetByName(SHEET_PHAN_QUYEN);
      const targetEmail = String(body.email || "").trim().toLowerCase();
      const targetName = String(body.name || targetEmail.split("@")[0]).trim();
      const desiredRole = String(body.desiredRole || "DAU_XUAT").trim();

      if (!targetEmail) {
        return jsonResponse({ status: "ERROR", message: "Email không được để trống!" });
      }

      const data = sPQ.getDataRange().getValues();
      let foundRow = -1;
      let currentRole = "";
      let currentStatus = "";

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0] || "").trim().toLowerCase() === targetEmail) {
          foundRow = i + 1;
          currentRole = String(data[i][2] || "").trim();
          currentStatus = String(data[i][3] || "").trim();
          break;
        }
      }

      const timestamp = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");

      if (foundRow > 0) {
        if (currentStatus === "HOAT_DONG") {
          return jsonResponse({
            status: "SUCCESS",
            message: "Tài khoản đã được duyệt trước đó!",
            role: currentRole,
            userStatus: "HOAT_DONG"
          });
        }
        // Đang chờ duyệt hoặc bị khóa -> cập nhật yêu cầu mới nhất
        sPQ.getRange(foundRow, 2).setValue(targetName);
        sPQ.getRange(foundRow, 3).setValue(desiredRole);
        sPQ.getRange(foundRow, 4).setValue("CHO_DUYET");
        sPQ.getRange(foundRow, 6).setValue(timestamp);
      } else {
        // Thêm vào hàng chờ duyệt
        sPQ.appendRow([targetEmail, targetName, desiredRole, "CHO_DUYET", "Tự đăng ký", timestamp]);
      }

      return jsonResponse({
        status: "SUCCESS",
        message: "Đã đưa tài khoản vào hàng chờ duyệt của Tổng Admin!",
        role: desiredRole,
        userStatus: "CHO_DUYET"
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 4: ĐIỀU CHUYỂN LÔ ĐÃ QUÉT SANG XE HOẶC CỬA HÀNG KHÁC
    // -------------------------------------------------------------------------
    if (action === "reassign_batch") {
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const oldTrip = String(body.oldTripCode || "").trim();
      const oldStore = String(body.oldStore || "").trim();
      const newTrip = String(body.newTripCode || oldTrip).trim();
      const newStore = String(body.newStore || oldStore).trim();
      const newStoreName = String(body.newStoreName || "").trim();

      const data = sXuat.getDataRange().getValues();
      let updatedCount = 0;

      for (let i = 1; i < data.length; i++) {
        const rowTrip = String(data[i][1] || "").trim();
        const rowStore = String(data[i][4] || "").trim();

        if (rowTrip === oldTrip && (!oldStore || rowStore === oldStore)) {
          const rowIdx = i + 1;
          if (newTrip) sXuat.getRange(rowIdx, 2).setValue(newTrip);
          if (newStore) sXuat.getRange(rowIdx, 5).setValue(newStore);
          if (newStoreName) sXuat.getRange(rowIdx, 6).setValue(newStoreName);
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        try { updateDoiChieuTongHopSheet(ss); } catch (eSum3) {}
      }

      return jsonResponse({
        status: "SUCCESS",
        message: `Đã điều chuyển ${updatedCount} kiện sang Chuyến ${newTrip} - Cửa hàng ${newStore}`
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 5: HOÀN TÁC KIỆN VỪA QUÉT NHẦM (UNDO SCAN)
    // -------------------------------------------------------------------------
    if (action === "undo_scan") {
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const tripCode = String(body.tripCode || "").trim();
      const packageCode = String(body.packageCode || "").trim();

      const data = sXuat.getDataRange().getValues();
      let found = false;

      for (let i = data.length - 1; i >= 1; i--) {
        const rowTrip = String(data[i][1] || "").trim();
        const rowPkg = String(data[i][2] || "").trim();

        if (rowTrip === tripCode && rowPkg === packageCode) {
          sXuat.getRange(i + 1, 10).setValue("ĐÃ_HỦY_QUÉT_NHẦM");
          found = true;
          break;
        }
      }

      if (found) {
        try { updateDoiChieuTongHopSheet(ss); } catch (eSum4) {}
      }

      return jsonResponse({
        status: found ? "SUCCESS" : "NOT_FOUND",
        message: found ? `Đã hoàn tác kiện ${packageCode}` : `Không tìm thấy kiện ${packageCode}`
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 6: LƯU & ĐỒNG BỘ FILE KHO TỔNG CHỐT LÊN TAB KHO_TONG_CHOT
    // -------------------------------------------------------------------------
    if (action === "save_master_dispatch") {
      // Nếu client có gửi thông tin người gọi thì kiểm tra quyền Admin
      if (body.requester || body.credential) {
        const authCheck = verifyAdminAuthority(ss, body);
        if (!authCheck.allowed) {
          writeAuditLog(ss, "SAVE_MASTER_DISPATCH_DENIED", authCheck.email, authCheck.authMethod, body.fileName || "", authCheck.message);
          return jsonResponse({ status: "ERROR", message: authCheck.message });
        }
      }

      const sKhoTong = ss.getSheetByName(SHEET_KHO_TONG);
      const rowsInput = Array.isArray(body.rows) ? body.rows : [];
      const fileName = String(body.fileName || "File_Kho_Tong_Chot.xlsb").trim();
      const updatedAt = String(body.updatedAt || Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss")).trim();

      if (rowsInput.length === 0) {
        return jsonResponse({ status: "ERROR", message: "Danh sách dòng File Kho Tổng Chốt trống!" });
      }

      // Xóa dữ liệu cũ từ dòng 2
      const lastRow = sKhoTong.getLastRow();
      if (lastRow > 1) {
        sKhoTong.getRange(2, 1, lastRow - 1, 15).clearContent();
      }

      const sheetRows = [];
      for (let i = 0; i < rowsInput.length; i++) {
        const r = rowsInput[i];
        sheetRows.push([
          String(r.doNumber || ""),
          String(r.soNumber || ""),
          String(r.storeCode || ""),
          String(r.storeName || ""),
          parseInt(r.packages, 10) || 1,
          parseInt(r.qtyPcs, 10) || 0,
          String(r.sttCh || ""),
          String(r.lotCode || ""),
          String(r.bks || ""),
          String(r.driver || ""),
          String(r.tonnage || ""),
          String(r.province || ""),
          String(r.district || ""),
          fileName,
          updatedAt
        ]);
      }

      if (sheetRows.length > 0) {
        sKhoTong.getRange(2, 1, sheetRows.length, 15).setValues(sheetRows);
      }

      writeAuditLog(ss, "SAVE_MASTER_DISPATCH", body.requester || "admin", body.credential ? "google_jwt" : "session", fileName, `Rows=${sheetRows.length}`);

      return jsonResponse({
        status: "SUCCESS",
        message: `Đã lưu & đồng bộ ${sheetRows.length} đơn DO từ ${fileName} lên Google Sheets!`,
        rowsCount: sheetRows.length
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 7: LƯU TRỮ (ARCHIVE) DỮ LIỆU CA CŨ ĐỂ TỐI ƯU TỐC ĐỘ SHEET (SRE)
    // -------------------------------------------------------------------------
    if (action === "archive_old_trips") {
      const authCheck = verifyAdminAuthority(ss, body);
      if (!authCheck.allowed) {
        return jsonResponse({ status: "ERROR", message: authCheck.message });
      }
      const daysOld = Math.max(1, parseInt(body.daysOld || "7", 10) || 7);
      const cutoffMs = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

      const sXuat = ss.getSheetByName(SHEET_XUAT);
      let sArchXuat = ss.getSheetByName("ARCHIVE_XUAT_KHO");
      if (!sArchXuat) {
        sArchXuat = ss.insertSheet("ARCHIVE_XUAT_KHO");
        sArchXuat.appendRow(sXuat.getRange(1, 1, 1, 11).getValues()[0]);
      }

      const data = sXuat.getDataRange().getValues();
      const keepRows = [];
      const archiveRows = [];
      for (let i = 1; i < data.length; i++) {
        const rowTime = new Date(data[i][0]).getTime();
        if (!isNaN(rowTime) && rowTime < cutoffMs) {
          archiveRows.push(data[i]);
        } else {
          keepRows.push(data[i]);
        }
      }

      if (archiveRows.length > 0) {
        sArchXuat.getRange(sArchXuat.getLastRow() + 1, 1, archiveRows.length, archiveRows[0].length).setValues(archiveRows);
        const lastR = sXuat.getLastRow();
        if (lastR > 1) sXuat.getRange(2, 1, lastR - 1, 11).clearContent();
        if (keepRows.length > 0) {
          sXuat.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
        }
      }

      writeAuditLog(ss, "ARCHIVE_OLD_TRIPS", authCheck.email, authCheck.authMethod, `>${daysOld}d`, `Archived=${archiveRows.length} rows`);

      return jsonResponse({
        status: "SUCCESS",
        archivedCount: archiveRows.length,
        remainingCount: keepRows.length,
        message: `Đã chuyển ${archiveRows.length} dòng cũ (> ${daysOld} ngày) sang tab ARCHIVE_XUAT_KHO!`
      });
    }

    return jsonResponse({ status: "ERROR", message: "Unknown action: " + action });

  } catch (err) {
    return jsonResponse({ status: "ERROR", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// Trả về dữ liệu chuẩn JSON
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// TỰ ĐỘNG TỔNG HỢP VÀO TAB "DOI_CHIEU_TONG_HOP" CHO QUẢN LÝ KHO
// =============================================================================
function updateDoiChieuTongHopSheet(ss) {
  try {
    if (!ss) ss = getSpreadsheet();
    const sXuat = ss.getSheetByName(SHEET_XUAT);
    const sNhap = ss.getSheetByName(SHEET_NHAP);
    let sDoiChieu = ss.getSheetByName(SHEET_DOI_CHIEU);
    if (!sXuat || !sNhap) return 0;
    if (!sDoiChieu) {
      setupSheets();
      sDoiChieu = ss.getSheetByName(SHEET_DOI_CHIEU);
    }

    const xuatData = sXuat.getDataRange().getValues();
    const nhapData = sNhap.getDataRange().getValues();

    // 1. Lập tập hợp các kiện đã nhập thành công
    const inboundMap = {};
    for (let j = 1; j < nhapData.length; j++) {
      const rowTrip = String(nhapData[j][1] || "").trim();
      const rowPkg = String(nhapData[j][2] || "").trim();
      const rowStatus = String(nhapData[j][8] || "").trim();
      if (rowStatus === "ĐÃ_HỦY_QUÉT_NHẦM") continue;

      if (rowPkg) {
        if (rowTrip) inboundMap[`${rowTrip}___${rowPkg}`] = true;
        inboundMap[rowPkg] = true;
      }
    }

    // 2. Nhóm dữ liệu xuất theo Chuyến xe & Cửa hàng
    const summaryMap = {};

    for (let i = 1; i < xuatData.length; i++) {
      const trip = String(xuatData[i][1] || "").trim();
      const pkg = String(xuatData[i][2] || "").trim();
      const rowStatus = String(xuatData[i][9] || "").trim();
      if (!trip || !pkg || rowStatus === "ĐÃ_HỦY_QUÉT_NHẦM") continue;

      const chCode = String(xuatData[i][4] || "").trim();
      const storeName = String(xuatData[i][5] || "").trim();
      const storeLabel = (chCode && storeName && chCode !== storeName) ? `${chCode} - ${storeName}` : (chCode || storeName || "Chung");
      const groupKey = `${trip}___${storeLabel}`;

      if (!summaryMap[groupKey]) {
        summaryMap[groupKey] = {
          tripCode: trip,
          storeLabel: storeLabel,
          totalExported: 0,
          totalInbound: 0
        };
      }

      summaryMap[groupKey].totalExported++;

      if (inboundMap[`${trip}___${pkg}`] || inboundMap[pkg]) {
        summaryMap[groupKey].totalInbound++;
      }
    }

    const rows = [];
    const timestampNow = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");

    const groupKeys = Object.keys(summaryMap);
    for (let k = 0; k < groupKeys.length; k++) {
      const item = summaryMap[groupKeys[k]];
      const missing = Math.max(0, item.totalExported - item.totalInbound);
      const pct = item.totalExported > 0 ? Math.round((item.totalInbound / item.totalExported) * 100) : 0;
      
      let statusText = "⏳ CHƯA DỠ HÀNG";
      if (missing === 0 && item.totalExported > 0) {
        statusText = "✅ ĐÃ ĐỐI CHIẾU ĐỦ 100%";
      } else if (item.totalInbound > 0) {
        statusText = `⚠️ ĐANG DỠ (THIẾU ${missing} KIỆN)`;
      }

      rows.push([
        item.tripCode,
        item.storeLabel,
        item.totalExported,
        item.totalInbound,
        missing,
        0, // Kiện lạ / lẫn hàng
        `${pct}%`,
        statusText,
        timestampNow
      ]);
    }

    // 3. Xóa dữ liệu cũ từ dòng 2
    const lastRow = sDoiChieu.getLastRow();
    if (lastRow > 1) {
      sDoiChieu.getRange(2, 1, lastRow - 1, 9).clearContent().clearFormat();
    }

    // 4. Ghi dữ liệu mới vào tab DOI_CHIEU_TONG_HOP
    if (rows.length > 0) {
      const range = sDoiChieu.getRange(2, 1, rows.length, 9);
      range.setValues(rows);

      // Định dạng canh giữa
      sDoiChieu.getRange(2, 3, rows.length, 5).setHorizontalAlignment("center");
      sDoiChieu.getRange(2, 9, rows.length, 1).setHorizontalAlignment("center");

      // Định dạng màu sắc trạng thái
      for (let r = 0; r < rows.length; r++) {
        const rowIdx = r + 2;
        const statusCell = sDoiChieu.getRange(rowIdx, 8);
        const st = rows[r][7];
        if (st.includes("ĐỦ 100%")) {
          statusCell.setBackground("#dcfce7").setFontColor("#166534").setFontWeight("bold");
        } else if (st.includes("ĐANG DỠ")) {
          statusCell.setBackground("#fef9c3").setFontColor("#854d0e").setFontWeight("bold");
        } else {
          statusCell.setBackground("#f1f5f9").setFontColor("#475569").setFontWeight("normal");
        }
      }
    }

    return rows.length;
  } catch (err) {
    console.error("Lỗi cập nhật sheet Đối Chiếu Tổng Hợp:", err);
    return 0;
  }
}
