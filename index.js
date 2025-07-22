const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const {
  Worker,
  isMainThread,
  parentPort,
  workerData
} = require('worker_threads');
const os = require('os');
// Thêm các import
const {
  validateInputData,
  readConfig,
  readAccounts,
  readProxies
} = require('./utils/validator');
const {
  setupAccountLogger
} = require('./utils/logger');
const {
  processAccountsWithLimit,
  gotoWithRetry
} = require('./utils/concurrency');
const {
  processAccountWithRetry
} = require('./utils/retry');
const {
  generateReport
} = require('./utils/report');
const {
  createProxyManager,
  readProxyApiKey
} = require('./utils/proxy');
const {
  delay
} = require('./utils/delay');
puppeteer.use(StealthPlugin());

// Hàm thay thế cho page.waitForTimeout
async function waitForTimeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 1. Di chuyển các hàm helper ra ngoài hàm processAccount
async function waitForSelectorWithRetry(page, selector, options = {}) {
  const {
    timeout = 10000, retries = 3
  } = options;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await page.waitForSelector(selector, {
        timeout,
        visible: true // Thêm tùy chọn này để đảm bảo element hiển thị
      });
    } catch (error) {
      if (attempt === retries) throw error;
      await waitForTimeout();
    }
  }
}
async function safeClick(page, selector, options = {}) {
  try {
    const element = await waitForSelectorWithRetry(page, selector, options);
    if (!element) throw new Error(`Element not found: ${selector}`);
    try {
      await element.click({
        delay: options.delay || 50
      });
    } catch (err) {
      try {
        await page.evaluate(sel => document.querySelector(sel).click(), selector);
      } catch (err2) {
        await page.evaluate(sel => {
          const element = document.querySelector(sel);
          if (element) {
            element.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            }));
          }
        }, selector);
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}
async function safeType(page, selector, text, options = {}) {
  try {
    const element = await waitForSelectorWithRetry(page, selector, options);
    if (!element) throw new Error(`Element not found: ${selector}`);
    // Xóa nội dung hiện tại
    await element.evaluate(el => el.value = '');
    // Nhập từng ký tự với độ trễ ngẫu nhiên
    await element.type(text, {
      delay: Math.floor(Math.random() * 100) + 50
    });
    return true;
  } catch (error) {
    return false;
  }
}
async function getElementText(page, selector) {
  try {
    const element = await page.waitForSelector(selector, {
      visible: true
    });
    if (!element) return null;
    return await element.evaluate(el => el.textContent.trim());
  } catch (error) {
    return null;
  }
}


// Đọc cấu hình
const CONFIG_PATH = path.join(__dirname, 'config/config.txt');
const ACCOUNTS_PATH = path.join(__dirname, 'config/acc.txt');
const PROXY_PATH = path.join(__dirname, 'config/proxy.txt');
const PROXY_KEY_PATH = path.join(__dirname, 'config/key_proxy.txt');
const RESULTS_PATH = path.join(__dirname, 'results');
// Đảm bảo thư mục kết quả tồn tại
if (!fs.existsSync(RESULTS_PATH)) {
  fs.mkdirSync(RESULTS_PATH, {
    recursive: true
  });
}

// 3. Tối ưu pool đa luồng với p-limit
const pLimit = require('p-limit');
async function runWithConcurrencyLimit(accounts, config, proxies, maxConcurrency) {
  const limit = pLimit(maxConcurrency);
  const tasks = accounts.map((account, index) => {
    return limit(async () => {
      const proxy = proxies.length > 0 ? proxies[index % proxies.length] : null;
      return await processAccount(account, config, proxy);
    });
  });
  return await Promise.all(tasks);
}
// Lấy proxy từ API key
async function getProxyFromApi(apiKey) {
  try {
    const response = await axios.get(`https://proxy-api.com/get?key=${apiKey}`);
    if (response.data && response.data.proxy) {
      return response.data.proxy;
    }
  } catch (error) {
    console.log(chalk.red(`❌ Lỗi lấy proxy từ API: ${error.message}`));
  }
  return null;
}
// Giải captcha
async function solveCaptcha(imageBase64, apiKey) {
  try {
    const response = await axios.post("https://autocaptcha.pro/apiv3/process", {
      key: apiKey,
      type: "imagetotext",
      img: `data:image/png;base64,${imageBase64}` //ảnh captcha base64
    }, {
      headers: {
        'Content-Type': 'application/json',  //
        'User-Agent': getRandomUserAgent()  //useragent ngẫu nhiên
      },
      timeout: 15000    //thời giân gì
    });
    if (response.data && response.data.status === 1 && response.data.result) {
      return response.data.result;
    }
  } catch (error) {
    console.log(chalk.red(`❌ Lỗi giải captcha: ${error.message}`));
  }
  return null;
}
// Lấy User-Agent ngẫu nhiên
function getRandomUserAgent() {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}
/**
 * Hàm phân tích proxy với các định dạng khác nhau
 * @param {string} proxy - Chuỗi proxy cần phân tích (user:pass@ip:port hoặc ip:port:user:pass hoặc ip:port)
 * @returns {Object} - Trả về đối tượng chứa thông tin proxy đã phân tích
 */
