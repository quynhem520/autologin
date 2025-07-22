// utils/config.js
const fs = require('fs');
const path = require('path');

function loadConfig() {
    // Đọc cấu hình từ file
    const CONFIG_PATH = path.join(__dirname, '../config/config.txt');
    const fileConfig = {};

    if (fs.existsSync(CONFIG_PATH)) {
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        content.split('\n').forEach(line => {
            const [key, value] = line.split('=').map(item => item.trim());
            if (key && value) {
                fileConfig[key] = value;
            }
        });
    }

    // Đọc tham số dòng lệnh
    const args = process.argv.slice(2);
    const cmdConfig = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
            cmdConfig[key] = value;
            if (value !== 'true') i++;
        }
    }

    // Kết hợp cấu hình từ file, biến môi trường và tham số dòng lệnh
    // Ưu tiên: tham số dòng lệnh > biến môi trường > file cấu hình
    return {
        website: cmdConfig.website || process.env.WEBSITE || fileConfig.website,
        api_key: cmdConfig.api_key || process.env.API_KEY || fileConfig.api_key,
        max_threads: parseInt(cmdConfig.max_threads || process.env.MAX_THREADS || fileConfig.max_threads || '4'),
        max_retries: parseInt(cmdConfig.max_retries || process.env.MAX_RETRIES || fileConfig.max_retries || '3'),
        min_delay: parseInt(cmdConfig.min_delay || process.env.MIN_DELAY || fileConfig.min_delay || '1000'),
        max_delay: parseInt(cmdConfig.max_delay || process.env.MAX_DELAY || fileConfig.max_delay || '3000'),
        headless: (cmdConfig.headless || process.env.HEADLESS || fileConfig.headless || 'true') === 'true'
    };
}

module.exports = { loadConfig };
