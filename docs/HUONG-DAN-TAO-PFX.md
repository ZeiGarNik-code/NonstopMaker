# Hướng dẫn tạo file PFX và cập nhật GitHub Secret (Windows)

> Mục tiêu cuối: secret **`WINDOWS_CERTIFICATE`** = chuỗi **base64 của toàn bộ file `.pfx`** (dài hàng nghìn ký tự), và **`WINDOWS_CERTIFICATE_PASSWORD`** = mật khẩu của chính file `.pfx` đó.

## 1. Lỗi bạn vừa gặp là gì?

```
Exception calling "ReadAllBytes" ... "Could not find a part of the path 'C:\duong-dan-an-toan\publisher.pfx'."
FullyQualifiedErrorId : DirectoryNotFoundException
```

Nghĩa là: **file `publisher.pfx` tại đường dẫn đó không tồn tại** (thư mục không có, hoặc đường dẫn chỉ là ví dụ mẫu chưa thay bằng đường dẫn thật). Lệnh chuyển base64 chỉ chạy được khi file `.pfx` **đã có sẵn**.

Kiểm tra / tìm thử trên máy bạn (PowerShell):

```powershell
Test-Path 'C:\duong-dan-an-toan\publisher.pfx'   # False = không có file ở đó

# Tìm file .pfx trong thư mục người dùng
Get-ChildItem "$HOME" -Filter *.pfx -Recurse -ErrorAction SilentlyContinue |
  Select-Object FullName
```

## 2. Bạn thuộc trường hợp nào?

| Trường hợp | Cách làm |
|---|---|
| **A. Chưa có file `.pfx` nào** (trường hợp phổ biến nhất) | Tạo mới bằng script ở mục 3 👇 |
| **B. Đã có file `.pfx`** ở đường dẫn khác | Nhảy tới mục 5 để mã hóa base64 |
| **C. Chỉ có `.cer`/`.crt` + private key `.key`** (VD chứng chỉ đã mua) | Gộp thành `.pfx` ở mục 6, rồi qua mục 5 |
| **D. Phát hành cho người dùng thật, muốn hết cảnh báo SmartScreen** | Đọc mục 8 — chứng chỉ tự ký (mục 3) **không đủ**, cần mua chứng chỉ CA / dùng Azure Artifact Signing |

## 3. Cách A — Tạo `.pfx` mới bằng script (khuyên dùng)

Script [`scripts/create-pfx.ps1`](../scripts/create-pfx.ps1) làm toàn bộ: tạo chứng chỉ ký mã (tự ký) → xuất `publisher.pfx` + `publisher.cer` → mã hóa base64 → tự kiểm tra lại mật khẩu/private key.

**Bước 1 — Lấy repo về máy** (nếu chưa có):

```powershell
cd $HOME
git clone https://github.com/ZeiGarNik-code/NonstopMaker.git
cd NonstopMaker
```