function parseProxy(proxy) { // proxy có thể là user:pass@ip:port hoặc ip:port:user:pass hoặc ip:port
  if (!proxy) return { proxyArg: null, proxyAuth: null }; // trả về giá trị mặc định nếu không có proxy

  try {
    // Định dạng user:pass@ip:port
    if (proxy.includes('@')) { // kiểm tra xem có ký tự @ không
      const [auth, host] = proxy.split('@'); // tách thành phần xác thực và host
      const [username, password] = auth.split(':'); // tách username và password
      return {
        proxyArg: `--proxy-server=${host}`, // tham số dòng lệnh cho puppeteer
        proxyAuth: { username, password }, // thông tin xác thực proxy
        displayHost: host.split(':')[0] // chỉ hiển thị IP, không hiển thị port
      };
    }

    // Định dạng ip:port:user:pass
    const parts = proxy.split(':'); // tách chuỗi proxy theo dấu :
    if (parts.length === 4) { // nếu có 4 phần thì đó là định dạng ip:port:user:pass
      const [ip, port, username, password] = parts; // phân tích các thành phần
      return {
        proxyArg: `--proxy-server=${ip}:${port}`, // tham số dòng lệnh cho puppeteer
        proxyAuth: { username, password }, // thông tin xác thực proxy
        displayHost: ip // chỉ hiển thị IP, không hiển thị port
      };
    }

    // Định dạng ip:port
    if (parts.length === 2) { // nếu chỉ có 2 phần thì đó là định dạng ip:port
      return {
        proxyArg: `--proxy-server=${proxy}`, // sử dụng toàn bộ chuỗi proxy làm tham số
        proxyAuth: null, // không có thông tin xác thực
        displayHost: parts[0] // chỉ hiển thị IP, không hiển thị port
      };
    }
  } catch (error) {
    console.error(`Lỗi phân tích proxy: ${error.message}`); // ghi log lỗi nếu có
  }

  return { proxyArg: null, proxyAuth: null, displayHost: null }; // trả về giá trị mặc định nếu có lỗi
}

