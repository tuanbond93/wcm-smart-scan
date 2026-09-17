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

    // DANH SÁCH XE XUẤT HÀNG DÙNG CHUNG TOÀN KHO (Tự động nạp vào mọi điện thoại / máy quét):
    MASTER_TRIP_LIST: [
        { code: "14H-020.61", label: "14H-020.61" },
        { code: "29K-079.63", label: "29K-079.63" },
        { code: "29H-958.93", label: "29H-958.93" },
        { code: "88H-053.31", label: "88H-053.31" },
        { code: "88B-044.54", label: "88B-044.54" },
        { code: "88H-029.27", label: "88H-029.27" },
        { code: "29K-136.74", label: "29K-136.74" },
        { code: "29E-107.37", label: "29E-107.37" },
        { code: "19H-206.14", label: "19H-206.14" },
        { code: "88H-014.82", label: "88H-014.82" },
        { code: "88H-006.07", label: "88H-006.07" }
    ],

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
