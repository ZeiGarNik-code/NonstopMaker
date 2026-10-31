<#
.SYNOPSIS
    Tao chung chi ky ma (code-signing) TU KY (self-signed), xuat ra file .pfx
    kem ban base64 de dan vao GitHub Secret WINDOWS_CERTIFICATE.

.DESCRIPTION
    - Chung chi tu ky CHI dung de THU NGHIEM / noi bo. May nguoi dung khac se
      van thay canh bao SmartScreen "Unknown publisher", tru khi ban cai file
      .cer cong khai vao Trusted Root tren tung may test do.
    - De phat hanh cong khai, can chung chi mua tu CA (OV/EV) hoac dich vu
      ky dam may nhu Azure Artifact Signing.
    - Script KHONG in mat khau / private key. File .pfx va file base64 txt
      la BI MAT (tuong duong nhau) - tuyet doi khong commit len GitHub repo.

.PARAMETER PublisherName
    Ten nha phat hanh hien thi trong chung chi (CN=...). Mac dinh: NonstopMaker

.PARAMETER OutputDir
    Thu muc luu ket qua. Mac dinh: Documents\NonstopMaker-Cert

.PARAMETER ValidYears
    So nam hieu luc (1-10). Mac dinh: 3

.PARAMETER CopyBase64ToClipboard
    Neu bat, copy chuoi base64 vao clipboard de dan thang vao GitHub Secret.
    Can than: dung xong nen copy de noi dung khac de xoa khoi clipboard.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\create-pfx.ps1
.EXAMPLE
    .\scripts\create-pfx.ps1 -PublisherName "NonstopMaker" -ValidYears 3 -CopyBase64ToClipboard
#>
[CmdletBinding()]
param(
    [string]$PublisherName = "NonstopMaker",
    [string]$OutputDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NonstopMaker-Cert'),
    [ValidateRange(1, 10)]
    [int]$ValidYears = 3,
    [switch]$CopyBase64ToClipboard
)

$ErrorActionPreference = 'Stop'

