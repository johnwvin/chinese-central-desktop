param([switch]$SkipWebInstall)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
foreach ($tool in @('npm', 'go', 'cargo')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Install $tool and add it to PATH before building."
    }
}

function Run-Tool($command, [string[]]$arguments) {
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { throw "$command failed with exit code $LASTEXITCODE." }
}

$web = Join-Path $root 'web'
if (-not $SkipWebInstall) { Run-Tool npm @('--prefix', $web, 'ci') }
Run-Tool npm @('--prefix', $web, 'run', 'build')

$package = Join-Path ([IO.Path]::GetTempPath()) ('cc-vanilla-package-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $package 'Chinese Central'
New-Item -ItemType Directory -Path $app | Out-Null
Push-Location (Join-Path $root 'go')
try {
    Run-Tool go @('build', '-ldflags', '-H windowsgui', '-o', (Join-Path $app 'Chinese Central Server.exe'), './cmd/central')
} finally { Pop-Location }

$native = Join-Path $root 'src-tauri'
$target = Join-Path $native 'target'
Push-Location $native
try { Run-Tool cargo @('build', '--release', '--locked', '--target-dir', $target) }
finally { Pop-Location }
Copy-Item -LiteralPath (Join-Path $target 'release/chinese-central-desktop.exe') -Destination (Join-Path $app 'Chinese Central.exe')

foreach ($folder in @('bin', 'dict', 'dict/audio', 'dict/strokes', 'dict/vendor')) {
    New-Item -ItemType Directory -Path (Join-Path $app $folder) -Force | Out-Null
}
foreach ($file in @('bin/app.ico', 'dict/cedict.tsv', 'dict/unihan.tsv', 'dict/jieba.tsv', 'dict/ranks.tsv',
                    'dict/mmah.jsonl', 'dict/dong.jsonl', 'dict/wiktionary_classifiers.tsv', 'dict/hanzi-writer.min.js',
                    'dict/vendor/pdf.min.js', 'dict/vendor/pdf.worker.min.js', 'dict/DONG-SOURCE.md',
                    'dict/WIKTIONARY_CLASSIFIERS.md', 'README.md', 'THIRD_PARTY_NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $app $file)
}
foreach ($asset in Get-ChildItem -LiteralPath (Join-Path $root 'dict/audio') -File -Filter 'cmn-*.mp3') {
    Copy-Item -LiteralPath $asset.FullName -Destination (Join-Path $app 'dict/audio')
}
foreach ($asset in Get-ChildItem -LiteralPath (Join-Path $root 'dict/strokes') -File -Filter '*.json') {
    Copy-Item -LiteralPath $asset.FullName -Destination (Join-Path $app 'dict/strokes')
}
Copy-Item -LiteralPath (Join-Path $root 'licenses') -Destination $app -Recurse
$release = Join-Path $root 'release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$zip = Join-Path $release 'Chinese-Central-Windows-x64.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageZip = Join-Path $package 'package.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($app, $packageZip, [IO.Compression.CompressionLevel]::Optimal, $true)
Move-Item -LiteralPath $packageZip -Destination $zip -Force
Write-Host "Package: $zip"
