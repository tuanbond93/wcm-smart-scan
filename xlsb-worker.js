// =============================================================================
// WCM SMART SCAN - WEB WORKER ĐỌC FILE KHO TỔNG CHỐT (.XLSB / .XLSX / .CSV)
// Giải phóng hoàn toàn Main Thread để Camera & Giao diện không bị khựng khi nạp file lớn
// =============================================================================

/* global importScripts, XLSX */

let xlsxLoaded = false;

function ensureXlsxLoaded() {
    if (xlsxLoaded) return true;
    try {
        importScripts('./xlsx.full.min.js');
        xlsxLoaded = typeof XLSX !== 'undefined';
    } catch (err) {
        console.warn('[XLSB-Worker] Không thể nạp xlsx.full.min.js:', err);
        xlsxLoaded = false;
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
        if (rowStr.includes('số do') || rowStr.includes('mã siêu thị') || rowStr.includes('tên siêu thị')) {
            headerRowIdx = i;
            break;
        }
    }

    const headers = (rows[headerRowIdx] || []).map(h => String(h || '').trim().toLowerCase());
    let soIdx = 2;
    let doIdx = 3;
    let storeCodeIdx = 4;
    let storeNameIdx = 5;
    let pcsIdx = 6;
    let pkgCountIdx = 7;
    let provinceIdx = 10;
    let districtIdx = 11;
    let lotIdx = 12;
    let tonnageIdx = 16;
    let siteTinhIdx = 17;
    let siteDoIdx = 18;
    let sttChIdx = 19;
    let noteIdx = 21;
    let bksIdx = 29;
    let driverIdx = 30;

    headers.forEach((h, i) => {
        if (!h) return;
        if (h === 'số so' || h === 'so') soIdx = i;
        else if (h === 'số do' || h === 'do') doIdx = i;
        else if (h.includes('mã siêu thị') || h.includes('mã ch') || h.includes('mã cửa hàng')) storeCodeIdx = i;
        else if (h.includes('tên siêu thị') || h.includes('tên cửa hàng')) storeNameIdx = i;
        else if (h === 'qty') pcsIdx = i;
        else if ((h.includes('tổng pcs') || h.includes('số kiện')) && !h.includes('tổng số kiện xe')) pkgCountIdx = i;
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
        if (!r || r.length < 5) continue;

        const soNum = cleanVal(r[soIdx]);
        const doNum = cleanVal(r[doIdx]);
        const storeCode = cleanVal(r[storeCodeIdx]).toUpperCase();
        const storeName = cleanVal(r[storeNameIdx]);
        if (!doNum && !storeCode) continue;

        const pcsQty = parseInt(r[pcsIdx], 10) || 0;
        const pkgCount = Math.max(1, parseInt(r[pkgCountIdx], 10) || 1);
        const prov = cleanVal(r[provinceIdx]);
        const dist = cleanVal(r[districtIdx]);
        const lotCode = cleanVal(r[lotIdx]);
        const tonnage = cleanVal(r[tonnageIdx]);
        const siteTinh = cleanVal(r[siteTinhIdx]);
        const siteDo = cleanVal(r[siteDoIdx]);
        const sttCh = cleanVal(r[sttChIdx]);
        const note = cleanVal(r[noteIdx]);
        const rowBks = cleanVal(r[bksIdx]).toUpperCase();
        const rowDriver = cleanVal(r[driverIdx]);

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
