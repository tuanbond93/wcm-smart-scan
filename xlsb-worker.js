// =============================================================================
// WCM SMART SCAN - WEB WORKER ĐỌC FILE KHO TỔNG CHỐT (.XLSB / .XLSX / .CSV)
// Giải phóng hoàn toàn Main Thread để Camera & Giao diện không bị khựng khi nạp file lớn
// =============================================================================

/* global importScripts, XLSX */

let xlsxLoaded = false;

function ensureXlsxLoaded() {
    if (xlsxLoaded && typeof XLSX !== 'undefined') return true;
    try {
        importScripts('./xlsx.full.min.js?v=20261013_fix');
        xlsxLoaded = typeof XLSX !== 'undefined';
    } catch (err) {
        try {
            importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
            xlsxLoaded = typeof XLSX !== 'undefined';
        } catch (err2) {
            console.warn('[XLSB-Worker] Không thể nạp xlsx.full.min.js:', err2);
            xlsxLoaded = false;
        }
    }
    return xlsxLoaded;
}

function cleanVal(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
        return Number.isInteger(v) ? String(v) : String(v);
    }
    return String(v).trim().replace(/\.0$/, '');
}

function parseMasterDispatchRowsInWorker(rows, fileName) {
    if (!rows || rows.length < 2) return null;

    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
        const rowStr = (rows[i] || []).map(c => String(c || '').toLowerCase()).join('|');
        if (rowStr.includes('số do') || rowStr.includes('mã siêu thị') || rowStr.includes('tên siêu thị') || rowStr.includes('mã ch') || rowStr.includes('tổng kiện')) {
            headerRowIdx = i;
            break;
        }
    }

    const headers = (rows[headerRowIdx] || []).map(h => String(h || '').trim().toLowerCase());
    const isStandardFullSheet = headers.length >= 15;
    let soIdx = isStandardFullSheet ? 2 : -1;
    let doIdx = isStandardFullSheet ? 3 : -1;
    let storeCodeIdx = isStandardFullSheet ? 4 : -1;
    let storeNameIdx = isStandardFullSheet ? 5 : -1;
    let pcsIdx = isStandardFullSheet ? 6 : -1;
    let pkgCountIdx = isStandardFullSheet ? 7 : -1;
    let provinceIdx = isStandardFullSheet ? 10 : -1;
    let districtIdx = isStandardFullSheet ? 11 : -1;
    let lotIdx = isStandardFullSheet ? 12 : -1;
    let tonnageIdx = isStandardFullSheet ? 16 : -1;
    let siteTinhIdx = isStandardFullSheet ? 17 : -1;
    let siteDoIdx = isStandardFullSheet ? 18 : -1;
    let sttChIdx = isStandardFullSheet ? 19 : -1;
    let noteIdx = isStandardFullSheet ? 21 : -1;
    let bksIdx = isStandardFullSheet ? 29 : -1;
    let driverIdx = isStandardFullSheet ? 30 : -1;

    headers.forEach((h, i) => {
        if (!h) return;
        if (h === 'số so' || h === 'so' || h.includes('số so') || h.includes('so number')) soIdx = i;
        else if (h === 'số do' || h === 'do' || h.includes('số do') || h.includes('do number')) doIdx = i;
        else if (h.includes('mã siêu thị') || h.includes('mã ch') || h.includes('mã cửa hàng') || h === 'mã st' || h === 'sap' || h === 'store_code') storeCodeIdx = i;
        else if (h.includes('tên siêu thị') || h.includes('tên cửa hàng') || h.includes('tên ch') || h === 'store_name') storeNameIdx = i;
        else if (h === 'qty' || (h.includes('pcs') && !h.includes('tổng pcs')) || h === 'số lượng') pcsIdx = i;
        else if ((h.includes('tổng pcs') || h.includes('số kiện') || h.includes('tổng kiện') || h.includes('tổng số kiện') || h.includes('số lượng kiện') || h === 'kiện' || h === 'kien' || h.includes('packages')) && !h.includes('tổng số kiện xe')) pkgCountIdx = i;
        else if ((h === 'tỉnh' || h === 'tỉnh') && !h.includes('site') && !h.includes('pcs')) provinceIdx = i;
        else if (h.includes('quận') || h.includes('quận') || h.includes('huyện')) districtIdx = i;
        else if (h.includes('mã giờ')) lotIdx = i;
        else if (h.includes('trọng tải')) tonnageIdx = i;
        else if (h.includes('site tỉnh') || h.includes('site tỉnh')) siteTinhIdx = i;
        else if (h.includes('site do')) siteDoIdx = i;
        else if (h.includes('số thứ tự') || h.includes('số thứ tự')) sttChIdx = i;
        else if (h.includes('ghi chú 2')) noteIdx = i;
        else if (h === 'bks' || h.includes('biển số')) bksIdx = i;
        else if (h.includes('tài xế') || h.includes('lái xe')) driverIdx = i;
    });

    const records = [];
    let currentLot = '';
    let currentBks = '';
    let currentDriver = '';
    let currentTonnage = '';

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 2) continue;

        const soNum = soIdx >= 0 ? cleanVal(r[soIdx]) : '';
        const doNum = doIdx >= 0 ? cleanVal(r[doIdx]) : '';
        const storeCode = storeCodeIdx >= 0 ? cleanVal(r[storeCodeIdx]).toUpperCase() : '';
        const storeName = storeNameIdx >= 0 ? cleanVal(r[storeNameIdx]) : '';
        if (!doNum && !storeCode) continue;

        const pcsQty = pcsIdx >= 0 ? (parseInt(String(r[pcsIdx]).replace(/,/g, ''), 10) || 0) : 0;
        const pkgCount = pkgCountIdx >= 0 ? Math.max(1, parseInt(String(r[pkgCountIdx]).replace(/,/g, ''), 10) || 1) : 1;
        const prov = provinceIdx >= 0 ? cleanVal(r[provinceIdx]) : '';
        const dist = districtIdx >= 0 ? cleanVal(r[districtIdx]) : '';
        const lotCode = lotIdx >= 0 ? cleanVal(r[lotIdx]) : '';
        const tonnage = tonnageIdx >= 0 ? cleanVal(r[tonnageIdx]) : '';
        const siteTinh = siteTinhIdx >= 0 ? cleanVal(r[siteTinhIdx]) : '';
        const siteDo = siteDoIdx >= 0 ? cleanVal(r[siteDoIdx]) : '';
        const sttCh = sttChIdx >= 0 ? cleanVal(r[sttChIdx]) : '';
        const note = noteIdx >= 0 ? cleanVal(r[noteIdx]) : '';
        const rowBks = bksIdx >= 0 ? cleanVal(r[bksIdx]).toUpperCase() : '';
        const rowDriver = driverIdx >= 0 ? cleanVal(r[driverIdx]) : '';

        if (lotCode !== currentLot) {
            currentLot = lotCode;
            currentBks = rowBks;
            currentDriver = rowDriver;
            currentTonnage = tonnage;
        } else {
            if (rowBks) {
                currentBks = rowBks;
                currentDriver = rowDriver;
            }
            if (tonnage) {
                currentTonnage = tonnage;
            }
        }

        records.push({
            soNumber: soNum,
            doNumber: doNum,
            storeCode: storeCode,
            storeName: storeName,
            pcsQty: pcsQty,
            pkgCount: pkgCount,
            province: prov,
            district: dist,
            lotCode: lotCode,
            tonnage: currentTonnage,
            siteTinh: siteTinh,
            siteDo: siteDo,
            sttCh: sttCh,
            note: note,
            bks: currentBks,
            driver: currentDriver
        });
    }

    if (records.length === 0) return null;

    return {
        sourceFile: fileName || 'File Kho Tổng Chốt',
        updatedAt: new Date().toISOString(),
        totalRows: records.length,
        records: records
    };
}

self.onmessage = function(e) {
    const msg = e.data || {};
    if (msg.action === 'PARSE_XLSB_BUFFER') {
        try {
            if (!ensureXlsxLoaded()) {
                self.postMessage({ status: 'ERROR', error: 'XLSX_NOT_LOADED_IN_WORKER' });
                return;
            }
            const t0 = Date.now();
            const uint8 = new Uint8Array(msg.buffer);
            const wb = XLSX.read(uint8, { type: 'array' });
            const targetSheetName = wb.SheetNames.find(n => n.toLowerCase() === 'total') || wb.SheetNames[0];
            const sheet = wb.Sheets[targetSheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            const payload = parseMasterDispatchRowsInWorker(rows, msg.fileName);
            const elapsedMs = Date.now() - t0;

            self.postMessage({
                status: 'SUCCESS',
                payload: payload,
                elapsedMs: elapsedMs
            });
        } catch (err) {
            self.postMessage({
                status: 'ERROR',
                error: err && err.message ? err.message : String(err)
            });
        }
    }
};
