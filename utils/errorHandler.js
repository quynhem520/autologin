// utils/errorHandler.js
const fs = require('fs');
const path = require('path');

// Ghi log lỗi
function logError(error, context = {}) {
    const errorLogDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(errorLogDir)) {
        try {
            fs.mkdirSync(errorLogDir, { recursive: true });
        } catch (err) {
            console.error(`❌ Không thể tạo thư mục logs: ${err.message}`);
            return;
        }
    }

    const errorLog = path.join(errorLogDir, 'errors.log');
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${error.stack || error.message}\nContext: ${JSON.stringify(context)}\n\n`;

    try {
        fs.appendFileSync(errorLog, errorMessage);
    } catch (err) {
        console.error(`❌ Không thể ghi log lỗi: ${err.message}`);
    }
}

// Xử lý lỗi khi khởi tạo browser
async function initBrowserWithRetry(puppeteer, options, maxRetries = 3) {
    let browser = null;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            browser = await puppeteer.launch(options);
            return browser;
        } catch (error) {
            lastError = error;
            console.error(`❌ Lỗi khởi tạo browser lần ${attempt}/${maxRetries}: ${error.message}`);

            if (attempt < maxRetries) {
                // Đợi trước khi thử lại
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }

    // Ghi log lỗi
    logError(lastError, { component: 'browser', options });
    throw new Error(`Không thể khởi tạo browser sau ${maxRetries} lần thử: ${lastError.message}`);
}

// Xử lý lỗi khi ghi file
function safeWriteFile(filePath, content) {
    try {
        // Đảm bảo thư mục cha tồn tại
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, content);
        return true;
    } catch (error) {
        logError(error, { component: 'fileSystem', filePath });
        console.error(`❌ Lỗi ghi file ${filePath}: ${error.message}`);
        return false;
    }
}

// Xử lý lỗi khi đọc file
function safeReadFile(filePath, defaultValue = null) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        logError(error, { component: 'fileSystem', filePath });
        console.error(`❌ Lỗi đọc file ${filePath}: ${error.message}`);
        return defaultValue;
    }
}

module.exports = {
    logError,
    initBrowserWithRetry,
    safeWriteFile,
    safeReadFile
};
