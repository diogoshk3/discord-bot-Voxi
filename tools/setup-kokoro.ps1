# tools/setup-kokoro.ps1 — instala o sidecar TTS Kokoro (kokoro-onnx, ONNX/CPU) num venv.
# Descarrega ~340MB (modelo + vozes) + as deps ONNX. Idempotente. SEM PyTorch/GPU.
# O bot AUTO-DETETA tools\kokoro-venv\Scripts\python.exe + o modelo — sem tocar no .env.
$ErrorActionPreference = "Stop"
$venv = Join-Path $PSScriptRoot "kokoro-venv"
$py = Join-Path $venv "Scripts\python.exe"
$model = Join-Path $PSScriptRoot "kokoro-v1.0.onnx"
$voices = Join-Path $PSScriptRoot "voices-v1.0.bin"
$rel = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

# 1) Python: o onnxruntime ainda nao tem wheels p/ 3.14 — preferir 3.12/3.11/3.13 via py launcher.
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
  & $basePy[0] $basePy[1..($basePy.Count - 1)] -m venv $venv
}

# 3) deps (ONNX Runtime + kokoro-onnx + soundfile; o espeak-ng vem empacotado)
& $py -m pip install --upgrade pip
& $py -m pip install -r (Join-Path $PSScriptRoot "requirements-kokoro.txt")

# 4) modelo + vozes (idempotente — so descarrega se faltar)
if (-not (Test-Path $model)) {
  Write-Host "A descarregar kokoro-v1.0.onnx (~310MB) ..."
  Invoke-WebRequest -Uri "$rel/kokoro-v1.0.onnx" -OutFile $model
}
if (-not (Test-Path $voices)) {
  Write-Host "A descarregar voices-v1.0.bin (~27MB) ..."
  Invoke-WebRequest -Uri "$rel/voices-v1.0.bin" -OutFile $voices
}

# 5) verificacao
& $py -c "import onnxruntime, kokoro_onnx; print('kokoro-onnx OK')"
Write-Host ""
Write-Host "=== SETUP OK ==="
Write-Host "O bot vai auto-detetar: $py tools\kokoro_server.py"
Write-Host "(load do modelo ~1s; depois ~0.3-1s por frase, RTF ~0.25 em CPU)"
