# 진짜 윈도우(GitHub Actions windows-latest)에서 설치 프로그램 · 업데이트 도우미 시험
#   pwsh test/windows_test.ps1 -Version 1.0.0     (dist/ 에 빌드 결과가 있어야 함)
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dist = Join-Path $root 'dist'
$setup = Join-Path $dist "Pullim-Setup-$Version.exe"
$dir = Join-Path $env:LOCALAPPDATA 'Pullim'
$ext = Join-Path $dir 'extension'
$script:fail = 0
function Check([string]$name, [bool]$cond, $extra = '') {
  if ($cond) { Write-Host "ok - $name" } else { Write-Host "FAIL - $name $extra"; $script:fail++ }
}
function ManifestVersion { (Get-Content (Join-Path $ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version }

Write-Host "== 설치 ($setup)"
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Check '설치 프로그램이 0 으로 끝남' ($p.ExitCode -eq 0) $p.ExitCode
Check '확장 폴더 버전' ((ManifestVersion) -eq $Version)
Check '안내 페이지' (Test-Path (Join-Path $ext 'guide.html'))
Check '업데이트 도우미 + manifest' ((Test-Path (Join-Path $dir 'PullimHelper.exe')) -and (Test-Path (Join-Path $dir 'PullimHelper.exe.manifest')))
$info = Get-Content (Join-Path $ext 'install-info.json') -Raw | ConvertFrom-Json
Check 'install-info.json = setup' ($info.installer -eq 'setup' -and $info.version -eq $Version)

$zip = Join-Path $dist "pullim-extension-$Version.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($zip)
$names = $z.Entries | Where-Object { $_.FullName -ne 'install-info.json' } | ForEach-Object { $_.FullName }
$z.Dispose()
$missing = $names | Where-Object { -not (Test-Path (Join-Path $ext $_)) }
Check 'zip 의 파일이 모두 설치됨' (-not $missing) ($missing -join ', ')

schtasks /Query /TN 'Pullim Helper' /V /FO LIST | Out-String | Tee-Object -Variable task | Out-Null
Check '예약 작업 (3시간마다)' ($LASTEXITCODE -eq 0 -and $task -match 'PullimHelper\.exe') $task
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) '풀림 업데이트 도우미.lnk'
$sh = New-Object -ComObject WScript.Shell
Check '시작 프로그램 바로가기' (Test-Path $startup)
if (Test-Path $startup) {
  $lnk = $sh.CreateShortcut($startup)
  Check '시작 프로그램 바로가기 대상' ($lnk.TargetPath -like '*\Pullim\PullimHelper.exe' -and $lnk.Arguments -eq '--startup') "$($lnk.TargetPath) $($lnk.Arguments)"
}
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) '풀림'
foreach ($n in '풀림 설치 안내.lnk', '풀림 업데이트 확인.lnk', '풀림 확장 프로그램 폴더.lnk', '풀림 제거.lnk') {
  Check "시작 메뉴: $n" (Test-Path (Join-Path $menu $n))
}
$reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Pullim' -ErrorAction SilentlyContinue
Check '앱 목록 등록' ($reg -and $reg.DisplayVersion -eq $Version -and $reg.UninstallString -like '*Uninstall.exe*')

Write-Host "`n== 업데이트 도우미 (진짜 .NET Framework)"
python (Join-Path $root 'test/helper_test.py') (Join-Path $dir 'PullimHelper.exe')
Check '도우미 시험 모음' ($LASTEXITCODE -eq 0)

Write-Host "`n== 설치된 도우미로 가짜 새 버전 받기"
$site = Join-Path $env:TEMP 'pullim-site'
Remove-Item $site -Recurse -Force -ErrorAction SilentlyContinue
$unz = Join-Path $site 'unz'
New-Item -ItemType Directory -Force -Path $unz | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory($zip, $unz)
$mfPath = Join-Path $unz 'manifest.json'
$mf = Get-Content $mfPath -Raw -Encoding UTF8 | ConvertFrom-Json
$mf.version = '9.9.9'
[IO.File]::WriteAllText($mfPath, ($mf | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
New-Item -ItemType Directory -Force -Path (Join-Path $site 'v9.9.9') | Out-Null
$newZip = Join-Path $site 'v9.9.9\pullim-extension-9.9.9.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($unz, $newZip)
$hash = (Get-FileHash $newZip -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $newZip).Length
$port = 18766
$latest = @{ version = '9.9.9'; notes = 'test'; minHelper = 1; extension = @{ url = "http://127.0.0.1:$port/v9.9.9/pullim-extension-9.9.9.zip"; sha256 = $hash; size = $size } }
[IO.File]::WriteAllText((Join-Path $site 'latest.json'), ($latest | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
$srv = Start-Process python -ArgumentList '-m', 'http.server', "$port", '--bind', '127.0.0.1', '--directory', $site -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$h = Start-Process (Join-Path $dir 'PullimHelper.exe') -ArgumentList '--feed', "http://127.0.0.1:$port/latest.json", '--allow-prefix', "http://127.0.0.1:$port/", '--no-delay' -Wait -PassThru
Check '설치된 도우미가 새 버전으로 바꿈 (종료 코드 10)' ($h.ExitCode -eq 10) $h.ExitCode
Check '설치 폴더의 버전이 9.9.9' ((ManifestVersion) -eq '9.9.9')
$log = Get-Content (Join-Path $dir 'helper.log') -Raw -Encoding UTF8
Check '도우미 기록' ($log -match '9\.9\.9') $log
Stop-Process $srv -Force -ErrorAction SilentlyContinue

Write-Host "`n== 설치 프로그램으로 덮어 설치 (예전 버전으로 되돌리기도 됨)"
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Check '덮어 설치' ($p.ExitCode -eq 0 -and (ManifestVersion) -eq $Version)

Write-Host "`n== 제거"
Start-Process (Join-Path $dir 'Uninstall.exe') -ArgumentList '/S' -Wait | Out-Null
for ($i = 0; $i -lt 60 -and (Test-Path $ext); $i++) { Start-Sleep -Milliseconds 500 }
Check '확장 폴더 지워짐' (-not (Test-Path $ext))
Start-Sleep -Seconds 2
Check '도우미 지워짐' (-not (Test-Path (Join-Path $dir 'PullimHelper.exe')))
schtasks /Query /TN 'Pullim Helper' 2>&1 | Out-Null
Check '예약 작업 지워짐' ($LASTEXITCODE -ne 0)
Check '시작 프로그램 바로가기 지워짐' (-not (Test-Path $startup))
Check '시작 메뉴 지워짐' (-not (Test-Path $menu))
Check '앱 목록에서 빠짐' (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Pullim'))

Write-Host "`n실패 $script:fail"
exit $script:fail
