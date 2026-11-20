"""
Lógica de la rocola: cola, playlist de fondo, reglas de pedidos y difusión en tiempo real.

Regla de oro: la música nunca se detiene. Cuando el reproductor termina una canción
llama a `advance()`: si hay pedidos de clientes suena el primero; si no, suena la
siguiente canción de la playlist de fondo.
"""
import random
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from .models import Business, QueueItem, QueueStatus, Song


class RequestRejected(Exception):
    """El pedido del cliente no cumple las reglas del negocio."""

    def __init__(self, message, code="rechazado"):
        super().__init__(message)
        self.message = message
        self.code = code


# --------------------------------------------------------------------------- #
# Serialización ligera del estado (se envía por WebSocket y por HTTP)
# --------------------------------------------------------------------------- #
def song_dict(song: Song):
    return {
        "id": song.id,
        "title": song.title,
        "artist": song.artist,
        "album": song.album,
        "genre": song.genre,
        "duration": song.duration,
        "explicit": song.explicit,
        "source": song.source,
        "audio_url": song.audio_file.url if song.audio_file else "",
        "youtube_id": song.youtube_id,
        "cover_url": song.cover.url if song.cover else "",
        "color": song.color,
    }


def item_dict(item: QueueItem, position=None):
    return {
        "id": item.id,
        "song": song_dict(item.song),
        "table": item.table,
        "dedication": item.dedication,
        "is_background": item.is_background,
        "requested_at": item.requested_at.isoformat(),
        "position": position,
    }


def upcoming_queryset(business: Business):
    return (
        QueueItem.objects.filter(business=business, status=QueueStatus.QUEUED)
        .select_related("song")
        .order_by("position", "requested_at")
    )


def build_state(business: Business):
    business.refresh_from_db()
    current = None
    if business.current_item_id:
        item = QueueItem.objects.select_related("song").filter(pk=business.current_item_id).first()
        if item:
            current = item_dict(item)
            current["started_at"] = business.current_started_at.isoformat() if business.current_started_at else None
    upcoming = [item_dict(it, i + 1) for i, it in enumerate(upcoming_queryset(business)[:50])]
    return {
        "current": current,
        "queue": upcoming,
        "is_paused": business.is_paused,
        "server_time": timezone.now().isoformat(),
    }


def broadcast(business: Business):
    """Envía el estado actual a todos los celulares y pantallas conectados."""

    def _send():
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            group_name(business.slug), {"type": "state.update", "state": build_state(business)}
        )

    transaction.on_commit(_send)


def group_name(slug):
    return f"rocola_{slug}"


# --------------------------------------------------------------------------- #
# Catálogo filtrado según las reglas del negocio
# --------------------------------------------------------------------------- #
def allowed_songs(business: Business):
    qs = Song.objects.filter(business=business, is_blocked=False)
    if business.block_explicit:
        qs = qs.filter(explicit=False)
    for artist in business.blocked_artist_list():
        qs = qs.exclude(artist__iexact=artist)
    return qs


def search_songs(business: Business, query: str = "", limit: int = 60):
    qs = allowed_songs(business)
    for word in (query or "").split():
        qs = qs.filter(
            Q(title__unaccent__icontains=word)
            | Q(artist__unaccent__icontains=word)
            | Q(album__unaccent__icontains=word)
            | Q(genre__unaccent__icontains=word)
        )
    return qs.order_by("title")[:limit]


# --------------------------------------------------------------------------- #
# Pedidos de clientes
# --------------------------------------------------------------------------- #
def next_position(business: Business):
    top = QueueItem.objects.filter(business=business, status=QueueStatus.QUEUED).aggregate(m=Max("position"))["m"]
    return (top or 0) + 1


