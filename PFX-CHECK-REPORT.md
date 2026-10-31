# Báo cáo kiểm tra PFX trong GitHub Secrets / CI

**Repo:** `ZeiGarNik-code/NonstopMaker` (public)
**Ngày kiểm tra:** 31/10/2026
**Branch làm việc:** `arena/dd346b94-nonstopmaker`

## Kết luận nhanh: 🔴 PFX chưa dùng để ký được

Secret chứng chỉ **có tồn tại** nhưng nội dung **không phải file `.pfx` đã mã hóa base64**.
Cần lưu lại secret `WINDOWS_CERTIFICATE` bằng đúng nội dung base64 của file `.pfx` thật (xem mục *Cách sửa*).

| # | Hạng mục | Kết quả | Chi tiết |
|---|----------|---------|----------|
| 1 | Secret `WINDOWS_CERTIFICATE` tồn tại | ✅ Có | Phát hiện trên GitHub Actions runner |
| 2 | Secret `WINDOWS_CERTIFICATE_PASSWORD` tồn tại | ✅ Có | Chỉ xác nhận tồn tại; **chưa kiểm được đúng/sai** vì bước 3 lỗi |
| 3 | Nội dung là base64 hợp lệ | 🔴 **Không** | Thử đủ 5 cách đều thất bại: base64 chuẩn, tự thêm padding, base64 URL-safe, trích thân PEM, hex |
| 4 | Mở được PKCS#12 (`.pfx`/`.p12`) | ⏭️ Chưa kiểm được | Bị chặn bởi lỗi ở bước 3 |
| 5 | Có private key để ký | ⏭️ Chưa kiểm được | Bị chặn bởi lỗi ở bước 3 |
| 6 | Hạn dùng chứng chỉ (expiry) | ⏭️ Chưa kiểm được | Bị chặn bởi lỗi ở bước 3 |
| 7 | Có workflow nào đang dùng 2 secret này để ký | 🔴 **Chưa có** | Repo chưa có workflow ký; secret hiện không được dùng ở đâu (xem mục cuối) |

## Bằng chứng (chỉ thống kê định dạng — không có nội dung secret)

Workflow chẩn đoán [`.github/workflows/check-pfx.yml`](.github/workflows/check-pfx.yml) chạy trực tiếp trên GitHub Actions (nơi duy nhất đọc được secrets khi chạy), không bao giờ in giá trị secret/mật khẩu/private key. Kết quả của lần chạy gần nhất:

- Run: <https://github.com/ZeiGarNik-code/NonstopMaker/actions/runs/41219946289> (commit `bc179f5`)
- Commit Status API ghi lại:

```
pfx/cert-present   success  cert_present=WINDOWS_CERTIFICATE
pfx/pass-present   success  pass_present=WINDOWS_CERTIFICATE_PASSWORD
pfx/secret-format  success  raw_len=77 stripped_len=68 mod4=0 invalid_b64_chars=4
pfx/secret-flags   success  urlsafe_chars=no pem_header=no starts_MII=no pure_hex=no
pfx/base64         failure  base64=INVALID found_cert=WINDOWS_CERTIFICATE decoded_via=NONE
```

**Vì sao khẳng định giá trị hiện tại không phải PFX?**

- Chỉ **77 ký tự** (68 ký tự sau khi bỏ khoảng trắng). Một file `.pfx` thật (chứng chỉ + private key) thường nặng ~2–10 KB → base64 phải dài **hàng nghìn ký tự**. 68 ký tự base64 chỉ tương đương tối đa ~51 byte — không thể chứa một chứng chỉ.
- Có **4 ký tự nằm ngoài bảng base64** (`A–Z a–z 0–9 + / =`) nên không giải mã được.
- Không có header PEM (`-----BEGIN ...`), không bắt đầu bằng `MII` (mở đầu điển hình của chứng chỉ/PFX dạng DER khi base64 hóa), không phải chuỗi hex, không phải base64 URL-safe.

Nói cách khác: nhiều khả năng đã dán nhầm thứ khác (đường dẫn file, thumbprint, một đoạn text/mật khẩu, hoặc chỉ một phần của file base64...) thay vì toàn bộ nội dung base64 của file `.pfx`. Giá trị chính xác không thể xem lại được — GitHub Secrets là *write-only*, và workflow kiểm tra được thiết kế cố ý không in ra nội dung.

## Cách sửa

