#!/usr/bin/env python3
"""
Vocab so'zlari uchun talaffuz audio fayllarini (mp3) generatsiya qiladi.

ISHLATISH:
  1) Internet bor kompyuterda ishga tushiring (bu sizning
     kompyuteringiz bo'lishi kerak — server sandbox emas).
  2) Kutubxonani o'rnating:
       pip install gTTS
  3) Bu faylni loyihaning "vocab/scripts/" papkasiga qo'yib, o'sha
     yerdan ishga tushiring:
       python3 generate_audio.py
  4) Skript "vocab/data/audio/en/<soz>.mp3" fayllarini yaratadi
     (data/*.json fayllardagi barcha "en" maydonlari uchun).
  5) Tayyor bo'lgach, butun "vocab" papkasini (audio papkasi bilan
     birga) hostingga qayta yuklang / deploy qiling.

Eslatma: gTTS ham Google'ning tarjima ovoz xizmatidan foydalanadi,
lekin BU YERDA muhim farq bor — audio fayllar faqat BIR MARTA,
sizning kompyuteringizda generatsiya qilinadi va keyin oddiy statik
mp3 fayl sifatida saqlanadi. Foydalanuvchi ilovani ochganda hech
qanday tashqi so'rov yubormaydi — shuning uchun Telegram WebView
ichida ham muammosiz ishlaydi.

Agar tabiiyroq / sifatliroq "AI" ovoz kerak bo'lsa (masalan
ElevenLabs, Google Cloud TTS WaveNet/Neural2, yoki Amazon Polly),
pastdagi `synthesize()` funksiyasini o'sha xizmatning API'siga
almashtirish kifoya — qolgan skript (fayllarni yig'ish, saqlash,
progress) o'zgarishsiz qoladi.
"""

import json
import glob
import os
import re
import sys
import time

try:
    from gtts import gTTS
except ImportError:
    print("Xato: gTTS o'rnatilmagan. Avval shuni bajaring:\n    pip install gTTS")
    sys.exit(1)

# Ushbu skript joylashgan joydan loyihaning ildiziga chiqamiz (vocab/)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
AUDIO_DIR = os.path.join(PROJECT_ROOT, "data", "audio", "en")


def slugify(word: str) -> str:
    """So'zni fayl nomiga xavfsiz shaklga o'tkazadi (masalan 'don't' -> 'dont')."""
    s = word.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s or "word"


def collect_words() -> set:
    words = set()
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            items = json.load(f)
        for item in items:
            en = item.get("en", "").strip()
            if en:
                words.add(en)
    return words


def synthesize(word: str, out_path: str):
    """Bitta so'z uchun mp3 fayl yaratadi. Boshqa TTS xizmatiga
    o'tish uchun shu funksiya ichini almashtiring."""
    tts = gTTS(text=word, lang="en", tld="com")
    tts.save(out_path)


def main():
    os.makedirs(AUDIO_DIR, exist_ok=True)
    words = sorted(collect_words())
    print(f"Jami {len(words)} ta noyob so'z topildi.")

    done, skipped, failed = 0, 0, 0
    for i, word in enumerate(words, 1):
        filename = slugify(word) + ".mp3"
        out_path = os.path.join(AUDIO_DIR, filename)

        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            skipped += 1
            continue

        try:
            synthesize(word, out_path)
            done += 1
            print(f"[{i}/{len(words)}] OK: {word} -> {filename}")
        except Exception as e:
            failed += 1
            print(f"[{i}/{len(words)}] XATO: {word}: {e}")

        # Google'ning tarjima xizmatini haddan tashqari tez-tez
        # so'rov bilan "bombardimon" qilmaslik uchun kichik pauza.
        time.sleep(0.3)

    print("\n--- Yakun ---")
    print(f"Yaratildi: {done}")
    print(f"O'tkazib yuborildi (allaqachon bor edi): {skipped}")
    print(f"Xato: {failed}")
    print(f"\nAudio fayllar shu yerda: {AUDIO_DIR}")
    print("Endi butun 'vocab' papkasini hostingga qayta yuklang.")


if __name__ == "__main__":
    main()