// Sửa lại cách xử lý proxy trong hàm processAccount
async function processAccount(account, config, proxy, logger) {
  // Tạo logger nếu chưa có
  if (!logger) {
    logger = setupAccountLogger(account.username);
  }

  logger.info('Khởi tạo trình duyệt...');

  // Xử lý proxy
  const { proxyArg, proxyAuth, displayHost } = parseProxy(proxy);

  // Log thông tin proxy nếu có
  if (displayHost) {
    logger.info(`Sử dụng proxy: ${displayHost}:****`);
  }

  // Chuẩn bị các tham số cho trình duyệt
  const args = [
    '--no-sandbox',                  // tăng tốc độ khởi động, bỏ qua sandbox bảo mật
    '--disable-setuid-sandbox',       // tắt tính năng setuid sandbox
    '--disable-dev-shm-usage',        // tránh lỗi hết bộ nhớ trên Linux
    '--disable-accelerated-2d-canvas', // tắt tính năng canvas 2D tăng tốc
    '--disable-gpu',                 // tắt sử dụng GPU
    '--window-size=1920,1080',       // đặt kích thước cửa sổ trình duyệt
    '--disable-notifications',       // tắt thông báo
    '--disable-extensions',          // tắt tiện ích mở rộng
    '--disable-infobars',            // tắt thanh thông tin
    '--ignore-certificate-errors',   // bỏ qua lỗi chứng chỉ SSL
    '--enable-features=NetworkService' // bật tính năng Network Service
  ];

  // Thêm proxy nếu có
  if (proxyArg) args.push(proxyArg);

  const browser = await puppeteer.launch({
    headless: "new",                           // chế độ headless mới (không hiển thị giao diện)
    args,                                      // các tham số dòng lệnh đã chuẩn bị ở trên
    defaultViewport: { width: 1920, height: 1080 }, // kích thước viewport mặc định
    ignoreHTTPSErrors: true,                   // bỏ qua lỗi HTTPS
    timeout: 30000                             // tăng thời gian chờ tối đa khi khởi tạo (30 giây)
  });

  try {
    const page = await browser.newPage();

    // Xác thực proxy nếu cần
    if (proxyAuth) {
      await page.authenticate(proxyAuth);
    }

    // Thiết lập timeout cho navigation và waitFor
    page.setDefaultNavigationTimeout(15000);  // thời gian chờ tối đa cho việc chuyển trang (15 giây)
    page.setDefaultTimeout(8000);             // thời gian chờ tối đa cho các thao tác khác (8 giây)

    // Thiết lập để giả lập trình duyệt thật
    await page.setUserAgent(getRandomUserAgent());  // sử dụng User-Agent ngẫu nhiên để tránh bị phát hiện

    // Thiết lập headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',  // ngôn ngữ ưu tiên là tiếng Việt
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',  // các loại nội dung chấp nhận
      'Accept-Encoding': 'gzip, deflate, br'  // các kiểu nén chấp nhận
    });

    // Vô hiệu hóa webdriver và các dấu hiệu của trình duyệt tự động
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false  // giả mạo thuộc tính webdriver để tránh bị phát hiện
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['vi-VN', 'vi', 'en-US', 'en']  // giả mạo danh sách ngôn ngữ
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]  // giả mạo danh sách plugins
      });

      // Giả lập canvas fingerprint để tránh bị theo dõi
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type) {
        const context = originalGetContext.apply(this, arguments);  // gọi hàm gốc
        if (type === '2d') {  // chỉ xử lý context 2D
          const originalFillText = context.fillText;  // lưu hàm gốc
          context.fillText = function () {
            return originalFillText.apply(this, arguments);  // gọi hàm gốc nhưng có thể sửa để thay đổi kết quả
          };
        }
        return context;  // trả về context đã được sửa đổi
      };
    });

    // Thiết lập timezone để giả lập vị trí địa lý
    const client = await page.target().createCDPSession();  // tạo phiên Chrome DevTools Protocol
    await client.send('Emulation.setTimezoneOverride', {
      timezoneId: 'Asia/Ho_Chi_Minh'  // đặt múi giờ Việt Nam
    });
    logger.info(chalk.green('Đã khởi tạo trình duyệt thành công'));
    // Bước 1: Truy cập website
    let website = config.website || 'https://m.hi8823.com';  // lấy URL từ config hoặc dùng giá trị mặc định

    // Đảm bảo URL có giao thức http:// hoặc https://
    if (!website.startsWith('http://') && !website.startsWith('https://')) {
      website = 'https://' + website;
    }

    logger.info(chalk.cyan(`Đang truy cập website: ${website}...`));

    try {
      await gotoWithRetry(page, website, {
        logger,
        timeout: 60000  // tăng thời gian chờ lên 60 giây
      });
      logger.info(chalk.green(`✅ Đã truy cập website thành công: ${website}`));
    } catch (error) {
      // Hiển thị lỗi chi tiết và hướng dẫn
      logger.error(chalk.red(`❌ Không thể truy cập ${website}: ${error.message}`));
      logger.info(chalk.yellow(`Gợi ý: Thử thay đổi URL trong cấu hình hoặc kiểm tra kết nối mạng`));
      throw new Error(`Không thể truy cập website: ${error.message}`);
    }
    // Chuyển đến trang đăng nhập
    let loginUrl;
    const currentUrl = page.url();  // lấy URL hiện tại
    if (currentUrl.includes('m.')) {  // kiểm tra xem có phải phiên bản mobile không
      loginUrl = new URL('/Account/Login', currentUrl).href;  // đường dẫn đăng nhập cho phiên bản mobile
    } else {
      loginUrl = new URL('/Login', currentUrl).href;  // đường dẫn đăng nhập cho phiên bản desktop
    }
    await page.goto(loginUrl, {
      waitUntil: 'networkidle2',  // chờ cho đến khi mạng ổn định (không còn request nào)
      timeout: 8000   // thời gian chờ tối đa 8 giây
    });

    logger.info(chalk.cyan('Đã chuyển đến trang đăng nhập'));
    // Bước 2: Nhập thông tin đăng nhập
    await waitForTimeout(300);   // chờ 500ms để trang tải hoàn tất
    // Tìm trường nhập tên đăng nhập với nhiều selector khác nhau
    const usernameSelectors = [
      'input[autocapitalize="login"]',                    // selector 1
      'input[placeholder="Vui lòng nhập tài khoản"]',      // selector 2
      'input[formcontrolname="account"]',                 // selector 3
      'input[placeholder="Vui lòng nhập tên tài khoản"]'  // selector 4
    ];
    let usernameField = null;
    for (const selector of usernameSelectors) {  // duyệt qua từng selector
      usernameField = await page.$(selector);     // tìm element trên trang
      if (usernameField) break;                  // nếu tìm thấy thì dừng lại
    }
    if (!usernameField) {  // nếu không tìm thấy trường nào
      throw new Error('Không tìm thấy trường nhập tên đăng nhập');  // ném lỗi
    }
    // Tìm trường nhập mật khẩu với nhiều selector khác nhau
    const passwordSelectors = [
      'input[autocomplete="password"]',                  // selector 1
      'input[placeholder="Vui lòng nhập mật mã"]',      // selector 2
      'input[formcontrolname="password"]',               // selector 3
      'input[placeholder="Vui lòng nhập mật khẩu"]'    // selector 4
    ];
    let passwordField = null;
    for (const selector of passwordSelectors) {  // duyệt qua từng selector
      passwordField = await page.$(selector);     // tìm element trên trang
      if (passwordField) break;                  // nếu tìm thấy thì dừng lại
    }
    if (!passwordField) {  // nếu không tìm thấy trường nào
      throw new Error('Không tìm thấy trường nhập mật khẩu');  // ném lỗi
    }
    // Nhập thông tin đăng nhập an toàn
    await safeType(page, usernameSelectors.find(sel => !!page.$(sel)), account.username);  // nhập tên đăng nhập
    await safeType(page, passwordSelectors.find(sel => !!page.$(sel)), account.password);   // nhập mật khẩu
    logger.info(chalk.cyan('Đã nhập thông tin đăng nhập'));
    /**
     * Bước 3: Xử lý captcha
     * @param {Page} page - Đối tượng trang Puppeteer
     * @param {string} apiKey - API key của dịch vụ giải captcha
     * @returns {Promise<boolean>} - Kết quả xử lý captcha
     */
    // 2. Sửa lỗi trong hàm handleCaptcha
    async function handleCaptcha(page, apiKey) {
      console.log(chalk.blue('🔍 Xử lý captcha...'));
      try {
        // Tìm trường nhập mã xác minh
        const checkCodeSelectors = [
          "input[formcontrolname='checkCode']",
          "input[placeholder='Vui lòng nhập mã xác minh']",
          "input[model='$ctrl.code']"
        ];
        let checkCodeField = null;
        for (const selector of checkCodeSelectors) {
          try {
            checkCodeField = await page.waitForSelector(selector, {
              timeout: 2000,
              visible: true
            });
            if (checkCodeField) break;
          } catch (e) {
            continue;
          }
        }
        if (!checkCodeField) {
          console.log(chalk.blue("ℹ️ Không tìm thấy trường nhập captcha, có thể không cần captcha"));
          return true;
        }
        // Click vào trường nhập captcha
        await safeClick(page, checkCodeSelectors.find(sel => !!page.$(sel)));
        await waitForTimeout(100);
        // Tìm nút làm mới captcha và click (nếu có)
        if (await safeClick(page, 'i.fas.fa-sync, i.refreshhaptch')) {
          console.log(chalk.blue("🔄 Đã nhấn nút làm mới captcha"));
          await waitForTimeout(100);
        }
        // Lấy ảnh captcha
        const captchaSelectors = [
          "img#captcha",
          "img.dVSNlKsQ1qaz1uSto7bNM",
          "img[src*='captcha']",
          "img[click*='refreshCaptcha']"
        ];
        let captchaImg = null;
        for (const selector of captchaSelectors) {
          try {
            captchaImg = await page.waitForSelector(selector, {
              timeout: 2000,
              visible: true
            });
            if (captchaImg) break;
          } catch (e) {
            continue;
          }
        }
        if (!captchaImg) {
          console.log(chalk.red("❌ Không tìm thấy ảnh captcha"));
          return false;
        }
        // Lấy dữ liệu ảnh captcha
        const captchaSrc = await captchaImg.evaluate(el => el.src);
        if (!captchaSrc || !captchaSrc.includes('base64,')) {
          console.log(chalk.red("❌ Không lấy được dữ liệu captcha"));
          return false;
        }
        const captchaBase64 = captchaSrc.split('base64,')[1];
        // Giải captcha
        const captchaText = await solveCaptcha(captchaBase64, apiKey);
        if (!captchaText) {
          console.log(chalk.red("❌ Không giải được captcha"));
          return false;
        }
        // Nhập mã captcha
        await safeType(page, checkCodeSelectors.find(sel => !!page.$(sel)), captchaText);
        console.log(chalk.green(`✅ Đã nhập captcha: ${captchaText}`));
        return true;
      } catch (err) {
        console.log(chalk.red(`❌ Lỗi xử lý captcha: ${err.message}`));
        return false;
      }
    }
    /**
     * Giải captcha bằng API
     * @param {string} imageBase64 - Dữ liệu ảnh captcha dạng base64
     * @param {string} apiKey - API key của dịch vụ giải captcha
     * @returns {Promise<string|null>} - Kết quả giải captcha
     */
    async function solveCaptcha(imageBase64, apiKey) {
      try {
        const response = await axios.post("https://autocaptcha.pro/apiv3/process", {
          key: apiKey,
          type: "imagetotext",
          img: `data:image/png;base64,${imageBase64}`
        }, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': getRandomUserAgent()
          },
          timeout: 8000
        });
        // Kiểm tra cấu trúc phản hồi
        if (response.data && response.data.status === 1 && response.data.result) {
          return response.data.result.trim();
        } else if (response.data && response.data.success === true && response.data.captcha) {
          return response.data.captcha.trim();
        } else {
          console.warn(chalk.yellow("API trả về lỗi:"), JSON.stringify(response.data));
          return null;
        }
      } catch (err) {
        console.error(chalk.red("Lỗi gọi API captcha:"), err.message);
        return null;
      }
    }
    // Bước 4: Đăng nhập - tìm và nhấn nút đăng nhập
    const loginButtonSelectors = [
      'button[ng-class="$ctrl.styles[\'login-btn\']"]',  // selector cho nút đăng nhập Angular
      'button._1elJEDoklSJeZCRhRorPTp',                // selector theo class name
      'button[translate="Home_Login"]',               // selector theo thuộc tính translate
      'button[translate="Shared_Login"]',             // selector khác theo thuộc tính translate
      'span[translate="Home_Login"]',                 // selector cho span có thuộc tính translate
      'button span[translate="Shared_Login"]',         // selector cho span trong button
      'button.login-btn',                             // selector theo class login-btn
      'button[type="submit"]'                         // selector cho nút submit bất kỳ
    ];
    let loginSuccess = false;
    // Thử cách 1: Sử dụng các selector
    for (const selector of loginButtonSelectors) {
      if (await safeClick(page, selector)) {
        logger.info(chalk.cyan('Đã nhấn nút đăng nhập'));
        await waitForTimeout(300);
        loginSuccess = true;
        break;
      }
    }

    // Thử cách 2: Nếu không tìm thấy nút, thử nhấn Enter
    if (!loginSuccess) {
      try {
        await page.keyboard.press('Enter');
        logger.info(chalk.cyan('Đã nhấn phím Enter để đăng nhập'));
        await waitForTimeout();
        loginSuccess = true;
      } catch (err) {
        logger.error(chalk.red(`Lỗi khi nhấn Enter: ${err.message}`));
      }
    }

    // Thử cách 3: Sử dụng JavaScript để tìm và nhấn nút đăng nhập
    if (!loginSuccess) {
      try {
        loginSuccess = await page.evaluate(() => {
          // Tìm tất cả các nút có chứa từ "Đăng nhập"
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          const loginButton = buttons.find(btn => {
            const text = btn.textContent || btn.value || '';
            return text.toUpperCase().includes('ĐĂNG NHẬP') || text.toUpperCase().includes('LOGIN');
          });

          if (loginButton) {
            loginButton.click();
            return true;
          }
          return false;
        });

        if (loginSuccess) {
          logger.info(chalk.cyan('Đã nhấn nút đăng nhập bằng JavaScript'));
          await waitForTimeout(100);
        }
      } catch (err) {
        logger.error(chalk.red(`Lỗi khi tìm nút đăng nhập bằng JavaScript: ${err.message}`));
      }
    }
    if (!loginSuccess) {
      throw new Error('Không tìm thấy nút đăng nhập');
    }
    // Kiểm tra lỗi đăng nhập - tìm các thông báo lỗi
    const errorSelectors = [
      'span#mobile-msg',                    // thông báo lỗi trên phiên bản mobile
      'mat-dialog-content',                  // thông báo lỗi trong dialog Angular Material
      'div[compile="$ctrl.content"]'         // thông báo lỗi trong element compile của Angular
    ];
    let hasError = false;
    for (const selector of errorSelectors) {
      const errorElement = await page.$(selector);
      if (errorElement) {
        const errorText = await errorElement.evaluate(el => el.textContent.trim());
        if (errorText.includes('sai') ||
          errorText.includes('khóa') ||
          errorText.includes('vô hiệu hóa') ||
          errorText.includes('403') ||
          errorText.includes('Lỗi')) {
          logger.error(chalk.red(`Lỗi đăng nhập: ${errorText}`));
          hasError = true;
          break;
        }
      }
    }
    if (hasError) {
      return {
        success: false,
        message: 'Đăng nhập thất bại',
        balance: null
      };
    }
    logger.success(chalk.green('Đăng nhập thành công'));
    // Bước 5: Đóng quảng cáo và nhận lì xì
    await waitForTimeout(300);  // chờ 1 giây sau khi đăng nhập
    // Đóng quảng cáo bằng phím ESC
    await page.keyboard.press('Escape');  // nhấn ESC lần 1
    await waitForTimeout(100);           // chờ 100ms
    await page.keyboard.press('Escape');  // nhấn ESC lần 2 để đảm bảo đóng hết popup
    logger.info(chalk.cyan('Đã đóng quảng cáo'));
    // Đợi 2-3 giây để kiểm tra có hồng bao không
    await waitForTimeout(300);  // chờ 1 giây để hồng bao xuất hiện (nếu có)
    // Biến để theo dõi xem có nhặt được hồng bao không
    let hasCollectedEnvelope = false;  // mặc định là chưa nhặt được
    // Tìm hồng bao trên trang
    const redEnvelopeElement = await page.$("div[translate='RedEnvelope_GrabEenvelope']");  // tìm element hồng bao
    if (redEnvelopeElement) {
      logger.info(chalk.magenta('Tìm thấy hồng bao may mắn'));
      // Click vào hồng bao
      await safeClick(page, "div[translate='RedEnvelope_GrabEenvelope']");
      await waitForTimeout(300);
      // Tìm nút mở ra
      if (await safeClick(page, "span[translate='RedEnvelope_Open']")) {
        logger.info(chalk.magenta('Đã nhấn nút mở ra'));
        await waitForTimeout(300);
        // Tìm hình lì xì để click
        if (await safeClick(page, "img[ng-click*='withdraw']")) {
          logger.info(chalk.magenta('Đã click vào hình lì xì'));
          await waitForTimeout(300);
          // Kiểm tra số tiền nhận được
          const amountElement = await page.$("span[ng-bind*='redEnvelope.amount']");
          if (amountElement) {
            const amount = await page.evaluate(el => el.textContent.trim(), amountElement);
            logger.success(chalk.green(`Nhận được ${amount} tiền lì xì`));
            hasCollectedEnvelope = true;
          }
          // Nhấn nút thu lại
          if (await safeClick(page, "button[translate='RedEnvelope_Withdraw']")) {
            logger.info(chalk.magenta('Đã nhấn nút thu lại'));
            await waitForTimeout(300);
          }
        }
      }
    } else {
      logger.info(chalk.yellow('Không tìm thấy hồng bao may mắn'));
    }
    // Bước 6: Kiểm tra số dư tài khoản
    logger.info(chalk.cyan('Kiểm tra số dư...'));

    // Thử nhiều cách để lấy số dư
    let balance = null;

    // Cách 1: Thử lấy số dư trực tiếp từ trang hiện tại
    try {
      // Tìm số dư trên trang hiện tại
      const balanceSelectors1 = [
        "span.balance",
        "div.balance",
        "span[ng-bind*='balance']",
        "div[ng-bind*='balance']",
        "span.amount",
        "div.amount",
        "span.money",
        "div.money"
      ];

      for (const selector of balanceSelectors1) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.evaluate(el => el.textContent.trim());
          const match = text.match(/[\d,.]+/);
          if (match) {
            balance = match[0];
            logger.success(chalk.green(`Số dư hiện tại (cách 1): ${balance}`));
            break;
          }
        }
      }
    } catch (err) {
      logger.info(chalk.yellow(`Không thể lấy số dư bằng cách 1: ${err.message}`));
    }

    // Cách 2: Chuyển đến trang thông tin tài khoản
    if (!balance) {
      try {
        // Tạo URL trang kiểm tra số dư
        const currentPageUrl = page.url();
        const baseUrl = new URL(currentPageUrl).origin;

        // Thử nhiều URL khác nhau
        const possibleUrls = [
          new URL('/MemberCenter/SecurityList', baseUrl).href,
          new URL('/MemberCenter', baseUrl).href,
          new URL('/Account/Balance', baseUrl).href,
          new URL('/Account/Info', baseUrl).href,
          new URL('/User/Balance', baseUrl).href
        ];

        // Thử từng URL
        for (const url of possibleUrls) {
          try {
            logger.info(chalk.cyan(`Truy cập ${url} để kiểm tra số dư...`));
            await page.goto(url, {
              waitUntil: 'networkidle2',
              timeout: 5000
            });

            // Đợi trang tải xong
            await waitForTimeout(1000);

            // Tìm và nhấn nút làm mới (nếu có)
            await safeClick(page, "i.fas.fa-sync, button.refresh, button[ng-click*='refresh']");
            await waitForTimeout(1000);

            // Lấy số dư tài khoản
            const balanceSelectors2 = [
              "span[ng-bind*='userInfo.balance']",
              "span[title='Ví tài khoản']",
              "span[ng-class*='styles.amount']",
              "div.balance-value",
              "span.balance-value",
              "div.balance-amount",
              "span.balance-amount",
              "div.user-balance",
              "span.user-balance"
            ];

            for (const selector of balanceSelectors2) {
              const balanceElement = await page.$(selector);
              if (balanceElement) {
                const text = await balanceElement.evaluate(el => el.textContent.trim());
                // Tìm số trong chuỗi bằng biểu thức chính quy
                const match = text.match(/[\d,.]+/);
                if (match) {
                  balance = match[0];
                  logger.success(chalk.green(`Số dư hiện tại (cách 2): ${balance}`));
                  break;
                }
              }
            }

            if (balance) break; // Nếu đã tìm thấy số dư, dừng việc thử các URL khác
          } catch (err) {
            logger.info(chalk.yellow(`Không thể truy cập ${url}: ${err.message}`));
          }
        }
      } catch (err) {
        logger.info(chalk.yellow(`Không thể lấy số dư bằng cách 2: ${err.message}`));
      }
    }

    // Cách 3: Sử dụng JavaScript để tìm số dư trên trang
    if (!balance) {
      try {
        balance = await page.evaluate(() => {
          // Tìm tất cả các phần tử có thể chứa số dư
          const elements = Array.from(document.querySelectorAll('span, div, p'));

          // Lọc các phần tử có chứa từ khóa liên quan đến số dư
          const balanceElements = elements.filter(el => {
            const text = el.textContent.toLowerCase();
            return (text.includes('balance') ||
                   text.includes('số dư') ||
                   text.includes('ví') ||
                   text.includes('amount') ||
                   text.includes('tiền')) &&
                   /[\d,.]+/.test(text);
          });

          // Tìm số dư trong các phần tử đã lọc
          for (const el of balanceElements) {
            const match = el.textContent.match(/[\d,.]+/);
            if (match) return match[0];
          }

          return null;
        });

        if (balance) {
          logger.success(chalk.green(`Số dư hiện tại (cách 3): ${balance}`));
        }
      } catch (err) {
        logger.info(chalk.yellow(`Không thể lấy số dư bằng cách 3: ${err.message}`));
      }
    }

    // Nếu vẫn không tìm thấy số dư
    if (!balance) {
      logger.info(chalk.yellow('Không thể lấy số dư tài khoản'));
    }
    // Chuẩn bị kết quả trả về
    const siteName = new URL(website).hostname.replace('www.', '').replace('m.', '');  // lấy tên trang web (bỏ www. và m.)
    const result = {
      success: true,                 // đánh dấu thành công
      hasCollectedEnvelope,          // có nhặt được lì xì không
      balance,                       // số dư tài khoản
      content: hasCollectedEnvelope ?
        `${account.username}|${account.password}|${siteName}|số dư sau khi nhặt : ${balance}` : // nội dung nếu có lì xì
        `${account.username}|${account.password}|${siteName}|số dư : ${balance}`                    // nội dung nếu không có lì xì
    };
    return result;
  } catch (error) {
    logger.error(chalk.red(`Lỗi: ${error.message}`));  // ghi log lỗi
    return {
      success: false,           // đánh dấu thất bại
      message: error.message,   // thông báo lỗi
      balance: null            // không có số dư
    };
  } finally {  // luôn thực hiện dù thành công hay thất bại
    try {
      await browser.close();  // đóng trình duyệt để giải phóng tài nguyên
      logger.info(chalk.cyan('Đã đóng trình duyệt'));
    } catch (err) {
      logger.error(chalk.red(`Lỗi khi đóng trình duyệt: ${err.message}`));
    }
  }
}
// Xử lý trong worker thread - chạy khi được gọi từ thread chính
if (!isMainThread) {  // kiểm tra xem có phải là worker thread không
  const {
    account,  // thông tin tài khoản cần xử lý
    config,   // cấu hình
    proxy     // proxy nếu có
  } = workerData;  // lấy dữ liệu được truyền từ thread chính

  (async () => {  // hàm async IIFE
    try {
      const result = await processAccount(account, config, proxy);  // xử lý tài khoản
      parentPort.postMessage(result);  // gửi kết quả về thread chính
    } catch (error) {
      parentPort.postMessage({  // gửi thông báo lỗi về thread chính
        success: false,
        message: error.message
      });
    }
  })();  // gọi hàm ngay lập tức
}
// Import module prompt
const { promptUser, promptYesNo } = require('./utils/prompt');