**Bước 2 — Chạy script** (PowerShell thường, **không** cần quyền Admin):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-pfx.ps1 -PublisherName "NonstopMaker" -CopyBase64ToClipboard
```

**Bước 3 — Đặt mật khẩu** khi script hỏi (nhập 2 lần, tối thiểu 12 ký tự).

> 🔑 Mật khẩu này chính là secret `WINDOWS_CERTIFICATE_PASSWORD` sau này. **Lưu vào trình quản lý mật khẩu** (Bitwarden/1Password...). Mất mật khẩu = file `.pfx` vô dụng, phải tạo chứng chỉ mới.

**Bước 4 — Kiểm tra kết quả** trong thư mục `Documents\NonstopMaker-Cert`:

| File | Là gì | Bí mật? |
|---|---|---|
| `publisher.pfx` | Chứng chỉ + private key | 🔴 **BÍ MẬT** — giữ như chìa khóa, không gửi/commit đi đâu |
| `publisher-pfx-base64.txt` | Bản base64 của `.pfx` để dán vào GitHub | 🔴 **BÍ MẬT tương đương `.pfx`** — xóa sau khi dán xong |
| `publisher.cer` | Chứng chỉ công khai | 🟢 Công khai, chia sẻ được |

Script báo thành công khi: file `.pfx` vài KB, base64 dài **hàng nghìn ký tự** và bắt đầu bằng `MII`, mở thử bằng mật khẩu vừa đặt thấy có private key.

## 4. Cập nhật 2 GitHub Secrets

1. Mở file `publisher-pfx-base64.txt` → **Ctrl+A** → **Ctrl+C** (copy *toàn bộ*, không cắt bớt).
   Nếu đã dùng `-CopyBase64ToClipboard` ở bước 2 thì chuỗi base64 đang sẵn trong clipboard.
2. Mở repo trên GitHub → **Settings → Secrets and variables → Actions**.
3. Chọn **`WINDOWS_CERTIFICATE`** → **Update** → dán vào → lưu.
4. Chọn **`WINDOWS_CERTIFICATE_PASSWORD`** → **Update** → nhập mật khẩu đã đặt ở mục 3 → lưu.
5. **Xóa file `publisher-pfx-base64.txt`** (và copy đè nội dung khác để xóa clipboard nếu đã copy).
   Giữ lại `publisher.pfx` + mật khẩu ở nơi an toàn (ổ đĩa mã hóa / password manager) — đây là bản gốc duy nhất.
6. Nhắn lại **"đã cập nhật secret"** để mình chạy lại workflow kiểm tra. Kỳ vọng: `pfx/pkcs12` ✅ mật khẩu đúng → `pfx/private-key` ✅ ký được → `pfx/expiry` ✅ còn hạn.

## 5. Cách B — Đã có sẵn file `.pfx`

Dùng script [`scripts/encode-existing-pfx.ps1`](../scripts/encode-existing-pfx.ps1) với **đường dẫn thật**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\encode-existing-pfx.ps1 `
  -PfxPath "C:\duong-dan-THAT-tren-may-ban\publisher.pfx"
```

Script sẽ hỏi mật khẩu, kiểm tra private key + hạn dùng, rồi xuất file `*-base64.txt` ngay cạnh file gốc. Sau đó làm tiếp mục 4.

*(Bản chất lệnh gốc trong lỗi của bạn vẫn đúng — chỉ cần đường dẫn thật trỏ tới file đã tồn tại là chạy. Script này chỉ giúp báo lỗi dễ hiểu hơn.)*

## 6. Cách C — Gộp `.cer`/`.crt` + `.key` thành `.pfx` bằng OpenSSL

Windows thường đã có OpenSSL kèm Git Bash:

```powershell
& "C:\Program Files\Git\usr\bin\openssl.exe" pkcs12 -export `
  -in .\cert.crt -inkey .\private-key.key `
  -out .\publisher.pfx -name "NonstopMaker"
```

OpenSSL sẽ hỏi bạn đặt **Export Password** — đó là mật khẩu `.pfx` (secret `WINDOWS_CERTIFICATE_PASSWORD` về sau). Xong thì mã hóa base64 theo mục 5.

## 7. Lỗi thường gặp

| Lỗi | Nguyên nhân & cách xử lý |
|---|---|
| `DirectoryNotFoundException` | Thư mục trong đường dẫn không tồn tại → dùng đường dẫn thật, hoặc chạy script mục 3 (tự tạo thư mục). Kiểm tra bằng `Test-Path`. |
| `... cannot be loaded because running scripts is disabled` | Thêm `-ExecutionPolicy Bypass` như các lệnh mẫu trên (chỉ áp dụng cho lần chạy đó). |
| `The specified network password is not correct` | Sai mật khẩu `.pfx`, hoặc 2 secret không cùng một cặp (cert của file A, mật khẩu của file B). |
| Base64 dán vào GitHub vẫn "INV
...[truncated 1573 chars]