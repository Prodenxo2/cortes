#Requires -Version 5.1
<#
.SYNOPSIS
  Valida as dependencias do projeto cortes no Windows.

.DESCRIPTION
  Verifica node (>= 20.9), npm, yt-dlp, ffmpeg e ffprobe no PATH (ou nos caminhos do .env),
  se o ffmpeg tem libass / libx264 / libmp3lame, se o yt-dlp esta atualizado,
  e se o .env tem GEMINI_API_KEY e DATABASE_URL.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\check-deps.ps1
  npm run check:deps
#>

$ErrorActionPreference = 'Continue'
$script:failures = 0
$script:warnings = 0

function Write-Ok([string]$msg)   { Write-Host "  [ OK ]  $msg" -ForegroundColor Green }
function Write-Bad([string]$msg)  { Write-Host "  [FALHA] $msg" -ForegroundColor Red; $script:failures++ }
function Write-Warn([string]$msg) { Write-Host "  [AVISO] $msg" -ForegroundColor Yellow; $script:warnings++ }
function Write-Hint([string]$msg) { Write-Host "          $msg" -ForegroundColor DarkGray }

# ---------------------------------------------------------------- .env (opcional)
$envFile = Join-Path $PSScriptRoot '.env'
$dotenv = @{}
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $val = $Matches[2].Trim()
      if ($val.Length -ge 2 -and (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))) {
        $val = $val.Substring(1, $val.Length - 2)
      }
      $dotenv[$Matches[1]] = $val
    }
  }
}

function Resolve-Tool([string]$name, [string]$envKey) {
  $candidate = $name
  if ($envKey -and $dotenv.ContainsKey($envKey) -and $dotenv[$envKey]) { $candidate = $dotenv[$envKey] }
  $cmd = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-FirstLine([string]$exe, [string[]]$arguments) {
  try {
    $out = & $exe @arguments 2>&1 | Select-Object -First 1
    return ("$out").Trim()
  } catch {
    return ''
  }
}

Write-Host ''
Write-Host '== cortes: verificando dependencias ==' -ForegroundColor Cyan
Write-Host ''

# ---------------------------------------------------------------- Node.js
$node = Resolve-Tool 'node' $null
if (-not $node) {
  Write-Bad 'node nao encontrado no PATH.'
  Write-Hint 'Instale: winget install OpenJS.NodeJS.LTS'
} else {
  $ver = Get-FirstLine $node @('-v')
  $ok = $false
  if ($ver -match '^v(\d+)\.(\d+)') {
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]
    $ok = ($major -gt 20) -or ($major -eq 20 -and $minor -ge 9)
  }
  if ($ok) { Write-Ok "node $ver  ($node)" }
  else {
    Write-Bad "node $ver e antigo demais (Next.js 16 pede >= 20.9)."
    Write-Hint 'Atualize: winget upgrade OpenJS.NodeJS.LTS'
  }
}

$npm = Resolve-Tool 'npm' $null
if ($npm) { Write-Ok ("npm " + (Get-FirstLine $npm @('-v'))) }
else { Write-Bad 'npm nao encontrado (vem junto com o Node.js).' }

# ---------------------------------------------------------------- yt-dlp
$ytdlp = Resolve-Tool 'yt-dlp' 'YTDLP_PATH'
if (-not $ytdlp) {
  Write-Bad 'yt-dlp nao encontrado no PATH.'
  Write-Hint 'Instale: winget install yt-dlp.yt-dlp   (ou defina YTDLP_PATH no .env)'
} else {
  $ver = Get-FirstLine $ytdlp @('--version')
  Write-Ok "yt-dlp $ver  ($ytdlp)"
  if ($ver -match '^(\d{4})\.(\d{2})\.(\d{2})') {
    $released = Get-Date -Year ([int]$Matches[1]) -Month ([int]$Matches[2]) -Day ([int]$Matches[3])
    $age = ((Get-Date) - $released).Days
    if ($age -gt 60) {
      Write-Warn "yt-dlp tem $age dias. O YouTube muda direto e versoes velhas quebram o download."
      Write-Hint 'Atualize: yt-dlp -U   (ou winget upgrade yt-dlp.yt-dlp)'
    }
  }
}