/**
 * Hiển thị menu tùy chỉnh cấu hình trước khi chạy
 * @param {Object} config - Cấu hình hiện tại
 * @returns {Promise<Object>} - Cấu hình đã được cập nhật
 */
async function showConfigMenu(config) {
  console.log(chalk.bgBlue.white.bold('\n===== TÙY CHỈNH CẤU HÌNH ====='));

  // Hỏi người dùng có muốn tùy chỉnh không
  const customize = await promptYesNo(chalk.magenta.bold('Bạn có muốn tùy chỉnh cấu hình không?'));
  if (!customize) {
    console.log(chalk.cyan('Sử dụng cấu hình mặc định...'));
    return config;
  }

  console.log(chalk.yellow.bold('\n→ Nhập các thông số cấu hình:'));

  // Tùy chỉnh website
  const websiteInput = await promptUser(chalk.cyan.bold('Nhập URL website'), 'http://');
  if (websiteInput && websiteInput !== 'http://') {
    config.website = websiteInput;
    console.log(chalk.green(`✔ Đã cập nhật URL: ${websiteInput}`));
  }

  // Tùy chỉnh số luồng
  const maxThreadsInput = await promptUser(chalk.cyan.bold('Số luồng tối đa'), config.max_threads);
  if (maxThreadsInput && !isNaN(parseInt(maxThreadsInput))) {
    config.max_threads = maxThreadsInput;
    console.log(chalk.green(`✔ Đã cập nhật số luồng: ${maxThreadsInput}`));
  }

  // Tùy chỉnh số lần thử lại
  const maxRetriesInput = await promptUser(chalk.cyan.bold('Số lần thử lại tối đa'), config.max_retries);
  if (maxRetriesInput && !isNaN(parseInt(maxRetriesInput))) {
    config.max_retries = maxRetriesInput;
    console.log(chalk.green(`✔ Đã cập nhật số lần thử lại: ${maxRetriesInput}`));
  }

  // Tùy chỉnh sử dụng proxy
  const useProxyInput = await promptYesNo(chalk.cyan.bold('Sử dụng proxy?'), config.use_proxy === 'true');
  config.use_proxy = useProxyInput.toString();
  console.log(chalk.green(`✔ ${useProxyInput ? 'Bật' : 'Tắt'} sử dụng proxy`));

  // Lưu cấu hình mới vào file
  try {
    const configContent = Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    fs.writeFileSync(CONFIG_PATH, configContent + '\n\n');
    console.log(chalk.bgGreen.black.bold('\n✔ Cấu hình đã được cập nhật và lưu vào file!'));
  } catch (err) {
    console.log(chalk.bgRed.white.bold(`\n❌ Không thể lưu cấu hình vào file: ${err.message}`));
  }

  return config;
}

