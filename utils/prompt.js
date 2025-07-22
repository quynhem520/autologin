// utils/prompt.js
const readline = require('readline');

/**
 * Hiển thị prompt và lấy input từ người dùng
 * @param {string} question - Câu hỏi hiển thị
 * @param {string} defaultValue - Giá trị mặc định nếu người dùng không nhập
 * @returns {Promise<string>} - Input của người dùng
 */
function promptUser(question, defaultValue = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`${question}${defaultValue ? ` (mặc định: ${defaultValue})` : ''}: `, (answer) => {
      rl.close();
      resolve(answer || defaultValue);
    });
  });
}

/**
 * Hiển thị prompt yes/no và lấy lựa chọn từ người dùng
 * @param {string} question - Câu hỏi hiển thị
 * @param {boolean} defaultValue - Giá trị mặc định nếu người dùng không nhập
 * @returns {Promise<boolean>} - true nếu người dùng chọn yes, false nếu chọn no
 */
async function promptYesNo(question, defaultValue = true) {
  const defaultStr = defaultValue ? 'y' : 'n';
  const answer = await promptUser(`${question} (y/n)`, defaultStr);
  return answer.toLowerCase().startsWith('y');
}

module.exports = {
  promptUser,
  promptYesNo
};