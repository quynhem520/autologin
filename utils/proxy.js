// utils/proxy.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// File lưu proxy key
const PROXY_KEY_PATH = path.join(__dirname, '../config/key_proxy.txt');

/**
 * Lấy proxy từ API key
 * @param {string} apiKey - API key của dịch vụ proxy
 * @returns {Promise<string|null>} - Proxy hoặc null nếu lỗi
 */
async function getProxyFromApi(apiKey) {
    try {
        const response = await axios.get(`https://proxy-api.com/get?key=${apiKey}`, {
            timeout: 10000
        });

        if (response.data && response.data.proxy) {
            return response.data.proxy;
        }
    } catch (error) {
        console.log(`❌ Lỗi lấy proxy từ API: ${error.message}`);
    }

    return null;
}

/**
 * Đọc API key proxy từ file
 * @returns {string|null} - API key hoặc null nếu không có
 */
function readProxyApiKey() {
    if (!fs.existsSync(PROXY_KEY_PATH)) {
        return null;
    }

    const content = fs.readFileSync(PROXY_KEY_PATH, 'utf8').trim();
    return content || null;
}

/**
 * Quản lý pool proxy
 * @param {Array} staticProxies - Danh sách proxy tĩnh
 * @param {string|null} apiKey - API key để lấy proxy động
 * @returns {Object} - Đối tượng quản lý proxy
 */
function createProxyManager(staticProxies = [], apiKey = null) {
    const proxyPool = [...staticProxies];
    const failedProxies = new Set();

    return {
        /**
         * Lấy proxy khả dụng
         * @returns {Promise<string|null>} - Proxy hoặc null nếu không có
         */
        async getProxy() {
            // Nếu còn proxy tĩnh khả dụng
            const availableProxies = proxyPool.filter(p => !failedProxies.has(p));
            if (availableProxies.length > 0) {
                return availableProxies[Math.floor(Math.random() * availableProxies.length)];
            }

            // Nếu có API key, thử lấy proxy động
            if (apiKey) {
                const dynamicProxy = await getProxyFromApi(apiKey);
                if (dynamicProxy) {
                    return dynamicProxy;
                }
            }

            // Nếu không còn proxy nào khả dụng, thử dùng lại proxy đã thất bại
            if (proxyPool.length > 0) {
                failedProxies.clear(); // Reset danh sách proxy thất bại
                return proxyPool[Math.floor(Math.random() * proxyPool.length)];
            }

            return null;
        },

        /**
         * Đánh dấu proxy thất bại
         * @param {string} proxy - Proxy thất bại
         */
        markAsFailed(proxy) {
            if (proxy) {
                failedProxies.add(proxy);
            }
        },

        /**
         * Thêm proxy mới vào pool
         * @param {string} proxy - Proxy mới
         */
        addProxy(proxy) {
            if (proxy && !proxyPool.includes(proxy)) {
                proxyPool.push(proxy);
            }
        }
    };
}

module.exports = {
    getProxyFromApi,
    readProxyApiKey,
    createProxyManager
};