# ---------------------------------------------------------------- ffmpeg / ffprobe
$ffmpeg = Resolve-Tool 'ffmpeg' 'FFMPEG_PATH'
if (-not $ffmpeg) {
  Write-Bad 'ffmpeg nao encontrado no PATH.'
  Write-Hint 'Instale: winget install Gyan.FFmpeg   (e reabra o terminal)'
} else {
  $ver = Get-FirstLine $ffmpeg @('-hide_banner', '-version')
  Write-Ok "$ver"
  Write-Hint "($ffmpeg)"

  $filters  = (& $ffmpeg -hide_banner -filters 2>$null) -join "`n"
  $encoders = (& $ffmpeg -hide_banner -encoders 2>$null) -join "`n"

  if ($filters -match '\sass\s')          { Write-Ok 'ffmpeg com libass (legendas .ass)' }
  else { Write-Bad 'ffmpeg SEM libass: nao consegue queimar legendas. Use o build "full" do Gyan.FFmpeg.' }

  if ($encoders -match 'libx264')         { Write-Ok 'ffmpeg com libx264 (H.264)' }
  else { Write-Bad 'ffmpeg SEM libx264. Use o build "full" do Gyan.FFmpeg.' }

  if ($encoders -match 'libmp3lame')      { Write-Ok 'ffmpeg com libmp3lame (audio para o Gemini)' }
  else { Write-Bad 'ffmpeg SEM libmp3lame.' }
}

$ffprobe = Resolve-Tool 'ffprobe' 'FFPROBE_PATH'
if ($ffprobe) { Write-Ok "ffprobe  ($ffprobe)" }
else {
  Write-Bad 'ffprobe nao encontrado (vem junto com o ffmpeg).'
  Write-Hint 'Instale: winget install Gyan.FFmpeg'
}

# ---------------------------------------------------------------- Fonte das legendas
$font = 'Arial Black'
if ($dotenv.ContainsKey('CAPTION_FONT') -and $dotenv['CAPTION_FONT']) { $font = $dotenv['CAPTION_FONT'] }
$fontKeys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts',
  'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
)
$fontFound = $false
foreach ($k in $fontKeys) {
  if (Test-Path $k) {
    $props = (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -like "$font*" }
    if ($props) { $fontFound = $true }
  }
}
if ($fontFound) { Write-Ok "fonte das legendas '$font' instalada" }
else { Write-Warn "fonte '$font' nao encontrada; o libass vai usar uma fonte substituta. Ajuste CAPTION_FONT no .env." }

# ---------------------------------------------------------------- .env
Write-Host ''
if (-not (Test-Path $envFile)) {
  Write-Warn '.env nao existe. Rode: copy .env.example .env   e preencha as chaves.'
} else {
  if ($dotenv['GEMINI_API_KEY']) { Write-Ok 'GEMINI_API_KEY definida' }
  else { Write-Bad 'GEMINI_API_KEY vazia no .env (pegue em https://aistudio.google.com/apikey)' }

  if ($dotenv['DATABASE_URL']) { Write-Ok 'DATABASE_URL definida' }
  else { Write-Warn 'DATABASE_URL vazia: o test:pipeline roda sem banco, mas o worker e o dashboard precisam.' }

  $model = 'gemini-3.5-flash'
  if ($dotenv['GEMINI_MODEL']) { $model = $dotenv['GEMINI_MODEL'] }
  Write-Hint "modelo Gemini: $model"
}

# ---------------------------------------------------------------- Resultado
Write-Host ''
if ($script:failures -gt 0) {
  Write-Host "== $($script:failures) problema(s) encontrado(s). Corrija e rode de novo. ==" -ForegroundColor Red
  exit 1
}
if ($script:warnings -gt 0) {
  Write-Host "== Tudo certo, com $($script:warnings) aviso(s). ==" -ForegroundColor Yellow
} else {
  Write-Host '== Tudo certo! ==' -ForegroundColor Green
}
exit 0
