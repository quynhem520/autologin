// utils/logger.js
const fs = require('fs');
const path = require('path');

// Thư mục lưu log
const LOG_DIR = path.join(__dirname, '../logs');

/**
 * Tạo logger cho một tài khoản cụ thể
 * @param {string} username - Tên tài khoản
 * @returns {Object} - Đối tượng logger
 */
function setupAccountLogger(username) {
    // Đảm bảo thư mục log tồn tại
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const logFile = path.join(LOG_DIR, `${username}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Thêm header cho file log mới
    const timestamp = new Date().toISOString();
    logStream.write(`\n\n========== SESSION STARTED AT ${timestamp} ==========\n\n`);

    return {
        info: (message) => {
            const logMessage = `[${new Date().toISOString()}] [INFO] ${message}`;
            logStream.write(logMessage + '\n');
            console.log(`ℹ️ [${username}] ${message}`);
        },

        error: (message) => {
            const logMessage = `[${new Date().toISOString()}] [ERROR] ${message}`;
            logStream.write(logMessage + '\n');
            console.log(`❌ [${username}] ${message}`);
        },

        success: (message) => {
            const logMessage = `[${new Date().toISOString()}] [SUCCESS] ${message}`;
            logStream.write(logMessage + '\n');
            console.log(`✅ [${username}] ${message}`);
        },

        close: () => {
            logStream.end();
        }
    };
}

module.exports = {
    setupAccountLogger
};
