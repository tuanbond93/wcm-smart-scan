// =============================================================================
// WCM SMART SCAN - CẤU HÌNH TRUNG TÂM TOÀN KHO (MASTER CONFIG)
// TẤT CẢ các thiết bị điện thoại/PDA mở ứng dụng đều tự động dùng chung cấu hình này!
// Nhân viên kho KHÔNG CẦN và KHÔNG PHẢI tự cấu hình Google Sheet trên từng máy.
// =============================================================================

window.WCM_CONFIG = {
    // Tên kho / Chi nhánh
    WAREHOUSE_NAME: "Kho Toll Supra",

    // TÀI KHOẢN SUPER ADMIN QUYỀN CAO NHẤT (Toàn quyền quản trị & phân quyền):
    SUPER_ADMIN_EMAIL: "tuanns@ghn.vn",

    // GOOGLE OAUTH CLIENT ID (Google Identity Services):
    // Dán Client ID tạo từ Google Cloud Console (nếu có):
    GOOGLE_CLIENT_ID: "498399089603-cu6heqvviok8srtl8nkg45c96isp1tdc.apps.googleusercontent.com",

    // URL ỨNG DỤNG WEB GOOGLE APPS SCRIPT DÙNG CHUNG TOÀN BỘ KHO:
    MASTER_GOOGLE_SHEET_URL: "",

    // Tự động kiểm tra đồng bộ chéo giữa các máy (ms)
    SYNC_INTERVAL_MS: 5000,

    // DANH SÁCH NHÂN VIÊN ĐÃ ĐƯỢC PHÊ DUYỆT SẴN (Đồng bộ tức thì mọi thiết bị):
    INITIAL_PERMISSIONS: [
        {
            email: "sontuandav@gmail.com",
            name: "Tuấn Nguyễn Sơn",
            role: "DAU_XUAT",
            status: "HOAT_DONG",
            assignedBy: "tuanns@ghn.vn",
            assignedAt: "2026-09-17T04:32:15.084Z"
        }
    ],

    // Định nghĩa các vai trò trong kho:
    ROLES: {
        SUPER_ADMIN: "SUPER_ADMIN", // Quản trị viên tối cao (tuanns@ghn.vn)
        EXPORT: "DAU_XUAT",         // Nhân viên đầu xuất (Chỉ thấy tính năng Xuất)
        IMPORT: "DAU_NHAP"          // Nhân viên đầu nhập (Chỉ thấy tính năng Nhập)
    }
};
