<#
.SYNOPSIS
    Ma hoa MOT file .pfx DA CO SAN sang base64 (1 dong) de dan vao
    GitHub Secret WINDOWS_CERTIFICATE, kem kiem tra mat khau + private key.

    Day la ban "an toan" cua lenh:
      [Convert]::ToBase64String([IO.File]::ReadAllBytes('...\publisher.pfx'))
    - khac o cho script kiem tra duong dan truoc va bao loi de hieu,
      thay vi loi DirectoryNotFoundException kho doc.

.EXAMPLE
    .\scripts\encode-existing-pfx.ps1 -PfxPath "C:\duong-dan-dung\publisher.pfx"
    (thay bang duong dan THAT tren may cua ban)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PfxPath,
    [string]$OutputTxt
)

$ErrorActionPreference = 'Stop'

try {
    # --- Kiem tra duong dan truoc khi doc (tranh DirectoryNotFoundException) ---
    if (-not (Test-Path -LiteralPath $PfxPath -PathType Leaf)) {
        Write-Host "KHONG TIM THAY FILE: $PfxPath" -ForegroundColor Red
        Write-Host "Hay kiem tra lai: thu muc co ton tai khong? Ten file dung khong?"
        Write-Host "Tim thu file .pfx trong thu muc nguoi dung bang lenh:"
        Write-Host '  Get-ChildItem "$HOME" -Filter *.pfx -Recurse -ErrorAction SilentlyContinue | Select-Object FullName'
        Write-Host "Neu chua co file .pfx nao, hay tao moi bang: .\scripts\create-pfx.ps1"
        exit 1
    }

    $fullPath = (Resolve-Path -LiteralPath $PfxPath).Path
    if (-not $OutputTxt) {
        $OutputTxt = Join-Path ([System.IO.Path]::GetDirectoryName($fullPath)) `
            (([System.IO.Path]::GetFileNameWithoutExtension($fullPath)) + "-base64.txt")
    }

    # --- Kiem tra mat khau + private key + han dung ---
    $password = Read-Host "Nhap mat khau cua file .pfx nay" -AsSecureString
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $fullPath, $password
    if (-not $cert.HasPrivateKey) {
        throw "File nay KHONG chua private key -> khong ky duoc. Can xuat lai .pfx kem private key."
    }
    if ((Get-Date) -gt $cert.NotAfter) {
        throw "Chung chi DA HET HAN vao $($cert.NotAfter). Can cap chung chi moi."
    }

    # --- Ma hoa base64 1 dong ---
    $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($fullPath))
    Set-Content -LiteralPath $OutputTxt -Value $base64 -NoNewline -Encoding Ascii

    $size = (Get-Item -LiteralPath $fullPath).Length
    Write-Host ""
    Write-Host "================ MA HOA THANH CONG ================" -ForegroundColor Green
    Write-Host "File PFX          : $fullPath ($size byte)"
    Write-Host "Subject           : $($cert.Subject)"
    Write-Host "Issuer            : $($cert.Issuer)"
    Write-Host "Het han           : $($cert.NotAfter)"
    Write-Host "Co private key    : CO (ky duoc)"
    Write-Host "File base64 (BI MAT): $OutputTxt"
    Write-Host "Do dai base64     : $($base64.Length) ky tu (bat dau bang '$($base64.Substring(0, 3))')"
    Write-Host ""
    Write-Host "Cap nhat GitHub Secrets: dan TOAN BO file base64 vao WINDOWS_CERTIFICATE,"
    Write-Host "mat khau vua nhap vao WINDOWS_CERTIFICATE_PASSWORD, roi xoa file base64 txt."

    Remove-Variable base64, password -ErrorAction SilentlyContinue
}
catch {
    Write-Host ""
    Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "(Neu loi la 'password is incorrect' thi mat khau .pfx nhap sai.)"
    exit 1
}
