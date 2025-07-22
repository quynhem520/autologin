// utils/concurrency.js
const pLimit = require('p-limit');

/**
 * Chạy các tác vụ với giới hạn đồng thời
 * @param {Array} tasks - Mảng các hàm thực hiện tác vụ
 * @param {number} maxConcurrency - Số lượng tác vụ tối đa chạy đồng thời
 * @returns {Promise<Array>} - Kết quả của các tác vụ
 */
async function runWithConcurrencyLimit(tasks, maxConcurrency) {
    const limit = pLimit(maxConcurrency);
    const promises = tasks.map(task => limit(() => task()));
    return await Promise.all(promises);
}

/**
 * Xử lý các tài khoản với giới hạn đồng thời
 * @param {Array} accounts - Mảng tài khoản
 * @param {Object} config - Cấu hình
 * @param {Array} proxies - Mảng proxy
 * @param {number} maxConcurrency - Số lượng tối đa chạy đồng thời
 * @param {Function} processFunction - Hàm xử lý tài khoản
 * @returns {Promise<Array>} - Kết quả xử lý
 */
async function gotoWithRetry(page, url, options = {}, maxRetries = 3) {
  const logger = options.logger || console;
  const timeout = options.timeout || 60000; // Tăng timeout lên 60 giây

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Thêm tùy chọn để bỏ qua lỗi SSL
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: timeout,
        ...options
      });
      return;
    } catch (error) {
      // Phân tích lỗi để hiển thị thông báo chính xác
      let errorMessage = error.message;
      if (errorMessage.includes('Navigation timeout')) {
        errorMessage = `Timeout ${timeout/1000}s khi truy cập ${url}. Có thể trang web đang bảo trì hoặc kết nối mạng chậm.`;
      } else if (errorMessage.includes('net::ERR_CONNECTION_REFUSED')) {
        errorMessage = `Không thể kết nối đến ${url}. Máy chủ từ chối kết nối.`;
      } else if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMessage = `Không thể phân giải tên miền ${url}. Kiểm tra lại URL hoặc DNS.`;
      } else if (errorMessage.includes('net::ERR_INTERNET_DISCONNECTED')) {
        errorMessage = `Không có kết nối internet. Vui lòng kiểm tra kết nối mạng.`;
      }
      
      if (attempt === maxRetries) {
        throw new Error(errorMessage);
      }

      logger.info(`Lần thử ${attempt}/${maxRetries} thất bại: ${errorMessage}`);
      // Tăng thời gian chờ giữa các lần thử
      const waitTime = 3000 * attempt; // Tăng thời gian chờ theo số lần thử
      logger.info(`Đợi ${waitTime/1000} giây trước khi thử lại...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}
async function processAccountsWithLimit(accounts, config, proxies, maxConcurrency, processFunction) {
    const tasks = accounts.map((account, index) => {
        return async () => {
            const proxy = proxies.length > 0 ? proxies[index % proxies.length] : null;
            return await processFunction(account, config, proxy);
        };
    });

    return await runWithConcurrencyLimit(tasks, maxConcurrency);
}

module.exports = {
    runWithConcurrencyLimit,
    processAccountsWithLimit,
    gotoWithRetry
};
