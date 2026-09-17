# SỔ TAY VẬN HÀNH PILOT THỰC TẾ TẠI KHO (PILOT RUNBOOK)

**Dành cho:** Quản lý Kho, Giám sát Ca và Nhân viên thử nghiệm trực tiếp  
**Mục tiêu:** Đo lường chính xác tốc độ, tỷ lệ quét lần đầu (First-Pass Rate) và độ ổn định khi nhân viên thao tác quét kiện liên tục tại kho thật.

---

## 1. ĐƯỜNG DẪN TRUY CẬP CHẾ ĐỘ PILOT (PILOT URL)

* **Link trực tiếp:** [https://wcm-smart-scan.vercel.app?pilot=1](https://wcm-smart-scan.vercel.app?pilot=1)
* **Hoặc:** Truy cập [https://wcm-smart-scan.vercel.app](https://wcm-smart-scan.vercel.app) và bấm nút màu cam **[ 📋 Pilot Kho ]** ở góc phải thanh tiêu đề.

---

## 2. QUY TẮC BẮT BUỘC DÀNH CHO QUẢN LÝ (MANAGER RULES)

> [!IMPORTANT]
> **HAI MÔ HÌNH VẬN HÀNH THỬ NGHIỆM:**  
> Hệ thống hỗ trợ 2 hình thức triển khai tùy thuộc mục tiêu ca đo:
> 
> * **Mô hình 1 — Đo năng suất cá nhân độc lập (Baseline KPI):**  
>   Chia riêng 2 pool kiện: **NV01** phụ trách lô riêng (50 – 100 kiện tại Cửa xe A), **NV02** phụ trách lô riêng (50 – 100 kiện tại Cửa xe B). Cách này giúp đo thông lượng và tỷ lệ First-Pass chuẩn xác của từng nhân viên.
> 
> * **Mô hình 2 — Phối hợp 2 người cùng xếp 1 xe (Dual-Operator Peer Sync):**  
>   Cả 2 nhân viên cùng nhập chung một **Mã Chuyến Xe** (ví dụ: `1392`). Hệ thống tự động kích hoạt chế độ đồng bộ chéo thời gian thực qua Google Sheets:
>   - Tiến độ hiển thị tổng số kiện của cả 2 máy (Máy này + Đồng đội).
>   - Nếu NV01 đã quét kiện X, khi NV02 quét lại kiện X, máy của NV02 sẽ cảnh báo trùng kiện tức thì: *"Đã trùng! [Tên NV01] đã bắn kiện này rồi!"*.
>   - Đảm bảo cả 2 thiết bị đều đã kết nối chung link Google Sheets kho.

### Quy trình 6 bước của Quản lý:
1. **Phân công:** Chọn 1 đến 2 nhân viên thao tác nhanh nhẹn, quen quét hàng.
2. **Chuẩn bị máy:** Hướng dẫn nhân viên mở link trên bằng Chrome (Android) hoặc Safari (iOS). Khuyến khích vào Cài đặt điện thoại chỉnh thời gian tắt màn hình >= 10 phút.
3. **Giám sát bắt đầu:** Đảm bảo nhân viên nhập đúng Mã NV (ví dụ: `NV01`), chọn đúng luồng (Đầu Nhập hoặc Đầu Xuất), chọn 50 hoặc 100 kiện, rồi bấm **"Bắt đầu Pilot"**.
4. **Không can thiệp:** Để nhân viên quét hoàn toàn tự nhiên theo thói quen hàng ngày, không nhắc nhở ép tiến độ hoặc làm chậm để lấy số liệu đẹp.
5. **Giám sát kết thúc:** Khi quét đủ số kiện, nhắc nhân viên bấm **"🏁 Kết thúc Pilot"**.
6. **Thu thập Evidence:** Yêu cầu nhân viên bấm nút màu xanh **"📥 TẢI BỘ EVIDENCE"** và gửi 3 tệp tải về (`.csv`, `_summary.json`, `_feedback.json`) qua Zalo/Email cho Quản lý/QA.

---

## 3. HƯỚNG DẪN 6 BƯỚC DÀNH CHO NHÂN VIÊN QUÉT (OPERATOR GUIDE)

* **Bước 1:** Mở đường link [https://wcm-smart-scan.vercel.app?pilot=1](https://wcm-smart-scan.vercel.app?pilot=1) trên điện thoại hoặc máy PDA.
* **Bước 2:** Nhập mã của bạn (ví dụ: `NV01`), chọn luồng làm việc (**Đầu Xuất** hoặc **Đầu Nhập**), chọn số kiện (50 hoặc 100) -> Bấm nút cam **"🚀 Bắt đầu Pilot"**.
* **Bước 3:** Bấm nút **"📷 Bật Camera"** (chọn *Cho phép/Allow* nếu trình duyệt hỏi quyền).
* **Bước 4:** Bắt đầu quét kiện liên tục:
  * Cầm máy cách mã QR khoảng **20 – 30 cm**.
  * **Tiếng bíp ngắn + ô xanh:** Kiện chuẩn hợp lệ -> Xếp lên xe / Đưa vào line.
  * **Còi hú inh ỏi + màn hình đỏ:** Sai cửa hàng (Lẫn hàng) -> Bỏ riêng kiện ra ngay!
  * **Tiếng bíp đôi 2 tiếng:** Kiện quét trùng -> Kiểm tra lại.
  * Nếu làm việc trong thùng xe tối: Bấm nút **"🔦 Đèn Flash"** để bật đèn trợ sáng.
* **Bước 5:** Khi đồng hồ đếm đạt đủ số kiện kế hoạch -> Bấm nút đỏ **"🏁 Kết thúc Pilot"**.
* **Bước 6:** Trả lời nhanh 5 câu hỏi khảo sát ngắn trên màn hình, rồi bấm nút xanh **"📥 TẢI BỘ EVIDENCE"** và gửi file cho Tổ trưởng/Quản lý.

---

## 4. BA TỆP BẰNG CHỨNG THU ĐƯỢC (EVIDENCE ARTIFACTS)

Sau mỗi phiên Pilot, hệ thống tự động xuất 3 tệp:
1. `pilot_<SESSION_ID>_events.csv`: Nhật ký từng lần đưa kiện vào máy (thời gian chính xác đến từng millisecond, mã QR đọc được, kết quả hợp lệ / trùng / lẫn hàng, độ trễ giải mã).
2. `pilot_<SESSION_ID>_summary.json`: Báo cáo tổng hợp được tính toán tự động từ nhật ký (Tỷ lệ First-Pass, Rescan, Throughput kiện/phút, thời lượng ca).
3. `pilot_<SESSION_ID>_feedback.json`: Ý kiến phản hồi thực tế của nhân viên.
