// utils/report.js
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// Thư mục lưu báo cáo
const REPORTS_DIR = path.join(__dirname, '../reports');

/**
 * Tạo báo cáo tổng hợp
 * @param {Array} results - Kết quả xử lý các tài khoản
 */
async function generateReport(results) {
    // Đảm bảo thư mục báo cáo tồn tại
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // Tạo báo cáo text
    const textReport = path.join(REPORTS_DIR, `report_${getFormattedDate()}.txt`);
    let textContent = '===== BÁO CÁO TỔNG HỢP =====\n\n';

    // Thống kê
    const total = results.length;
    const successful = results.filter(r => r.result.success).length;
    const failed = total - successful;
    const withEnvelopes = results.filter(r => r.result.hasCollectedEnvelope).length;

    textContent += `Tổng số tài khoản: ${total}\n`;
    textContent += `Thành công: ${successful}\n`;
    textContent += `Thất bại: ${failed}\n`;
    textContent += `Có lì xì: ${withEnvelopes}\n\n`;

    // Chi tiết từng tài khoản
    textContent += 'CHI TIẾT:\n';
    results.forEach((item, index) => {
        const { account, result } = item;
        textContent += `${index + 1}. ${account.username}|${account.password}: `;

        if (result.success) {
            textContent += `✅ Thành công | Số dư: ${result.balance || 'N/A'}`;
            if (result.hasCollectedEnvelope) {
                textContent += ' | 🧧 Có lì xì';
            }
        } else {
            textContent += `❌ Thất bại | Lỗi: ${result.message || 'Không xác định'}`;
        }

        textContent += '\n';
    });

    fs.writeFileSync(textReport, textContent);
    console.log(`✅ Đã tạo báo cáo text: ${textReport}`);

    // Tạo báo cáo Excel
    try {
        const excelReport = path.join(REPORTS_DIR, `report_${getFormattedDate()}.xlsx`);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Báo cáo');

        // Tiêu đề
        worksheet.columns = [
            { header: 'STT', key: 'stt', width: 5 },
            { header: 'Tài khoản', key: 'username', width: 15 },
            { header: 'Mật khẩu', key: 'password', width: 15 },
            { header: 'Trạng thái', key: 'status', width: 10 },
            { header: 'Số dư', key: 'balance', width: 10 },
            { header: 'Lì xì', key: 'envelope', width: 10 },
            { header: 'Lỗi', key: 'error', width: 30 }
        ];

        // Dữ liệu
        results.forEach((item, index) => {
            const { account, result } = item;
            worksheet.addRow({
                stt: index + 1,
                username: account.username,
                password: account.password,
                status: result.success ? 'Thành công' : 'Thất bại',
                balance: result.balance || '',
                envelope: result.hasCollectedEnvelope ? 'Có' : 'Không',
                error: result.message || ''
            });
        });

        // Định dạng
        worksheet.getRow(1).font = { bold: true };

        await workbook.xlsx.writeFile(excelReport);
        console.log(`✅ Đã tạo báo cáo Excel: ${excelReport}`);
    } catch (error) {
        console.log(`❌ Lỗi tạo báo cáo Excel: ${error.message}`);
    }
}

/**
 * Lấy ngày giờ hiện tại định dạng YYYYMMDD_HHMMSS
 * @returns {string} - Chuỗi ngày giờ
 */
function getFormattedDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}_${hour}${minute}${second}`;
}

module.exports = {
    generateReport
};
