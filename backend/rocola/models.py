import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


def _token():
    return secrets.token_urlsafe(24)


class Plan(models.TextChoices):
    BASICO = "basico", "Básico"
    PREMIUM = "premium", "Premium"


class Business(models.Model):
    """Un negocio suscrito (bar, restaurante, café...)."""

    name = models.CharField("nombre", max_length=120)
    slug = models.SlugField(unique=True, max_length=80)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="businesses")
    city = models.CharField(max_length=80, default="Pitalito")
    phone = models.CharField(max_length=40, blank=True)
    accent_color = models.CharField(max_length=9, default="#a855f7")

    # Suscripción
    plan = models.CharField(max_length=20, choices=Plan.choices, default=Plan.BASICO)
    monthly_price = models.PositiveIntegerField(default=60000, help_text="Pesos colombianos")
    is_active = models.BooleanField(default=True)
    approval = models.CharField(
        "aprobación", max_length=10, default="approved",
        choices=[("pending", "Pendiente"), ("approved", "Aprobado"), ("rejected", "Rechazado")],
    )
    subscription_until = models.DateField(null=True, blank=True)

    # Reproductor
    player_token = models.CharField(max_length=64, default=_token, unique=True)
    background_playlist = models.ForeignKey(
        "Playlist", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    tables_count = models.PositiveIntegerField("número de mesas", default=10)

    # Reglas
    max_requests_per_table = models.PositiveIntegerField(default=3)
    requests_window_minutes = models.PositiveIntegerField(default=30)
    repeat_block_minutes = models.PositiveIntegerField(
        default=60, help_text="No se puede volver a pedir la misma canción hasta pasados estos minutos"
    )
    block_explicit = models.BooleanField(default=False)
    blocked_artists = models.TextField(blank=True, help_text="Un artista por línea")
    requests_enabled = models.BooleanField(default=True)
    hours_start = models.TimeField(null=True, blank=True)
    hours_end = models.TimeField(null=True, blank=True)
    allow_dedications = models.BooleanField(default=True)

    # Estado del reproductor
    current_item = models.ForeignKey(
        "QueueItem", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    current_started_at = models.DateTimeField(null=True, blank=True)
    is_paused = models.BooleanField(default=False)
    background_cursor = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "negocio"
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:70] or "negocio"
            slug, n = base, 2
            while Business.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        if self.subscription_until is None:
            self.subscription_until = timezone.localdate() + timedelta(days=30)
        super().save(*args, **kwargs)

    @property
    def subscription_ok(self):
        return self.is_active and self.approval == "approved" and (
            self.subscription_until is None or self.subscription_until >= timezone.localdate()
        )

    def blocked_artist_list(self):
        return [a.strip().lower() for a in self.blocked_artists.splitlines() if a.strip()]

    def within_hours(self):
        if not self.hours_start or not self.hours_end:
            return True
        now = timezone.localtime().time()
        if self.hours_start <= self.hours_end:
            return self.hours_start <= now <= self.hours_end
        return now >= self.hours_start or now <= self.hours_end  # horario que cruza medianoche


class Source(models.TextChoices):
    LOCAL = "local", "Archivo de audio"
    YOUTUBE = "youtube", "YouTube"


class Song(models.Model):
    """Canción del catálogo de un negocio."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="songs")
    title = models.CharField("título", max_length=200)
    artist = models.CharField("artista", max_length=200, blank=True)
    album = models.CharField(max_length=200, blank=True)
    genre = models.CharField("género", max_length=80, blank=True)
    duration = models.PositiveIntegerField("duración (s)", default=0)
    explicit = models.BooleanField("contenido explícito", default=False)
    is_blocked = models.BooleanField("bloqueada", default=False)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.LOCAL)
    audio_file = models.FileField(upload_to="audio/%Y/%m/", blank=True)
    youtube_id = models.CharField(max_length=20, blank=True)
    cover = models.ImageField(upload_to="covers/", blank=True)
    color = models.CharField(max_length=9, default="#7c3aed", help_text="Color dominante para el brillo")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "canción"
        verbose_name_plural = "canciones"
        ordering = ["artist", "title"]
        indexes = [models.Index(fields=["business", "title"]), models.Index(fields=["business", "artist"])]

    def __str__(self):
        return f"{self.title} — {self.artist}"


class Playlist(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="playlists")
    name = models.CharField(max_length=120)
    shuffle = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class PlaylistItem(models.Model):
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE, related_name="items")
    song = models.ForeignKey(Song, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        unique_together = [("playlist", "song")]


class QueueStatus(models.TextChoices):
    QUEUED = "queued", "En cola"
    PLAYING = "playing", "Sonando"
    PLAYED = "played", "Reproducida"
    SKIPPED = "skipped", "Saltada"
    REMOVED = "removed", "Eliminada"


class QueueItem(models.Model):
    """Una canción en la cola (pedida por un cliente o de la playlist de fondo)."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="queue")
    song = models.ForeignKey(Song, on_delete=models.CASCADE, related_name="queue_items")
    status = models.CharField(max_length=10, choices=QueueStatus.choices, default=QueueStatus.QUEUED)
    position = models.FloatField(default=0, db_index=True)
    is_background = models.BooleanField(default=False)
    table = models.CharField("mesa", max_length=20, blank=True)
    client_id = models.CharField(max_length=64, blank=True)
    dedication = models.CharField("dedicatoria", max_length=140, blank=True)
    requested_at = models.DateTimeField(default=timezone.now)
    played_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["position", "requested_at"]
        indexes = [models.Index(fields=["business", "status", "position"])]

    def __str__(self):
        return f"{self.song} ({self.get_status_display()})"


class Payment(models.Model):
    """Pago mensual de la suscripción (registro manual o desde la pasarela)."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="payments")
    amount = models.PositiveIntegerField()
    months = models.PositiveIntegerField(default=1)
    method = models.CharField(max_length=40, default="efectivo")
    reference = models.CharField(max_length=120, blank=True)
    paid_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-paid_at"]
