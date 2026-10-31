# Báo cáo kiểm tra PFX trong GitHub Secrets / CI

**Repo:** `ZeiGarNik-code/NonstopMaker` (public)
**Kiểm tra lần đầu:** 31/10/2026 · **Kiểm tra lại sau khi sửa:** 01/11/2026
**Branch làm việc:** `arena/dd346b94-nonstopmaker`

## Kết luận nhanh: 🟢 PFX ĐẠT — ký được (14/14 hạng mục)

Sau khi tạo chứng chỉ tự ký mới bằng [`scripts/create-pfx.ps1`](scripts/create-pfx.ps1) và cập nhật lại 2 secret, PFX đã vượt qua toàn bộ kiểm tra ở **2 lần chạy liên tiếp**:

- <https://github.com/ZeiGarNik-code/NonstopMaker/actions/runs/41237411215> (commit `48034f8`)
- <https://github.com/ZeiGarNik-code/NonstopMaker/actions/runs/41237536457> (commit `0aae34b`)

| # | Hạng mục | Kết quả | Chi tiết |
|---|----------|---------|----------|
| 1 | Secret `WINDOWS_CERTIFICATE` | ✅ | Base64 dài **4.704 ký tự**, 0 ký tự lạ, mở đầu `MII`, giải mã ra file 3.526 byte |
| 2 | Secret `WINDOWS_CERTIFICATE_PASSWORD` | ✅ | Mật khẩu **đúng** với chính file PFX trên (`pkcs12=OK password_correct`) |
| 3 | Parse PKCS#12 (`.pfx`) | ✅ | Mở thành công bằng OpenSSL trên runner |
| 4 | Private key đi kèm | ✅ | Có — **ký được** (`can_sign=yes`, chỉ đếm, không in key) |
| 5 | Chủ thể chứng chỉ | `CN=NonstopMaker` (tự ký: issuer trùng subject) | |
| 6 | Hiệu lực | ✅ Còn hạn | 31/10/2026 → **31/10/2029** (GMT), còn 1.095 ngày lúc kiểm tra |
| 7 | Serial | `6D869309B6DB37834C45096C99FE85C5` | |
| 8 | SHA256 Fingerprint | `4D:A9:8C:87:5E:74:0F:7A:4E:A4:4F:57:46:1C:D5:5B:AB:11:FC:B0:80:DA:71:81:D6:22:49:E0:30:BA:02:DF` | |

Bằng chứng (Commit Status API, trích):

```
pfx/cert-present   success  cert_present=WINDOWS_CERTIFICATE
pfx/pass-present   success  pass_present=WINDOWS_CERTIFICATE_PASSWORD
pfx/secret-format  success  raw_len=4704 stripped_len=4704 mod4=0 invalid_b64_chars=0
pfx/secret-flags   success  urlsafe_chars=no pem_header=no starts_MII=yes pure_hex=no
pfx/base64         success  decode=OK via=standard size_bytes=3526
pfx/pkcs12         success  pkcs12=OK password_correct
pfx/private-key    success  private_key=PRESENT can_sign=yes
pfx/expiry         success  expiry=STILL_VALID days_left=1095
```

## ⚠️ Vấn đề còn lại: build Windows dùng TÊN SECRET KHÁC

Workflow build thật — `.github/workflows/build-windows-app.yml` trên branch `arena/9089ab23-nonstopmaker` — **không** đọc `WINDOWS_CERTIFICATE*`, mà đọc:

- `WINDOWS_CSC_PFX_BASE64`
- `WINDOWS_CSC_KEY_PASSWORD`

Cả 2 secret này **chưa tồn tại** (trình kiểm tra đã bổ sung 2 tên này vào danh sách ứng viên và xác nhận không thấy), vì vậy bản build gần nhất ([run 41233135496](https://github.com/ZeiGarNik-code/NonstopMaker/actions/runs/41233135496)) vẫn cho artifact **`NonstopMaker-Lite-Windows-unsigned`**.

**Cách sửa (2 phút):** tạo thêm 2 secret với *cùng giá trị*:

```powershell
# Copy lại base64 của file .pfx đã tạo vào clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Documents\NonstopMaker-Cert\publisher.pfx")) | Set-Clipboard
```

Vào `Settings → Secrets and variables → Actions → New repository secret`:

1. Tên `WINDOWS_CSC_PFX_BASE64` → dán (Ctrl+V).
2. Tên `WINDOWS_CSC_KEY_PASSWORD` → nhập cùng mật khẩu PFX.

Chạy lại workflow build Windows; artifact đúng kỳ vọng sẽ đổi thành `NonstopMaker-Lite-Windows-**signed**`.
*(Cách khác: sửa workflow build để dùng thống nhất tên `WINDOWS_CERTIFICATE*` — tùy bạn chọn một chuẩn, đừng để hai cặp lệch nhau.)*

## Lịch sử xử lý

| Thời điểm | Sự việc |
|---|---|
| 31/10/2026 | Kiểm tra lần đầu: `WINDOWS_CERTIFICATE` chỉ dài **77 ký tự**, không phải base64 của PFX (4 ký tự ngoài bảng base64, không header PEM, không mở đầu `MII`) → 🔴 không ký được. Bằng chứng: [run 41219946289](https://github.com/ZeiGarNik-code/NonstopMaker/actions/runs/41219946289) |
| 31/10/2026 | Tạo bộ script `scripts/create-pfx.ps1` / `scripts/encode-existing-pfx.ps1` + [`docs/HUONG-DAN-TAO-PFX.md`](docs/HUONG-DAN-TAO-PFX.md) + `.gitignore` chặn commit nhầm khóa bí mật |
| 01/11/2026 | Người dùng tạo chứng chỉ tự ký `CN=NonstopMaker` (RSA 3072, hạn 3 năm) và cập nhật lại 2 secret → kiểm tra lại **ĐẠT 14/14**, 2 lần liên tiếp |

## Lưu ý lâu dài

- Đây là **chứng chỉ tự ký**: ký được về kỹ thuật, nhưng máy người dùng khác vẫn gặp SmartScreen «Unknown publisher». Phát hành công khai cần chứng chỉ CA (OV/EV) hoặc Azure Artifact Signing.
- **Hết hạn 31/10/2029** — đặt nhắc gia hạn/tạo mới trước thời điểm này; khi tạo mới phải cập nhật lại *cả hai* cặp secret (nếu còn dùng song song).
- Giữ `publisher.pfx` gốc + mật khẩu trong kho an toàn (ổ mã hóa / password manager). Lộ bất kỳ đâu → tạo chứng chỉ mới ngay.
- Repo public nên log/status CI là công khai; workflow kiểm tra chỉ xuất thông tin công khai của chứng chỉ và thống kê định dạng, không bao giờ in giá trị secret/mật khẩu/private key.

## Thay đổi trên branch này

| Commit | Nội dung |
|--------|----------|
| `6ca9f72` → `bc179f5` | Workflow chẩn đoán `check-pfx.yml` + báo kết quả qua Commit Status API + chẩn đoán sâu định dạng secret |
| `1977df4` | Báo cáo lần đầu (🔴) |
| `635fc02` → `4b18a31` | Script tạo PFX + hướng dẫn (kèm cách tải ZIP không cần Git) + `.gitignore` |
| `48034f8` | Chạy lại kiểm tra sau khi cập nhật secret → **ĐẠT** |
| `0aae34b` | Bổ sung kiểm tra cặp secret `WINDOWS_CSC_*` của workflow build Windows → xác nhận chưa tồn tại |
| (commit này) | Cập nhật báo cáo theo trạng thái cuối (🟢) |