@transaction.atomic
def request_song(business: Business, song_id, table="", client_id="", dedication="", by_owner=False):
    business = Business.objects.select_for_update().get(pk=business.pk)

    if not by_owner:
        if not business.subscription_ok:
            raise RequestRejected("Este negocio no tiene la rocola activa en este momento.", "inactivo")
        if not business.requests_enabled:
            raise RequestRejected("Los pedidos están pausados por el negocio.", "pausado")
        if not business.within_hours():
            raise RequestRejected("Fuera del horario de pedidos.", "horario")

    song = (Song.objects.filter(business=business) if by_owner else allowed_songs(business)).filter(pk=song_id).first()
    if not song:
        raise RequestRejected("Esa canción no está disponible.", "no_disponible")

    now = timezone.now()
    if not by_owner:
        # Misma canción ya en cola o sonando
        if QueueItem.objects.filter(
            business=business, song=song, status__in=[QueueStatus.QUEUED, QueueStatus.PLAYING]
        ).exists():
            raise RequestRejected("Esa canción ya está en la cola. ¡Elige otra!", "repetida")
        # Misma canción sonó hace poco
        if business.repeat_block_minutes and QueueItem.objects.filter(
            business=business,
            song=song,
            is_background=False,
            played_at__gte=now - timedelta(minutes=business.repeat_block_minutes),
        ).exists():
            raise RequestRejected(
                f"Esa canción sonó hace poco. Podrás pedirla de nuevo en un rato.", "reciente"
            )
        # Límite por mesa / por cliente en la ventana de tiempo
        window_start = now - timedelta(minutes=business.requests_window_minutes)
        recent = QueueItem.objects.filter(business=business, is_background=False, requested_at__gte=window_start)
        ident = Q(client_id=client_id) if client_id else Q(pk__in=[])
        if table:
            ident |= Q(table=table)
        if recent.filter(ident).count() >= business.max_requests_per_table:
            raise RequestRejected(
                f"Llegaste al límite de {business.max_requests_per_table} canciones cada "
                f"{business.requests_window_minutes} minutos. ¡Espera un momento!",
                "limite",
            )

    item = QueueItem.objects.create(
        business=business,
        song=song,
        table=str(table)[:20],
        client_id=str(client_id)[:64],
        dedication=(dedication or "")[:140] if business.allow_dedications else "",
        position=next_position(business),
    )
    place = upcoming_queryset(business).filter(
        Q(position__lt=item.position) | Q(position=item.position, requested_at__lte=item.requested_at)
    ).count()
    broadcast(business)
    return item, place


# --------------------------------------------------------------------------- #
# Avanzar la reproducción (fin de canción o "saltar")
# --------------------------------------------------------------------------- #
def _pick_background_song(business: Business):
    exclude_recent = list(
        QueueItem.objects.filter(business=business, played_at__isnull=False)
        .order_by("-played_at")
        .values_list("song_id", flat=True)[:3]
    )
    queued_ids = list(upcoming_queryset(business).values_list("song_id", flat=True))
    allowed = allowed_songs(business)

    playlist = business.background_playlist
    if playlist:
        songs = [pi.song for pi in playlist.items.select_related("song") if allowed.filter(pk=pi.song_id).exists()]
        if songs:
            if playlist.shuffle:
                pool = [s for s in songs if s.id not in exclude_recent and s.id not in queued_ids] or songs
                return random.choice(pool)
            idx = business.background_cursor % len(songs)
            business.background_cursor = idx + 1
            return songs[idx]

    # Sin playlist configurada: cualquier canción permitida del catálogo
    pool = list(allowed.exclude(pk__in=exclude_recent + queued_ids)[:200]) or list(allowed[:200])
    return random.choice(pool) if pool else None


@transaction.atomic
def advance(business: Business, ended_item_id=None, skipped=False):
    """
    Pasa a la siguiente canción. `ended_item_id` evita saltos dobles cuando hay
    varias pantallas: solo se avanza si la canción que terminó sigue siendo la actual.
    """
    business = Business.objects.select_for_update().get(pk=business.pk)
    if ended_item_id is not None and business.current_item_id and int(ended_item_id) != business.current_item_id:
        return business  # otra pantalla ya avanzó

    now = timezone.now()
    if business.current_item_id:
        QueueItem.objects.filter(pk=business.current_item_id, status=QueueStatus.PLAYING).update(
            status=QueueStatus.SKIPPED if skipped else QueueStatus.PLAYED, played_at=now
        )

    nxt = upcoming_queryset(business).first()
    if nxt is None:
        song = _pick_background_song(business)
        if song is not None:
            nxt = QueueItem.objects.create(business=business, song=song, is_background=True, position=0)

    if nxt is not None:
        nxt.status = QueueStatus.PLAYING
        nxt.played_at = now
        nxt.save(update_fields=["status", "played_at"])
    business.current_item = nxt
    business.current_started_at = now if nxt else None
    business.is_paused = False
    business.save(update_fields=["current_item", "current_started_at", "is_paused", "background_cursor"])
    broadcast(business)
    return business


@transaction.atomic
def reorder(business: Business, ids):
    items = {it.id: it for it in upcoming_queryset(business).filter(pk__in=ids)}
    for i, item_id in enumerate(ids):
        item = items.get(int(item_id))
        if item:
            item.position = i + 1
            item.save(update_fields=["position"])
    broadcast(business)


@transaction.atomic
def remove_item(business: Business, item_id):
    updated = QueueItem.objects.filter(business=business, pk=item_id, status=QueueStatus.QUEUED).update(
        status=QueueStatus.REMOVED
    )
    broadcast(business)
    return updated
