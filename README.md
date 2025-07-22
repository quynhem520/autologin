# Tool Auto HI88

## Hướng dẫn sử dụng

### Cài đặt

1. Cài đặt Node.js từ [nodejs.org](https://nodejs.org/)
2. Chạy file `install.bat` để cài đặt các gói phụ thuộc

### Cấu hình

1. Tạo file `config/config.txt` với nội dung:
   ```
   website=https://hi8823.com
   max_threads=2
   max_retries=3
   use_proxy=false
   ```

2. Tạo file `config/acc.txt` với định dạng:
   ```
   username1|password1
   username2|password2
   ```

3. (Tùy chọn) Tạo file `config/proxy.txt` với mỗi proxy trên một dòng:
   ```
   ip:port
   ip:port:username:password
   username:password@ip:port
   ```

### Chạy tool

1. Chạy file `start.bat` để khởi động tool
2. Làm theo các hướng dẫn trên màn hình

### Lưu ý

- Kết quả sẽ được lưu trong thư mục `results`
- Log chi tiết được lưu trong thư mục `logs`
- Báo cáo tổng hợp được lưu trong thư mục `reports`

# Quy trình tự động thao tác đăng nhập và nhận lì xì trên trình duyệt

---

## **Bước 1: Truy cập website**
- Truy cập link trang chủ, sau đó thêm `/Login` hoặc `/Account/Login` vào cuối URL để chuyển đến trang đăng nhập.
  - **Ví dụ:**
    `https://hi8823.com/Login`
    `https://hi8823.com/Account/Login`

---

## **Bước 2: Nhập thông tin đăng nhập và kích hoạt captcha**
- Chờ trang login load hoàn toàn, các form nhập thông tin hiện ra.
- Nhập **tài khoản** vào các trường có thể là:
  - `'input[autocapitalize="login"]'`
  - `'input[placeholder="Vui lòng nhập tài khoản"]'`
  - `'input[formcontrolname="account"]'`
  - `'input[placeholder="Vui lòng nhập tên tài khoản"]'`
- Duyệt qua từng selector để tìm field tài khoản và nhập giá trị.
- Nhập **mật khẩu** vào các trường có thể là:
  - `'input[autocomplete="password"]'`
  - `'input[placeholder="Vui lòng nhập mật mã"]'`
  - `'input[formcontrolname="password"]'`
  - `'input[placeholder="Vui lòng nhập mật khẩu"]'`
- Duyệt qua từng selector để tìm field mật khẩu và nhập giá trị.
- Kích hoạt **captcha**:
  - Click vào trường nhập captcha hoặc nút làm mới captcha (biểu tượng *refresh*).
    - `'input[formcontrolname="checkCode"]'`
    - `'input[placeholder="Vui lòng nhập mã xác minh"]'`
    - `'input[model="$ctrl.code"]'`
    - Nút làm mới: `'i.fas.fa-sync'`, `'i.refreshhaptch'`
  - Đợi 1 giây để captcha hiện ra, sau đó nhập mã xác minh vào trường.

---

## **Bước 3: Xử lý phần đăng nhập**
- Sau khi nhập đủ thông tin và captcha, nhấn nút **Đăng nhập** với các selector phổ biến:
  - `'button[ng-class="$ctrl.styles[\'login-btn\']"]'`
  - `'button.Home_Login'`
  - `'button.login-btn'`
  - `'button[translate="Shared_Login"]'`
  - `'span[translate="Shared_Login"]'`
- Theo dõi thông báo lỗi đăng nhập (nếu có), ví dụ:
  - Sai tài khoản/mật khẩu: `Lỗi đăng nhập`
  - Sai mã xác minh: `Lỗi mã xác minh`
  - Hoặc lỗi 403: `Http failure response for login: 403 OK`
  - Các phần tử chứa thông báo:
    - `div[bind-html-compile="$ctrl.content"]`
    - `mat-dialog-content.ng-star-inserted`

---

## **Bước 4: Đóng quảng cáo, nhận lì xì (nếu có)**
- Sau khi đăng nhập thành công, chờ khoảng 2 giây để bảng quảng cáo hiện lên.
- Đóng liên tục 2 bảng quảng cáo (bằng phím ESC hoặc click ra ngoài).
- Chờ thêm 2-3 giây để kiểm tra có **hồng bao**/lì xì không.
  - Nếu có, tìm và nhấn vào nút/hình hồng bao:
    - `<div translate="RedEnvelope_GrabEenvelope">Hồng Bao May Mắn</div>`
    - `<span translate="RedEnvelope_Open">mở ra</span>`
    - `<img ... ng-click="$ctrl.withdraw(redEnvelope)">`
- Kiểm tra số tiền hồng bao và nhấn nút **Nhận**:
  - `<button ng-click="$ctrl.remove(redEnvelope)">vui vẻ thu lại thôi</button>`
- Lặp lại thao tác nhận cho các hồng bao còn lại (nếu có).

---

## **Bước 5: Kiểm tra số dư**
- Thêm `/MemberCenter/SecurityList` vào cuối link để chuyển sang trang kiểm tra số dư.
  - **Ví dụ đúng:**
    `https://hi8823.com/MemberCenter/SecurityList`
- Đợi trang tải hoàn toàn, tìm và nhấn nút **làm mới** số dư:
  - `<i class="fas fa-sync" ...>`
- Sau khi nhấn làm mới 1-2 lần, kiểm tra số dư hiện có:
  - `<span ... ng-bind="$ctrl.userInfo.balance | currencyDefault">23.47</span>`
- Lấy kết quả số dư sau khi nhấn nút làm mới.

---

## **Bước 6: Xuất file kết quả**
- Xuất kết quả số dư vào file `.txt` theo định dạng:
  - `taikhoan|matkhau|hi8823|số dư: xx.x`

---

**Lưu ý:**
- Đảm bảo thực hiện từng bước đúng quy trình như hướng dẫn trên để tránh lỗi đăng nhập hoặc mất quyền nhận lì xì/hồng bao.
- Nếu gặp lỗi, kiểm tra lại các trường nhập và captcha, thử lại thao tác đăng nhập.