function Convert-SecureStringToPlainText {
    param([Parameter(Mandatory = $true)][System.Security.SecureString]$Secure)
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($PublisherName)) {
        throw "PublisherName khong duoc de trong."
    }
    if ($PublisherName -match '[,=+<>#;\\]') {
        throw "PublisherName khong duoc chua cac ky tu: , = + < > # ; \"
    }

    # --- 1. Chuan bi thu muc + duong dan (day la noi gay loi DirectoryNotFound
    #        neu thu muc chua ton tai - script tu tao truoc) ---
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    $pfxPath        = Join-Path $OutputDir 'publisher.pfx'
    $cerPath        = Join-Path $OutputDir 'publisher.cer'
    $txtPath        = Join-Path $OutputDir 'publisher-pfx-base64.txt'
    $tempDecodePath = Join-Path $OutputDir 'publisher.decode-check.pfx'

    if (Test-Path -LiteralPath $pfxPath) {
        Write-Warning "Da ton tai: $pfxPath"
        $answer = Read-Host "Ghi de va tao chung chi MOI? File .pfx cu se mat (y/N)"
        if ($answer -notin @('y', 'Y')) {
            throw "Da huy. Hay doi -OutputDir sang thu muc khac neu muon giu file cu."
        }
        Remove-Item -LiteralPath $pfxPath -Force
        if (Test-Path -LiteralPath $cerPath) { Remove-Item -LiteralPath $cerPath -Force }
        if (Test-Path -LiteralPath $txtPath) { Remove-Item -LiteralPath $txtPath -Force }
    }

    # --- 2. Nhap mat khau PFX (day chinh la secret WINDOWS_CERTIFICATE_PASSWORD) ---
    Write-Host ""
    Write-Host "Dat mat khau cho file .pfx (toi thieu 12 ky tu)." -ForegroundColor Cyan
    Write-Host "LUU mat khau nay vao trinh quan ly mat khau - mat la phai tao lai chung chi moi!" -ForegroundColor Yellow
    $password1 = Read-Host "Nhap mat khau PFX" -AsSecureString
    $password2 = Read-Host "Nhap lai mat khau PFX" -AsSecureString
    $plain1 = Convert-SecureStringToPlainText $password1
    $plain2 = Convert-SecureStringToPlainText $password2
    if ($plain1.Length -lt 12) {
        throw "Mat khau qua ngan (toi thieu 12 ky tu). Chay lai script."
    }
    if ($plain1 -ne $plain2) {
        throw "Hai lan nhap mat khau khong khop. Chay lai script."
    }
    Remove-Variable plain1, plain2 -ErrorAction SilentlyContinue

    # --- 3. Tao chung chi ky ma tu ky trong Cert:\CurrentUser\My ---
    Write-Host ""
    Write-Host "Dang tao chung chi CodeSigning cho CN=$PublisherName ..." -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject "CN=$PublisherName" `
        -FriendlyName "NonstopMaker Code Signing (Self-Signed)" `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears($ValidYears)

    # --- 4. Xuat .pfx (chung chi + private key, bao ve bang mat khau) va .cer (cong khai) ---
    Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
        -FilePath $pfxPath -Password $password1 | Out-Null
    Export-Certificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
        -FilePath $cerPath | Out-Null

    # --- 5. Ma hoa base64 MOT DONG (dung duong dan VUA TAO - khong con loi DirectoryNotFound) ---
    $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pfxPath))
    Set-Content -LiteralPath $txtPath -Value $base64 -NoNewline -Encoding Ascii

    # --- 6. Tu kiem tra: giai ma nguoc + mo .pfx bang mat khau vua dat ---
    [System.IO.File]::WriteAllBytes($tempDecodePath, [Convert]::FromBase64String($base64))
    $hash1 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pfxPath).Hash
    $hash2 = (Get-FileHash -Algorithm SHA256 -LiteralPath $tempDecodePath).Hash
    Remove-Item -LiteralPath $tempDecodePath -Force
    if ($hash1 -ne $hash2) {
        throw "Kiem tra that bai: base64 giai ma nguoc khong khop file .pfx goc!"
    }

    $loaded = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $pfxPath, $password1
    if (-not $loaded.HasPrivateKey) {
        throw "Kiem tra that bai: file .pfx khong chua private key!"
    }

    if ($CopyBase64ToClipboard) {
        Set-Clipboard -Value $base64
        Write-Host "Da copy base64 vao clipboard - dan ngay vao GitHub Secret WINDOWS_CERTIFICATE." -ForegroundColor Yellow
    }

    # --- 7. Tong ket ---
    $pfxSize = (Get-Item -LiteralPath $pfxPath).Length
    Write-Host ""
    Write-Host "================ TAO PFX THANH CONG ================" -ForegroundColor Green
    Write-Host "Subject (CN)      : $($cert.Subject)"
    Write-Host "Thumbprint        : $($cert.Thumbprint)"
    Write-Host "Hieu luc          : $($cert.NotBefore) -> $($cert.NotAfter)"
    Write-Host "File PFX (BI MAT) : $pfxPath ($pfxSize byte)"
    Write-Host "File CER (cong khai): $cerPath"
    Write-Host "File base64 (BI MAT): $txtPath"
    Write-Host "Do dai base64     : $($base64.Length) ky tu (bat dau bang '$($base64.Substring(0, 3))' - dung chuan thuong la 'MII')"
    Write-Host "Da mo thu .pfx    : mat khau DUNG, co private key = ky duoc"
    Write-Host ""
    Write-Host "BUOC TIEP THEO - cap nhat 2 GitHub Secrets:" -ForegroundColor Cyan
    Write-Host "  1. Mo file base64 txt o tren, Ctrl+A -> Ctrl+C de copy TOAN BO (hang nghin ky tu)."
    Write-Host "  2. GitHub repo -> Settings -> Secrets and variables -> Actions"
    Write-Host "     -> WINDOWS_CERTIFICATE -> Update -> dan vao."
    Write-Host "  3. WINDOWS_CERTIFICATE_PASSWORD -> Update -> nhap MAT KHAU VUA DAT o tren."
    Write-Host "  4. Xoa file base64 txt sau khi dan xong (no tuong duong file .pfx)."
    Write-Host "     Giu lai publisher.pfx + mat khau o noi an toan (o cung ma hoa / password manager)."
    Write-Host "  5. Bao lai 'da cap nhat secret' de chay lai workflow kiem tra PFX."
    Write-Host ""
    Write-Host "CANH BAO: chung chi tu ky chi de test. Nguoi dung may khac van gap" -ForegroundColor Yellow
    Write-Host "SmartScreen/'Unknown publisher' - phat hanh cong khai can chung chi CA." -ForegroundColor Yellow

    Remove-Variable base64, password1, password2 -ErrorAction SilentlyContinue
}
catch {
    Write-Host ""
    Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
