// =============================================================================
// WCM SMART SCAN - ONBOARDING WALKTHROUGH MODULE (PHASE 2 TASK 2.4)
// Hướng dẫn 4 bước cho nhân viên kho mới vào ca làm việc
// =============================================================================

(function() {
    'use strict';

    const STORAGE_KEY_ONBOARDED = 'wcm_has_onboarded_v1';

    const ONBOARDING_STEPS = [
        {
            badge: 'BƯỚC 1 / 4',
            title: '🎯 Chọn Đúng Chế Độ Làm Việc',
            content: `
                <ul>
                    <li>📥 <strong>Đầu Nhập:</strong> Dành cho công nhân dỡ kiện từ xe tải về kho. Hệ thống tự động phân tích mã Chute <code>CH.x.x</code> và đọc to tên cửa hàng đích để xếp vào đúng line.</li>
                    <li>📤 <strong>Đầu Xuất:</strong> Dành cho công nhân bốc xếp hàng lên xe tải. Hệ thống đếm chuẩn số lượng và <strong>còi hú báo động ngay lập tức</strong> nếu phát hiện kiện lẫn từ cửa hàng khác!</li>
                </ul>
            `
        },
        {
            badge: 'BƯỚC 2 / 4',
            title: '🚛 Thiết Lập Lô Xuất Xe Nhanh (Đầu Xuất)',
            content: `
                <ul>
                    <li>Bấm chọn nhanh <strong>Chuyến Xe</strong> (ví dụ: Chuyến 1392 Phú Thọ, 1405 Vĩnh Phúc, 1420 Hà Nội).</li>
                    <li>Bấm chọn <strong>Cửa Hàng</strong> trong danh mục: Hệ thống sẽ tự động điền số lượng kiện kế hoạch của cửa hàng đó.</li>
                    <li>Bấm nút <strong>"💾 Áp dụng Lô này"</strong> để kích hoạt lô quét.</li>
                </ul>
            `
        },
        {
            badge: 'BƯỚC 3 / 4',
            title: '🔫 Cách Quét Kiện Chuẩn Xác',
            content: `
                <ul>
                    <li><strong>Trên máy PDA chuyên dụng:</strong> Hệ thống đã tự động khóa bàn phím ảo. Bạn chỉ cần bóp cò súng laser cách tem mã <strong>20 – 30 cm</strong> là máy tự nhận mã tức thì.</li>
                    <li><strong>Trên điện thoại thông minh:</strong> Bấm <code>📷 Bật Camera</code>. Nếu làm việc trong thùng xe tối, bấm <code>🔦 Đèn Flash</code> để trợ sáng.</li>
                </ul>
            `
        },
        {
            badge: 'BƯỚC 4 / 4',
            title: '🔊 Tín Hiệu 3 Giác Quan (Nghe & Nhìn)',
            content: `
                <ul>
                    <li>🟢 <strong>Tiếng bíp ngắn + Giọng đọc tên shop:</strong> Kiện hợp lệ -> Bốc xếp lên xe ngay.</li>
                    <li>🚨 <strong>CÒI HÚ INH ỎI + MÀN HÌNH ĐỎ + RUNG MẠNH:</strong> SAI CỬA HÀNG (LẪN HÀNG)! Kiện này không thuộc chuyến xe/shop này. Bỏ riêng kiện ra ngay!</li>
                    <li>🟡 <strong>Tiếng bíp đôi 2 tiếng:</strong> Đã trùng kiện (máy này hoặc đồng đội đã bắn trước đó rồi).</li>
                    <li>🎉 <strong>Nhạc Fanfare chiến thắng:</strong> ĐÃ ĐỦ 100% SỐ KIỆN KẾ HOẠCH! Đổi sang lô cửa hàng tiếp theo.</li>
                </ul>
            `
        }
    ];

    let currentStep = 0;
    let modalEl = null;

    function renderStep() {
        if (!modalEl) return;
        const step = ONBOARDING_STEPS[currentStep];

        const elBadge = modalEl.querySelector('#onboarding-badge');
        const elHeading = modalEl.querySelector('#onboarding-heading');
        const elContent = modalEl.querySelector('#onboarding-content');
        const elBtnPrev = modalEl.querySelector('#btn-onboard-prev');
        const elBtnNext = modalEl.querySelector('#btn-onboard-next');
        const elDotsContainer = modalEl.querySelector('#onboarding-dots');

        if (elBadge) elBadge.textContent = step.badge;
        if (elHeading) elHeading.textContent = step.title;
        if (elContent) elContent.innerHTML = step.content;

        if (elBtnPrev) {
            elBtnPrev.style.visibility = currentStep === 0 ? 'hidden' : 'visible';
        }

        if (elBtnNext) {
            if (currentStep === ONBOARDING_STEPS.length - 1) {
                elBtnNext.textContent = '✅ Đã hiểu & Bắt đầu';
                elBtnNext.className = 'btn btn-primary btn-sm';
            } else {
                elBtnNext.textContent = 'Tiếp tục ➔';
                elBtnNext.className = 'btn btn-primary btn-sm';
            }
        }

        if (elDotsContainer) {
            elDotsContainer.innerHTML = ONBOARDING_STEPS.map((_, idx) => `
                <div class="onboarding-dot ${idx === currentStep ? 'active' : ''}"></div>
            `).join('');
        }
    }

    function openOnboardingModal() {
        if (modalEl) modalEl.remove();

        currentStep = 0;

        modalEl = document.createElement('div');
        modalEl.className = 'onboarding-overlay';
        modalEl.innerHTML = `
            <div class="onboarding-card">
                <div class="onboarding-header">
                    <span class="onboarding-title">📖 HƯỚNG DẪN THAO TÁC KHO</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-close-onboarding" style="padding: 0.2rem 0.5rem;">✕</button>
                </div>

                <div class="onboarding-body">
                    <span class="onboarding-step-badge" id="onboarding-badge"></span>
                    <div class="onboarding-step-heading" id="onboarding-heading"></div>
                    <div class="onboarding-step-content" id="onboarding-content"></div>
                </div>

                <div class="onboarding-footer">
                    <div class="onboarding-dots" id="onboarding-dots"></div>
                    <div class="onboarding-actions">
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-onboard-prev">Quay lại</button>
                        <button type="button" class="btn btn-primary btn-sm" id="btn-onboard-next">Tiếp tục ➔</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalEl);

        modalEl.querySelector('#btn-close-onboarding').onclick = closeOnboardingModal;
        modalEl.querySelector('#btn-onboard-prev').onclick = () => {
            if (currentStep > 0) {
                currentStep--;
                renderStep();
            }
        };
        modalEl.querySelector('#btn-onboard-next').onclick = () => {
            if (currentStep < ONBOARDING_STEPS.length - 1) {
                currentStep++;
                renderStep();
            } else {
                closeOnboardingModal();
            }
        };

        renderStep();
    }

    function closeOnboardingModal() {
        try {
            localStorage.setItem(STORAGE_KEY_ONBOARDED, 'true');
        } catch (e) {}
        if (modalEl) {
            modalEl.remove();
            modalEl = null;
        }
    }

    // Auto-check for first visit
    function checkFirstTimeUser() {
        const hasSeen = localStorage.getItem(STORAGE_KEY_ONBOARDED);
        if (!hasSeen) {
            setTimeout(() => {
                // Only show if user is authenticated or login is completed
                if (!document.body.classList.contains('not-logged-in') &&
                    !document.body.classList.contains('role-unauthorized')) {
                    openOnboardingModal();
                }
            }, 1000);
        }
    }

    window.WCM_ONBOARDING = {
        open: openOnboardingModal,
        close: closeOnboardingModal,
        init: checkFirstTimeUser
    };

    window.addEventListener('DOMContentLoaded', () => {
        checkFirstTimeUser();

        // Connect guide button if present
        const btnGuide = document.getElementById('btn-open-onboarding');
        if (btnGuide) {
            btnGuide.addEventListener('click', openOnboardingModal);
        }
    });
})();
