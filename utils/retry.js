// utils/retry.js
/**
 * Xử lý tài khoản với cơ chế retry
 * @param {Object} account - Thông tin tài khoản
 * @param {Object} config - Cấu hình
 * @param {string|null} proxy - Proxy (nếu có)
 * @param {number} maxRetries - Số lần thử lại tối đa
 * @param {Function} processAccountFunc - Hàm xử lý tài khoản
 * @returns {Promise<Object>} - Kết quả xử lý
 */
async function processAccountWithRetry(account, config, proxy, maxRetries = 3, processAccountFunc) {
    const { setupAccountLogger } = require('./logger');
    const logger = setupAccountLogger(account.username);
    logger.info(`Bắt đầu xử lý (lần thử 1/${maxRetries})`);

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                logger.info(`Thử lại lần ${attempt}/${maxRetries}`);
            }

            const result = await processAccountFunc(account, config, proxy, logger);

            logger.success(`Xử lý thành công sau ${attempt} lần thử`);
            logger.close();
            return result;
        } catch (error) {
            lastError = error;

            // Kiểm tra loại lỗi để quyết định có retry không
            const shouldRetry = error.message.includes('timeout') ||
                error.message.includes('captcha') ||
                error.message.includes('network') ||
                error.message.includes('proxy');

            if (!shouldRetry || attempt === maxRetries) {
                logger.error(`Lỗi sau ${attempt} lần thử: ${error.message}`);
                logger.close();
                return { success: false, message: error.message };
            }

            // Đợi trước khi thử lại
            const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
            logger.info(`Đợi ${delayMs / 1000}s trước khi thử lại...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    logger.error(`Thất bại sau ${maxRetries} lần thử: ${lastError.message}`);
    logger.close();
    return { success: false, message: lastError.message };
}

module.exports = {
    processAccountWithRetry
};
