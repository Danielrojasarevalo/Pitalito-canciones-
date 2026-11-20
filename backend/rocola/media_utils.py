"""Lectura de metadatos de audio, portadas, color dominante y YouTube oEmbed."""
import io
import json
import re
import urllib.parse
import urllib.request

from django.core.files.base import ContentFile

try:
    import mutagen
    from mutagen.id3 import ID3
except ImportError:  # pragma: no cover
    mutagen = None

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


def read_audio_metadata(django_file):
    """Devuelve dict con title, artist, album, genre, duration y cover_bytes (si hay)."""
    data = {"title": "", "artist": "", "album": "", "genre": "", "duration": 0, "cover_bytes": None}
    if mutagen is None:
        return data
    try:
        django_file.seek(0)
        audio = mutagen.File(django_file, easy=True)
        if audio is not None:
            if getattr(audio, "info", None) and getattr(audio.info, "length", None):
                data["duration"] = int(round(audio.info.length))
            tags = audio.tags or {}
            for key in ("title", "artist", "album", "genre"):
                value = tags.get(key)
                if value:
                    data[key] = str(value[0])[:200]
        # Portada embebida (MP3/ID3)
        django_file.seek(0)
        try:
            id3 = ID3(django_file)
            for frame in id3.getall("APIC"):
                data["cover_bytes"] = frame.data
                break
        except Exception:
            pass
    except Exception:
        pass
    finally:
        django_file.seek(0)
    return data


def dominant_color(image_bytes, default="#7c3aed"):
    """Color promedio saturado de una imagen, para el brillo detrás del reproductor."""
    if Image is None or not image_bytes:
        return default
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((24, 24))
        pixels = list(img.getdata())
        # Prioriza los píxeles con más saturación (evita grises)
        def sat(p):
            return max(p) - min(p)

        pixels.sort(key=sat, reverse=True)
        top = pixels[: max(1, len(pixels) // 4)]
        r = sum(p[0] for p in top) // len(top)
        g = sum(p[1] for p in top) // len(top)
        b = sum(p[2] for p in top) // len(top)
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return default


def cover_file(image_bytes, name="cover.jpg"):
    return ContentFile(image_bytes, name=name)


YOUTUBE_ID_RE = re.compile(r"(?:v=|youtu\.be/|embed/|shorts/|live/)([A-Za-z0-9_-]{11})")


def parse_youtube_id(url_or_id: str):
    url_or_id = (url_or_id or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url_or_id):
        return url_or_id
    m = YOUTUBE_ID_RE.search(url_or_id)
    return m.group(1) if m else None


def youtube_oembed(video_id: str):
    """Título y canal del video usando oEmbed (gratis, no requiere API key)."""
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(
        f"https://www.youtube.com/watch?v={video_id}", safe=""
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "RocolaApp/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            info = json.loads(resp.read().decode("utf-8"))
        title = info.get("title", "")
        artist = info.get("author_name", "").replace(" - Topic", "").replace("VEVO", "").strip()
        if " - " in title:  # "Artista - Canción"
            artist, title = [p.strip() for p in title.split(" - ", 1)]
        return {"title": title[:200], "artist": artist[:200], "thumbnail": info.get("thumbnail_url", "")}
    except Exception:
        return None


def download_bytes(url, limit=2_000_000):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "RocolaApp/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.read(limit)
    except Exception:
        return None