// Hàm chính - điểm vào của chương trình
async function main() {
  try {
    // Kiểm tra dữ liệu đầu vào (config, tài khoản, proxy)
    if (!validateInputData()) {  // nếu kiểm tra thất bại
      console.log(chalk.red('❌ Dừng chương trình do lỗi dữ liệu đầu vào'));
      return;  // kết thúc chương trình
    }
    let config = readConfig();      // đọc cấu hình từ file config.txt
    const accounts = readAccounts();   // đọc danh sách tài khoản từ file acc.txt
    const proxies = readProxies();     // đọc danh sách proxy từ file proxy.txt

    // Hiển thị menu tùy chỉnh cấu hình
    config = await showConfigMenu(config);

    const maxThreads = parseInt(config.max_threads) || Math.max(1, Math.floor(os.cpus().length / 2));  // số luồng tối đa, mặc định là nửa số CPU
    const maxRetries = parseInt(config.max_retries) || 3;  // số lần thử lại tối đa, mặc định là 3

    console.log(chalk.bgMagenta.white.bold('\n===== THÔNG TIN CHẠY ====='));
    console.log(chalk.yellow(`• Website: ${chalk.white.bold(config.website)}`));
    console.log(chalk.yellow(`• Số tài khoản: ${chalk.white.bold(accounts.length)}`));
    console.log(chalk.yellow(`• Số luồng: ${chalk.white.bold(maxThreads)}`));
    console.log(chalk.yellow(`• Số lần thử lại: ${chalk.white.bold(maxRetries)}`));
    console.log(chalk.yellow(`• Sử dụng proxy: ${chalk.white.bold(config.use_proxy === 'true' ? 'Có' : 'Không')}`));
    if (config.use_proxy === 'true') {
      console.log(chalk.yellow(`• Số proxy: ${chalk.white.bold(proxies.length)}`));
    }

    console.log(chalk.bgGreen.black.bold(`\n🚀 Bắt đầu xử lý ${chalk.white(accounts.length)} tài khoản với ${chalk.white(maxThreads)} luồng`));
    // Xử lý các tài khoản với giới hạn đồng thời - chia thành các batch
    const results = [];  // mảng lưu kết quả xử lý
    for (let i = 0; i < accounts.length; i += maxThreads) {  // xử lý theo batch, mỗi batch có maxThreads tài khoản
      const batch = accounts.slice(i, i + maxThreads);  // lấy một batch tài khoản
      console.log(chalk.bgCyan.black.bold(`\n🔄 Xử lý batch ${Math.floor(i / maxThreads) + 1}/${Math.ceil(accounts.length / maxThreads)} (${batch.length} tài khoản)`));
      // Trong hàm main()
      const batchPromises = batch.map(async (account, index) => {
        // Lấy proxy nếu cần
        let proxy = null;
        if (config.use_proxy === 'true' && proxies.length > 0) {
          proxy = proxies[index % proxies.length];
          console.log(chalk.cyan(`🔑 Tài khoản ${chalk.white.bold(account.username)} sử dụng proxy: ${chalk.white.bold(proxy.split(':')[0])}:****`));
        }

        // Xử lý tài khoản với retry
        const result = await processAccountWithRetry(
          account,
          config,
          proxy,
          maxRetries,
          processAccount  // Truyền hàm processAccount trực tiếp
        );

        results.push({
          account,
          result
        });

        // Ghi kết quả vào file
        if (result.success && result.balance) {
          const fileName = path.join(RESULTS_PATH, 'money_acc.txt');
          fs.appendFileSync(fileName, result.content + '\n');
        }
      });
      await Promise.all(batchPromises);
      // Delay giữa các batch nếu cần
      if (i + maxThreads < accounts.length) {
        const batchDelay = getRandomDelay(3000, 5000, config);
        console.log(chalk.bgYellow.black(`⏳ Đợi ${batchDelay / 1000}s trước khi xử lý batch tiếp theo...`));
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }
    // Tạo báo cáo tổng hợp
    console.log(chalk.bgBlue.white.bold('\n===== KẾT QUẢ XỬ LÝ ====='));

    // Thống kê nhanh
    const successful = results.filter(r => r.result.success).length;
    const failed = results.length - successful;
    const withEnvelopes = results.filter(r => r.result.hasCollectedEnvelope).length;

    console.log(chalk.yellow(`• Tổng số tài khoản: ${chalk.white.bold(results.length)}`));
    console.log(chalk.green(`• Thành công: ${chalk.white.bold(successful)}`));
    console.log(chalk.red(`• Thất bại: ${chalk.white.bold(failed)}`));
    console.log(chalk.magenta(`• Có lì xì: ${chalk.white.bold(withEnvelopes)}`));

    generateReport(results);
  } catch (error) {
    console.log(chalk.bgRed.white.bold(`❌ Lỗi chính: ${error.message}`));
  }

  console.log(chalk.bgMagenta.white.bold('\n===== CHƯƠNG TRÌNH KẾT THÚC =====\n'));
}
// Chạy chương trình nếu là thread chính
if (isMainThread) {
  main();
}
// Thêm hàm getRandomDelay vào file index.js
function getRandomDelay(min, max, config = {}) {
  const minDelay = config.min_delay ? parseInt(config.min_delay) : min;
  const maxDelay = config.max_delay ? parseInt(config.max_delay) : max;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

module.exports = { processAccount };
