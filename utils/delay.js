// utils/delay.js
/**
 * Tạo delay ngẫu nhiên trong khoảng
 * @param {number} min - Thời gian tối thiểu (ms)
 * @param {number} max - Thời gian tối đa (ms)
 * @param {Object} config - Cấu hình (có thể chứa min_delay, max_delay)
 * @returns {number} - Thời gian delay (ms)
 */
function getRandomDelay(min, max, config = {}) {
    // Ưu tiên sử dụng giá trị từ config nếu có
    const minDelay = config.min_delay ? parseInt(config.min_delay) : min;
    const maxDelay = config.max_delay ? parseInt(config.max_delay) : max;

    return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

/**
 * Tạo delay với thời gian ngẫu nhiên
 * @param {number} min - Thời gian tối thiểu (ms)
 * @param {number} max - Thời gian tối đa (ms)
 * @param {Object} config - Cấu hình
 * @returns {Promise<void>}
 */
async function delay(min, max, config = {}) {
    const delayTime = getRandomDelay(min, max, config);
    return new Promise(resolve => setTimeout(resolve, delayTime));
}

module.exports = {
    getRandomDelay,
    delay
};
