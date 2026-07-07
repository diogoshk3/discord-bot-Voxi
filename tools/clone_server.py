#!/usr/bin/env python
"""
tools/clone_server.py — sidecar de CLONE DE VOZ do Vozen (Chatterbox, MIT).

Protocolo JSON-lines em stdin/stdout (1 pedido de cada vez — GPU):
  -> {"text": "...", "ref": "C:/.../user.wav", "out": "C:/.../out.wav", "lang": "pt"}
  <- {"ok": true, "out": "C:/.../out.wav"}
  <- {"ok": false, "error": "..."}
Linha especial de warmup (carrega o modelo e responde ready):
  -> {"warmup": true}         <- {"ok": true, "ready": true, "model": "multilingual|en"}

Notas:
- Tenta o modelo MULTILINGUAL (23 línguas, incl. pt) e cai no inglês se indisponível.
- O Chatterbox embute watermark (PerTh) no áudio gerado — fica LIGADO de propósito
  (uso responsável de vozes clonadas).
- stderr é só para logs; stdout é EXCLUSIVO do protocolo.
"""
import json
import sys
import traceback


def log(msg: str) -> None:
    print(f"[clone] {msg}", file=sys.stderr, flush=True)


def load_model():
    import torch  # noqa: F401 — falha cedo e claro se o torch não estiver ok

    device = "cuda" if __import__("torch").cuda.is_available() else "cpu"
    log(f"device={device}")
    try:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        log("modelo: multilingual")
        return model, "multilingual"
    except Exception as e:  # noqa: BLE001 — fallback deliberado
        log(f"multilingual indisponível ({e}); a cair no modelo EN")
        from chatterbox.tts import ChatterboxTTS

        model = ChatterboxTTS.from_pretrained(device=device)
        log("modelo: en")
        return model, "en"


def main() -> None:
    model = None
    kind = ""
    import torchaudio

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"json: {e}"}), flush=True)
            continue
        try:
            if model is None:
                model, kind = load_model()
            if req.get("warmup"):
                print(json.dumps({"ok": True, "ready": True, "model": kind}), flush=True)
                continue
            text = req["text"]
            ref = req["ref"]
            out = req["out"]
            lang = (req.get("lang") or "en").lower()
            if kind == "multilingual":
                try:
                    wav = model.generate(text, language_id=lang, audio_prompt_path=ref)
                except Exception:  # língua não suportada -> inglês
                    wav = model.generate(text, language_id="en", audio_prompt_path=ref)
            else:
                wav = model.generate(text, audio_prompt_path=ref)
            torchaudio.save(out, wav, model.sr)
            print(json.dumps({"ok": True, "out": out}), flush=True)
        except Exception as e:  # noqa: BLE001 — o processo NUNCA deve morrer por 1 pedido
            log(traceback.format_exc())
            print(json.dumps({"ok": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
