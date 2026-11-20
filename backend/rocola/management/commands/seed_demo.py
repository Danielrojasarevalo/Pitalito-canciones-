"""
Crea datos de demostración:
  - dueño de negocio               bar / bar1299
  - negocio "Bar La Rocola" con 8 pistas sintetizadas (libres de derechos) y su playlist de fondo.

Uso: python manage.py seed_demo
"""
import io
import math
import random
import struct
import wave

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image, ImageDraw, ImageFilter

from rocola.models import Business, Playlist, PlaylistItem, Song

RATE = 22050
NOTE = {n: 440 * 2 ** ((i - 9) / 12) for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}

TRACKS = [
    ("Atardecer en Pitalito", "Demo Huila", "Tropical", ["C", "G", "A", "F"], 112, ("#f97316", "#a855f7")),
    ("Neón de Medianoche", "Los Sintéticos", "Electrónica", ["A", "F", "C", "G"], 124, ("#ec4899", "#6d28d9")),
    ("Café de la Plaza", "Trío Opita", "Acústico", ["D", "A", "B", "G"], 96, ("#d97706", "#7c2d12")),
    ("Brisa del Magdalena", "Río Sonoro", "Chill", ["E", "C#", "A", "B"], 88, ("#06b6d4", "#1e3a8a")),
    ("Fiesta en la Terraza", "Combo Demo", "Cumbia", ["G", "D", "E", "C"], 132, ("#22c55e", "#0f766e")),
    ("Luces de la Ciudad", "Nocturno", "Pop", ["F", "C", "D", "A#"], 118, ("#eab308", "#be185d")),
    ("Sabor a Café", "La Orquesta Demo", "Salsa", ["A", "D", "E", "A"], 140, ("#ef4444", "#7f1d1d")),
    ("Montañas del Sur", "Eco Andino", "Folk", ["C", "F", "G", "C"], 100, ("#8b5cf6", "#064e3b")),
]


def chord(root, minor=False):
    names = list(NOTE)
    i = names.index(root)
    third = 3 if minor else 4
    return [NOTE[names[i]], NOTE[names[(i + third) % 12]] * (2 if (i + third) >= 12 else 1),
            NOTE[names[(i + 7) % 12]] * (2 if (i + 7) >= 12 else 1)]


def synth_track(progression, bpm, seconds=42, seed=0):
    rnd = random.Random(seed)
    beat = 60 / bpm
    bar = beat * 4
    total = int(seconds * RATE)
    samples = [0.0] * total
    minors = [rnd.random() < 0.35 for _ in progression]
    pattern = [rnd.choice([0, 1, 2, 1]) for _ in range(8)]

    def add_tone(start, dur, freq, vol, kind="sine"):
        s0 = int(start * RATE)
        n = int(dur * RATE)
        for k in range(n):
            idx = s0 + k
            if idx >= total:
                break
            t = k / RATE
            env = min(1.0, t * 60) * math.exp(-3.2 * t / dur)
            ph = 2 * math.pi * freq * t
            if kind == "sine":
                v = math.sin(ph) + 0.25 * math.sin(2 * ph)
            else:  # bajo suave
                v = math.sin(ph) + 0.4 * math.sin(ph * 0.5)
            samples[idx] += v * vol * env

    t = 0.0
    bar_i = 0
    while t < seconds:
        root = progression[bar_i % len(progression)]
        notes = chord(root, minors[bar_i % len(progression)])
        # bajo
        for b in range(4):
            add_tone(t + b * beat, beat * 0.9, notes[0] / 4, 0.32, "bass")
        # arpegio en corcheas
        for s in range(8):
            f = notes[pattern[s] % 3] * (2 if s % 4 == 3 else 1)
            add_tone(t + s * beat / 2, beat * 0.8, f, 0.13)
        # bombo
        for b in range(4):
            s0 = int((t + b * beat) * RATE)
            for k in range(int(0.12 * RATE)):
                idx = s0 + k
                if idx >= total:
                    break
                tt = k / RATE
                samples[idx] += math.sin(2 * math.pi * (110 - 400 * tt) * tt) * 0.5 * math.exp(-28 * tt)
        t += bar
        bar_i += 1

    # fade in/out y normalización
    fade = int(1.5 * RATE)
    for k in range(fade):
        samples[k] *= k / fade
        samples[-k - 1] *= k / fade
    peak = max(abs(s) for s in samples) or 1
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(s / peak * 0.85 * 32767)) for s in samples))
    return buf.getvalue()


def make_cover(c1, c2, seed):
    rnd = random.Random(seed)
    size = 400
    img = Image.new("RGB", (size, size), c1)
    top = Image.new("RGB", (size, size), c2)
    mask = Image.linear_gradient("L").rotate(rnd.choice([0, 45, 90, 135])).resize((size, size))
    img = Image.composite(top, img, mask)
    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(6):
        r = rnd.randint(40, 160)
        x, y = rnd.randint(0, size), rnd.randint(0, size)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rnd.randint(18, 45)))
    img = img.filter(ImageFilter.GaussianBlur(6))
    draw = ImageDraw.Draw(img, "RGBA")
    cx = cy = size // 2
    for r in range(150, 40, -14):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 40), width=2)
    draw.ellipse([cx - 28, cy - 28, cx + 28, cy + 28], fill=(255, 255, 255, 200))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88)
    return out.getvalue()


class Command(BaseCommand):
    help = "Crea usuarios, negocio y canciones de demostración"

    def handle(self, *args, **opts):
        User = get_user_model()
        owner = User.objects.filter(username="bar").first()
        if not owner:
            owner = User.objects.create_user("bar", password="bar1299")
            self.stdout.write("Dueño: bar / bar1299")

        biz, created = Business.objects.get_or_create(
            slug="bar-la-rocola", defaults={"name": "Bar La Rocola", "owner": owner, "tables_count": 12}
        )
        if not created and biz.songs.exists():
            self.stdout.write(self.style.WARNING("El negocio demo ya tiene canciones; no se duplicaron."))
            return

        playlist = Playlist.objects.create(business=biz, name="Fondo del bar", shuffle=True)
        for i, (title, artist, genre, prog, bpm, colors) in enumerate(TRACKS):
            self.stdout.write(f"  Sintetizando «{title}»…")
            audio = synth_track(prog, bpm, seed=i)
            song = Song(business=biz, title=title, artist=artist, genre=genre, album="Rocola Demo",
                        duration=42, color=colors[0])
            song.audio_file.save(f"demo_{i + 1}.wav", ContentFile(audio), save=False)
            song.cover.save(f"demo_{i + 1}.jpg", ContentFile(make_cover(colors[0], colors[1], i)), save=False)
            song.save()
            PlaylistItem.objects.create(playlist=playlist, song=song, order=i)
        biz.background_playlist = playlist
        biz.save()
        self.stdout.write(self.style.SUCCESS(f"Listo. Negocio: {biz.name} (slug: {biz.slug})"))
        self.stdout.write(f"Token del reproductor: {biz.player_token}")
