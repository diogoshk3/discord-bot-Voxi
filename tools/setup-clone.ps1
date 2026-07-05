# tools/setup-clone.ps1 — instala o motor de clone de voz (Chatterbox, MIT) num venv.
# Descarrega ~5-7GB (PyTorch CUDA + modelo no 1.º arranque). Idempotente.
# O bot AUTO-DETETA tools\clone-venv\Scripts\python.exe — sem tocar no .env.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $PSScriptRoot "clone-venv"
$py = Join-Path $venv "Scripts\python.exe"

# 1) Python: o torch ainda nao suporta bem 3.14 — preferir 3.12/3.11/3.13 via py launcher.
$basePy = $null
foreach ($v in @("-3.12", "-3.11", "-3.13")) {
  try { & py $v --version *> $null; if ($LASTEXITCODE -eq 0) { $basePy = @("py", $v); break } } catch {}
}
if (-not $basePy) {
  Write-Host "AVISO: sem Python 3.11-3.13 no py launcher; a tentar 'python' (pode falhar com 3.14)."
  $basePy = @("python")
}
Write-Host "Python base: $($basePy -join ' ')"

# 2) venv
if (-not (Test-Path $py)) {
  Write-Host "A criar venv em $venv ..."
  & $basePy[0] $basePy[1..($basePy.Count-1)] -m venv $venv
}

# 3) deps (torch CUDA 12.4 para a RTX 4070 + chatterbox + pillow p/ og-image)
& $py -m pip install --upgrade pip
& $py -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
& $py -m pip install chatterbox-tts pillow

# 4) verificação
& $py -c "import torch; print('torch', torch.__version__, 'cuda:', torch.cuda.is_available())"
& $py -c "import chatterbox; print('chatterbox OK')"
Write-Host ""
Write-Host "=== SETUP OK ==="
Write-Host "O bot vai auto-detetar: $py tools\clone_server.py"
Write-Host "(1.º pedido descarrega o modelo ~2GB e demora 1-2 min; depois ~1-3s por frase)"
