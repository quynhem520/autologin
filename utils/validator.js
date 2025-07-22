// utils/validator.js
const fs = require('fs');
const path = require('path');

// Đường dẫn đến các file cấu hình
const CONFIG_PATH = path.join(__dirname, '../config');
const CONFIG_FILE = path.join(CONFIG_PATH, 'config.txt');
const ACCOUNTS_FILE = path.join(CONFIG_PATH, 'acc.txt');
const PROXIES_FILE = path.join(CONFIG_PATH, 'proxy.txt');

// Danh sách các URL thay thế nếu URL chính không hoạt động
const ALTERNATIVE_URLS = [
  'https://hi8823.com',
  'https://f8beta2.com',
  'https://mb66555.top',
  'https://m.hi8823.com'
];

// Kiểm tra dữ liệu đầu vào
function validateInputData() {
  console.log('🔍 Kiểm tra dữ liệu đầu vào...');

  const errors = [];

  // Kiểm tra file cấu hình
  if (!fs.existsSync(CONFIG_FILE)) {
    errors.push('❌ Không tìm thấy file config.txt');
  }

  // Kiểm tra file tài khoản
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    errors.push('❌ Không tìm thấy file acc.txt');
  }

  // Đọc và kiểm tra nội dung config
  try {
    const config = readConfig();
    if (!config.website) {
      errors.push('❌ Thiếu thông tin website trong config');
    }

    // Kiểm tra URL hợp lệ
    try {
      // Đảm bảo URL có giao thức http:// hoặc https://
      if (config.website && !config.website.startsWith('http://') && !config.website.startsWith('https://')) {
        config.website = 'https://' + config.website;
        console.log(`ℹ️ Đã tự động thêm https:// vào URL: ${config.website}`);
        
        // Cập nhật file config
        const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
        const updatedContent = configContent.replace(/website=.*/, `website=${config.website}`);
        fs.writeFileSync(CONFIG_FILE, updatedContent);
      }
      
      new URL(config.website);

      // Kiểm tra URL có phải là hi8823.com hoặc m.hi8823.com không
      const hostname = new URL(config.website).hostname;
      if (!hostname.includes('hi8823.com') && !hostname.includes('hi88.com') && !hostname.includes('f8beta2.com')) {
        console.log(`⚠️ Cảnh báo: URL ${config.website} có thể không phải là trang web chính thức`);
        // Thử thay đổi URL
        config.website = 'https://m.hi8823.com';
        console.log(`ℹ️ Đã tự động thay đổi URL thành ${config.website}`);

        // Cập nhật file config
        const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
        const updatedContent = configContent.replace(/website=.*/, `website=${config.website}`);
        fs.writeFileSync(CONFIG_FILE, updatedContent);
      }
    } catch (e) {
      errors.push('❌ URL website không hợp lệ');
    }

    // Kiểm tra max_threads
    if (config.max_threads && isNaN(parseInt(config.max_threads))) {
      errors.push('❌ max_threads phải là số');
    }
  } catch (error) {
    errors.push(`❌ Lỗi đọc file config: ${error.message}`);
  }

  // Kiểm tra tài khoản
  try {
    const accounts = readAccounts();
    if (accounts.length === 0) {
      errors.push('❌ Không có tài khoản nào trong file acc.txt');
    }
  } catch (error) {
    errors.push(`❌ Lỗi đọc file tài khoản: ${error.message}`);
  }

  if (errors.length > 0) {
    console.log('\n===== LỖI DỮ LIỆU ĐẦU VÀO =====');
    errors.forEach(err => console.log(err));
    console.log('=================================\n');
    return false;
  }

  console.log('✅ Dữ liệu đầu vào hợp lệ');
  return true;
}

// Đọc file cấu hình
function readConfig() {
  const content = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config = {};

  content.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      if (key && value) {
        config[key.trim()] = value.trim();
      }
    }
  });

  return config;
}

// Đọc file tài khoản
function readAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];

  const content = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [username, password] = line.split('|');
      return { username: username?.trim(), password: password?.trim() };
    })
    .filter(acc => acc.username && acc.password);
}

// Đọc file proxy
function readProxies() {
  if (!fs.existsSync(PROXIES_FILE)) return [];

  const content = fs.readFileSync(PROXIES_FILE, 'utf8');
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

module.exports = {
  validateInputData,
  readConfig,
  readAccounts,
  readProxies
};
