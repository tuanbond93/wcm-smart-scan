// =============================================================================
// WCM SMART SCAN - CẤU HÌNH TRUNG TÂM TOÀN KHO (MASTER CONFIG)
// TẤT CẢ các thiết bị điện thoại/PDA mở ứng dụng đều tự động dùng chung cấu hình này!
// Nhân viên kho KHÔNG CẦN và KHÔNG PHẢI tự cấu hình Google Sheet trên từng máy.
// =============================================================================

window.WCM_CONFIG = {
    // Tên kho / Chi nhánh
    WAREHOUSE_NAME: "Kho Toll Supra",

    // URL ỨNG DỤNG WEB GOOGLE APPS SCRIPT DÙNG CHUNG TOÀN BỘ KHO:
    // Dán URL Web App (https://script.google.com/macros/s/.../exec) vào đây.
    // Khi đẩy lên Vercel, 100% nhân viên mở web là tự động kết nối vào đúng 1 sheet này!
    MASTER_GOOGLE_SHEET_URL: "",

    // Tự động kiểm tra đồng bộ chéo giữa các máy (ms)
    SYNC_INTERVAL_MS: 3000
};