Cặp tên `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` là chuẩn trong hướng dẫn ký Windows của Tauri: `WINDOWS_CERTIFICATE` phải là **bản base64 của file `.pfx`**, tạo bằng `certutil -encode certificate.pfx base64cert.txt`, còn `WINDOWS_CERTIFICATE_PASSWORD` là mật khẩu export của chính file `.pfx` đó.
(Nguồn: <https://v1.tauri.app/v1/guides/distribution/sign-windows/>)

1. **Trên máy Windows có file `certificate.pfx` thật**, mã hóa lại — chọn 1 trong 2 cách:

   ```bat
   rem Cách A (theo Tauri, cho ra file nhiều dòng kèm header BEGIN/END)
   certutil -encode certificate.pfx base64cert.txt
   ```

   ```powershell
   # Cách B (base64 một dòng duy nhất - tương thích mọi công cụ)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes(".\certificate.pfx")) |
     Set-Content -NoNewline .\pfx-base64.txt
   ```

   Trên Linux/macOS: `base64 -w0 certificate.pfx > pfx-base64.txt`

2. **Kiểm tra nhanh trước khi lưu:** file text kết quả phải dài **hàng nghìn ký tự**; nếu dùng Cách B, mở đầu thường là `MII...`.

3. **Cập nhật secret:** GitHub repo → `Settings → Secrets and variables → Actions → WINDOWS_CERTIFICATE → Update` → dán **toàn bộ** nội dung file ở bước 1 (đừng cắt bớt dòng nào).

4. Đảm bảo `WINDOWS_CERTIFICATE_PASSWORD` là mật khẩu export của **chính file `.pfx` đó**. (Độ đúng của mật khẩu chỉ kiểm được sau khi sửa xong bước 3.)

5. **Chạy lại kiểm tra:** merge workflow `check-pfx.yml` vào `main`, rồi vào `Actions → Check PFX Secret → Run workflow`.
   Kỳ vọng đạt đủ các status: `pfx/base64` ✅ → `pfx/pkcs12` ✅ (mật khẩu đúng) → `pfx/private-key` ✅ (ký được) → `pfx/expiry` ✅ kèm số ngày còn lại, cùng subject/issuer/fingerprint trong Step Summary của run.

> ⚠️ Repo đang **public** nên log Actions và Commit Status ai cũng xem được. Workflow kiểm tra chỉ xuất *thông tin công khai* của chứng chỉ (subject, issuer, hạn dùng, fingerprint — vốn đã lộ trên mọi file đã ký) và tên/độ dài dạng thống kê của secret. Tuyệt đối không tự thêm bước nào in giá trị secret, mật khẩu hay private key vào log.

## Hiện trạng repo / CI liên quan

- `main` (remote) hiện chỉ có `LICENSE` + `README.md` — **chưa có bất kỳ workflow nào**.
- `.github/workflows/blank.yml` (workflow mẫu "Hello, world!") mới nằm ở branch `ZeiGarNik-code-patch-1` / branch Arena này; PR #1 cho nó đã đóng mà chưa merge. File này không dùng secret/PFX nào cả.
- Chưa có Environment, Release, Artifact hay Deployment nào.
- Token tích hợp của Arena bị GitHub từ chối đọc danh sách Secrets/Variables qua API (`403 Resource not accessible by integration`) — đây là lý do phải kiểm tra gián tiếp bằng workflow chạy trên Actions như trên. (Kể cả có quyền admin, GitHub cũng chỉ cho xem *tên* secret, không bao giờ cho đọc lại *giá trị*.)
- Việc cần làm tiếp theo sau khi sửa secret: bổ sung step *import windows certificate* (windows-latest, decode `WINDOWS_CERTIFICATE` → `Import-PfxCertificate` bằng `WINDOWS_CERTIFICATE_PASSWORD`) vào workflow build/ký thực tế, vì hiện tại 2 secret này chưa được workflow nào sử dụng.

## Thay đổi đã thực hiện trên branch này

| Commit | Nội dung |
|--------|----------|
| `6ca9f72` | Thêm workflow chẩn đoán `check-pfx.yml` (kiểm tra 18 tên secret chứng chỉ + 8 tên secret mật khẩu ứng viên) |
| `9e10499` | Bổ sung annotations (không đọc được qua API nên đã thay bằng cách dưới) |
| `5dd665f` | Báo kết quả qua Commit Status API (contexts `pfx/...`) → xác định được 2 secret `WINDOWS_*` |
| `bc179f5` | Chẩn đoán sâu định dạng + thử 5 cách decode dự phòng → kết luận base64 không hợp lệ, dài 77 ký tự |
| (commit này) | Báo cáo `PFX-CHECK-REPORT.md` |
