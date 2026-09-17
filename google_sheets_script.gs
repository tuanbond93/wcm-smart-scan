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

const SHEET_XUAT = "XUAT_KHO";
const SHEET_NHAP = "NHAP_KHO";
const SHEET_DOI_CHIEU = "DOI_CHIEU_TONG_HOP";

// Tự động khởi tạo cấu trúc 3 Tab khi lần đầu chạy
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
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
  
  return { sXuat, sNhap, sDoiChieu };
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
      const ss = SpreadsheetApp.getActiveSpreadsheet();
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

    // 3. Đầu Nhập tải toàn bộ danh sách kiện đã xuất của 1 Chuyến xe để bắn đối chiếu
    if (action === "get_trip_manifest") {
      const tripCode = String(params.tripCode || "").trim();
      if (!tripCode) {
        return jsonResponse({ status: "ERROR", message: "Missing tripCode parameter" });
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sXuat = ss.getSheetByName(SHEET_XUAT);
      const sNhap = ss.getSheetByName(SHEET_NHAP);

      const xuatData = sXuat.getDataRange().getValues();
      const nhapData = sNhap.getDataRange().getValues();

      // Danh sách các kiện đã nhập của chuyến này
      const scannedInboundMap = {};
      for (let j = 1; j < nhapData.length; j++) {
        const rowTrip = String(nhapData[j][1] || "").trim();
        const rowPkg = String(nhapData[j][2] || "").trim();
        if (rowTrip === tripCode && rowPkg) {
          scannedInboundMap[rowPkg] = {
            operator: nhapData[j][6],
            timestamp: nhapData[j][0],
            status: nhapData[j][8]
          };
        }
      }

      const packages = [];
      for (let i = 1; i < xuatData.length; i++) {
        const rowTrip = String(xuatData[i][1] || "").trim();
        if (rowTrip === tripCode) {
          const pkgCode = String(xuatData[i][2] || "").trim();
          const isInboundScanned = !!scannedInboundMap[pkgCode];
          packages.push({
            packageCode: pkgCode,
            doNumber: String(xuatData[i][3] || ""),
            chCode: String(xuatData[i][4] || ""),
            storeName: String(xuatData[i][5] || ""),
            pkgIdxText: String(xuatData[i][6] || ""),
            exportOperator: String(xuatData[i][7] || ""),
            exportTime: String(xuatData[i][0] || ""),
            inboundScanned: isInboundScanned,
            inboundOperator: isInboundScanned ? scannedInboundMap[pkgCode].operator : "",
            inboundTime: isInboundScanned ? scannedInboundMap[pkgCode].timestamp : ""
          });
        }
      }

      return jsonResponse({
        status: "SUCCESS",
        tripCode: tripCode,
        totalExported: packages.length,
        totalInboundReceived: Object.keys(scannedInboundMap).length,
        packages: packages
      });
    }

    // 4. Đồng bộ thời gian thực giữa 2 máy đang bắn cùng 1 chuyến
    if (action === "sync_peer_scans") {
      const tripCode = String(params.tripCode || "").trim();
      const mode = String(params.mode || "Xuất").trim();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(mode === "Nhập" ? SHEET_NHAP : SHEET_XUAT);
      const data = sheet.getDataRange().getValues();
      const scannedKeys = [];

      for (let i = 1; i < data.length; i++) {
        const rowTrip = String(data[i][1] || "").trim();
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
        totalScanned: scannedKeys.length,
        scannedItems: scannedKeys
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();

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
        if (trip && pkg) {
          exportedMap[`${trip}___${pkg}`] = {
            doNumber: xuatData[i][3],
            chCode: xuatData[i][4],
            storeName: xuatData[i][5]
          };
        }
      }

      // Nạp danh sách đã nhập để kiểm tra trùng
      const nhapData = sNhap.getDataRange().getValues();
      const inboundSet = new Set();
      for (let j = 1; j < nhapData.length; j++) {
        const trip = String(nhapData[j][1] || "").trim();
        const pkg = String(nhapData[j][2] || "").trim();
        if (trip && pkg) {
          inboundSet.add(`${trip}___${pkg}`);
        }
      }

      const rowsToAppend = [];
      const results = [];

      for (let k = 0; k < scans.length; k++) {
        const item = scans[k];
        const tripCode = String(item.tripCode || "").trim();
        const pkgCode = String(item.packageCode || item.uniqueKey || "").trim();
        const checkKey = `${tripCode}___${pkgCode}`;

        let verdict = "KHỚP ĐÚNG CHUYẾN";
        let note = "";

        if (inboundSet.has(checkKey)) {
          verdict = "TRÙNG ĐÃ NHẬP";
          note = "Kiện đã được quét trước đó tại đầu nhập";
        } else if (!exportedMap[checkKey]) {
          verdict = "HÀNG LẠC / SAI CHUYẾN";
          note = "Không tìm thấy mã kiện trong danh sách xuất của chuyến này!";
        }

        inboundSet.add(checkKey);

        const expInfo = exportedMap[checkKey] || {};
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
          verdict: verdict,
          note: note
        });
      }

      if (rowsToAppend.length > 0) {
        sNhap.getRange(sNhap.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
      }

      return jsonResponse({
        status: "SUCCESS",
        results: results
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
