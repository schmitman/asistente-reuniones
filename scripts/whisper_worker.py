#!/usr/bin/env python3
"""Worker de faster-whisper para el asistente.

Lee una línea JSON por pedido en stdin: {"path": "/tmp/x.wav", "language": "es" | null}
Escribe una línea JSON por respuesta en stdout: {"text", "language", "words": [{text,start,end}]}
El modelo se carga una sola vez. Corre en CPU con int8.
"""
import argparse
import json
import os
import sys


def load_wav(path: str):
    """Lee WAV PCM16 mono 16 kHz sin pasar por PyAV/ffmpeg."""
    import wave

    import numpy as np

    with wave.open(path, "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1 or wav.getframerate() != 16000:
            raise ValueError("se espera WAV PCM16 mono 16 kHz")
        raw = wav.readframes(wav.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("STT_LOCAL_MODEL", "small"))
    parser.add_argument("--threads", type=int, default=int(os.environ.get("STT_LOCAL_THREADS", "4")))
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=args.threads)
    print(f"modelo {args.model} listo", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            segments, info = model.transcribe(
                load_wav(req["path"]),
                language=req.get("language") or None,
                beam_size=1,
                vad_filter=True,
                word_timestamps=True,
                condition_on_previous_text=False,
            )
            words = []
            texts = []
            for seg in segments:
                texts.append(seg.text.strip())
                for w in seg.words or []:
                    words.append({"text": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)})
            out = {"text": " ".join(t for t in texts if t), "language": info.language, "words": words}
        except Exception as exc:  # noqa: BLE001
            out = {"error": str(exc)}
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
