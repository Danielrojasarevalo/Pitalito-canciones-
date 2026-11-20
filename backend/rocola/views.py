from datetime import timedelta

from django.contrib.auth import authenticate
from django.db.models import Count, Q
from django.db.models.functions import ExtractHour, TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services
from .media_utils import (
    cover_file, dominant_color, download_bytes, parse_youtube_id, read_audio_metadata, youtube_oembed,
)
from .models import Business, Payment, Playlist, PlaylistItem, QueueItem, QueueStatus, Song, Source
from .serializers import (
    BusinessOwnerSerializer, PaymentSerializer, PlatformBusinessSerializer, PlaylistSerializer,
    PublicSongSerializer, QueueItemSerializer, SongSerializer,
)


# --------------------------------------------------------------------------- #
# Autenticación
# --------------------------------------------------------------------------- #
def user_payload(user):
    businesses = Business.objects.all() if user.is_superuser else user.businesses.all()
    return {
        "id": user.id,
        "username": user.username,
        "is_superuser": user.is_superuser,
        "businesses": [{"id": b.id, "name": b.name, "slug": b.slug} for b in businesses],
    }


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def login(request):
    from django.contrib.auth import get_user_model

    ident = (request.data.get("username") or "").strip()
    if "@" in ident:  # también se puede entrar con el correo
        u = get_user_model().objects.filter(email__iexact=ident).first()
        if u:
            ident = u.username
    user = authenticate(username=ident, password=request.data.get("password", ""))
    if not user:
        return Response({"detail": "Usuario o contraseña incorrectos."}, status=400)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": user_payload(user)})


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def register(request):
    """Un negocio crea su cuenta; queda pendiente hasta que el administrador lo apruebe."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    d = request.data
    name = (d.get("business_name") or "").strip()
    username = (d.get("username") or "").strip()
    email = (d.get("email") or "").strip()
    password = d.get("password") or ""
    errors = {}
    if len(name) < 3:
        errors["business_name"] = ["Escribe el nombre del negocio."]
    if len(username) < 3:
        errors["username"] = ["El usuario debe tener al menos 3 caracteres."]
    elif User.objects.filter(username__iexact=username).exists():
        errors["username"] = ["Ese usuario ya existe."]
    if email and User.objects.filter(email__iexact=email).exists():
        errors["email"] = ["Ese correo ya está registrado."]
    if len(password) < 4:
        errors["password"] = ["La contraseña debe tener al menos 4 caracteres."]
    if errors:
        return Response(errors, status=400)
    user = User.objects.create_user(username=username, email=email, password=password)
    Business.objects.create(
        owner=user, name=name, city=(d.get("city") or "Pitalito")[:80], phone=(d.get("phone") or "")[:40],
        approval="pending",
    )
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": user_payload(user)}, status=201)


@api_view(["POST"])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response({"ok": True})


@api_view(["GET"])
def me(request):
    return Response(user_payload(request.user))


# --------------------------------------------------------------------------- #
# Público: página del cliente (QR)
# --------------------------------------------------------------------------- #
def public_business_info(b: Business):
    open_now = b.subscription_ok and b.requests_enabled and b.within_hours()
    message = ""
    if b.approval != "approved":
        message = "Este negocio aún está esperando aprobación."
    elif not b.subscription_ok:
        message = "La rocola de este negocio no está activa."
    elif not b.requests_enabled:
        message = "Los pedidos están pausados por el negocio."
    elif not b.within_hours():
        message = f"Pedidos disponibles de {b.hours_start:%I:%M %p} a {b.hours_end:%I:%M %p}."
    return {
        "name": b.name,
        "slug": b.slug,
        "city": b.city,
        "accent_color": b.accent_color,
        "tables_count": b.tables_count,
        "allow_dedications": b.allow_dedications,
        "max_requests_per_table": b.max_requests_per_table,
        "requests_window_minutes": b.requests_window_minutes,
        "open": open_now,
        "message": message,
    }


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def server_info(request):
    """IP del computador en la red local (para armar QR cuando el panel se abre con localhost)."""
    import socket

    ip = ""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("10.255.255.255", 1))  # no envía datos; solo elige la interfaz de red
        ip = sock.getsockname()[0]
        sock.close()
    except OSError:
        pass
    return Response({"lan_ip": ip})


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def public_business(request, slug):
    b = get_object_or_404(Business, slug=slug)
    return Response({"business": public_business_info(b), "state": services.build_state(b)})


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def public_songs(request, slug):
    b = get_object_or_404(Business, slug=slug)
    songs = services.search_songs(b, request.query_params.get("q", ""))
    return Response(PublicSongSerializer(songs, many=True).data)


class PedidoThrottle(ScopedRateThrottle):
    scope_attr = "throttle_scope"


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
@throttle_classes([PedidoThrottle])
def public_request(request, slug):
    b = get_object_or_404(Business, slug=slug)
    try:
        item, place = services.request_song(
            b,
            request.data.get("song"),
            table=request.data.get("table", ""),
            client_id=request.data.get("client_id", ""),
            dedication=request.data.get("dedication", ""),
        )
    except services.RequestRejected as e:
        return Response({"detail": e.message, "code": e.code}, status=409)
    return Response({"id": item.id, "place": place, "song": services.song_dict(item.song)}, status=201)


public_request.cls.throttle_scope = "pedidos"


# --------------------------------------------------------------------------- #
# Reproductor (pantalla del negocio, se autentica con player_token)
# --------------------------------------------------------------------------- #
def player_business(request, slug):
    token = request.query_params.get("token") or request.data.get("token") or request.headers.get("X-Player-Token")
    b = get_object_or_404(Business, slug=slug)
    if not token or token != b.player_token:
        raise PermissionDenied("Enlace del reproductor inválido. Cópialo de nuevo desde el panel.")
    return b


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def player_state(request, slug):
    b = player_business(request, slug)
    return Response({"business": public_business_info(b), "state": services.build_state(b), "subscription_ok": b.subscription_ok})


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def player_next(request, slug):
    b = player_business(request, slug)
    if not b.subscription_ok:
        return Response({"detail": "Suscripción vencida o negocio suspendido."}, status=402)
    services.advance(b, ended_item_id=request.data.get("ended_item_id"), skipped=bool(request.data.get("skipped")))
    return Response({"state": services.build_state(b)})


# --------------------------------------------------------------------------- #
# Panel del dueño
# --------------------------------------------------------------------------- #
def owner_business(request) -> Business:
    """Negocio del usuario. El superusuario puede elegir con el encabezado X-Business."""
    user = request.user
    qs = Business.objects.all() if user.is_superuser else user.businesses.all()
    bid = request.headers.get("X-Business")
    b = qs.filter(pk=bid).first() if bid and str(bid).isdigit() else qs.first()
    if not b:
        raise NotFound("No tienes un negocio asignado.")
    return b


class OwnerBusinessView(APIView):
    def get(self, request):
        return Response(BusinessOwnerSerializer(owner_business(request)).data)

    def patch(self, request):
        b = owner_business(request)
        ser = BusinessOwnerSerializer(b, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        if "background_playlist" in ser.validated_data:
            pl = ser.validated_data["background_playlist"]
            if pl and pl.business_id != b.id:
                raise PermissionDenied("Playlist ajena.")
        ser.save()
        services.broadcast(b)
        return Response(ser.data)


@api_view(["POST"])
def regenerate_player_token(request):
    import secrets

    b = owner_business(request)
    b.player_token = secrets.token_urlsafe(24)
    b.save(update_fields=["player_token"])
    return Response({"player_token": b.player_token})


class SongViewSet(viewsets.ModelViewSet):
    serializer_class = SongSerializer

    def get_queryset(self):
        b = owner_business(self.request)
        qs = Song.objects.filter(business=b).annotate(
            times_requested=Count("queue_items", filter=Q(queue_items__is_background=False))
        )
        q = self.request.query_params.get("q", "")
        for word in q.split():
            qs = qs.filter(
                Q(title__unaccent__icontains=word) | Q(artist__unaccent__icontains=word) | Q(album__unaccent__icontains=word)
            )
        return qs.order_by("-created_at")

    def perform_create(self, serializer):
        b = owner_business(self.request)
        upload = self.request.FILES.get("audio_file")
        extra = {"business": b}
        if upload:
            meta = read_audio_metadata(upload)
            data = serializer.validated_data
            extra["title"] = data.get("title") or meta["title"] or upload.name.rsplit(".", 1)[0]
            extra["artist"] = data.get("artist") or meta["artist"]
            extra["album"] = data.get("album") or meta["album"]
            extra["genre"] = data.get("genre") or meta["genre"]
            extra["duration"] = data.get("duration") or meta["duration"]
            extra["source"] = Source.LOCAL
            if meta["cover_bytes"] and not data.get("cover"):
                extra["cover"] = cover_file(meta["cover_bytes"])
                extra["color"] = dominant_color(meta["cover_bytes"])
        song = serializer.save(**extra)
        if song.cover and "color" not in extra:
            song.cover.open("rb")
            song.color = dominant_color(song.cover.read())
            song.save(update_fields=["color"])

    @action(detail=False, methods=["post"])
    def youtube(self, request):
        """Agrega una canción desde un enlace de YouTube (usa oEmbed, sin API key)."""
        b = owner_business(request)
        vid = parse_youtube_id(request.data.get("url", ""))
        if not vid:
            return Response({"detail": "Enlace de YouTube no válido."}, status=400)
        info = youtube_oembed(vid) or {"title": "", "artist": "", "thumbnail": ""}
        song = Song(
            business=b,
            source=Source.YOUTUBE,
            youtube_id=vid,
            title=request.data.get("title") or info["title"] or f"Video {vid}",
            artist=request.data.get("artist") or info["artist"],
            genre=request.data.get("genre", ""),
            explicit=bool(request.data.get("explicit", False)),
        )
        thumb = download_bytes(f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg")
        if thumb:
            song.cover = cover_file(thumb, f"yt_{vid}.jpg")
            song.color = dominant_color(thumb)
        song.save()
        return Response(SongSerializer(song).data, status=201)


class PlaylistViewSet(viewsets.ModelViewSet):
    serializer_class = PlaylistSerializer

    def get_queryset(self):
        return Playlist.objects.filter(business=owner_business(self.request))

    def perform_create(self, serializer):
        serializer.save(business=owner_business(self.request))

    @action(detail=True, methods=["put"])
    def songs(self, request, pk=None):
        playlist = self.get_object()
        ids = [int(i) for i in request.data.get("song_ids", [])]
        valid = set(Song.objects.filter(business=playlist.business, pk__in=ids).values_list("id", flat=True))
        playlist.items.all().delete()
        PlaylistItem.objects.bulk_create(
            [PlaylistItem(playlist=playlist, song_id=sid, order=i) for i, sid in enumerate(ids) if sid in valid]
        )
        return Response(PlaylistSerializer(playlist).data)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        playlist = self.get_object()
        b = playlist.business
        b.background_playlist = playlist
        b.save(update_fields=["background_playlist"])
        return Response(PlaylistSerializer(playlist).data)


class QueueView(APIView):
    def get(self, request):
        return Response(services.build_state(owner_business(request)))


@api_view(["POST"])
def queue_skip(request):
    b = owner_business(request)
    services.advance(b, skipped=True)
    return Response(services.build_state(b))


@api_view(["POST"])
def queue_pause(request):
    b = owner_business(request)
    b.is_paused = bool(request.data.get("paused", not b.is_paused))
    b.save(update_fields=["is_paused"])
    services.broadcast(b)
    return Response(services.build_state(b))


@api_view(["POST"])
def queue_reorder(request):
    b = owner_business(request)
    services.reorder(b, request.data.get("ids", []))
    return Response(services.build_state(b))


@api_view(["DELETE"])
def queue_remove(request, item_id):
    b = owner_business(request)
    services.remove_item(b, item_id)
    return Response(services.build_state(b))


@api_view(["POST"])
def queue_add(request):
    b = owner_business(request)
    try:
        services.request_song(b, request.data.get("song"), table="Barra", by_owner=True)
    except services.RequestRejected as e:
        return Response({"detail": e.message}, status=409)
    return Response(services.build_state(b))


@api_view(["GET"])
def owner_history(request):
    b = owner_business(request)
    items = (
        QueueItem.objects.filter(business=b, status__in=[QueueStatus.PLAYED, QueueStatus.SKIPPED])
        .select_related("song")
        .order_by("-played_at")[:50]
    )
    return Response(QueueItemSerializer(items, many=True).data)


@api_view(["GET"])
def owner_stats(request):
    b = owner_business(request)
    days = min(int(request.query_params.get("days", 14)), 90)
    since = timezone.now() - timedelta(days=days)
    reqs = QueueItem.objects.filter(business=b, is_background=False, requested_at__gte=since)

    top_songs = (
        reqs.values("song__id", "song__title", "song__artist", "song__color")
        .annotate(total=Count("id"))
        .order_by("-total")[:10]
    )
    top_artists = reqs.exclude(song__artist="").values("song__artist").annotate(total=Count("id")).order_by("-total")[:8]
    by_table = reqs.exclude(table="").values("table").annotate(total=Count("id")).order_by("-total")[:30]
    by_day_raw = {
        r["day"]: r["total"]
        for r in reqs.annotate(day=TruncDate("requested_at", tzinfo=timezone.get_current_timezone()))
        .values("day")
        .annotate(total=Count("id"))
    }
    today = timezone.localdate()
    by_day = [
        {"day": (today - timedelta(days=i)).isoformat(), "total": by_day_raw.get(today - timedelta(days=i), 0)}
        for i in range(days - 1, -1, -1)
    ]
    by_hour_raw = {
        r["hour"]: r["total"]
        for r in reqs.annotate(hour=ExtractHour("requested_at", tzinfo=timezone.get_current_timezone()))
        .values("hour")
        .annotate(total=Count("id"))
    }
    return Response(
        {
            "total_requests": reqs.count(),
            "unique_clients": reqs.exclude(client_id="").values("client_id").distinct().count(),
            "songs_in_catalog": b.songs.count(),
            "played_today": QueueItem.objects.filter(business=b, played_at__date=today).count(),
            "top_songs": list(top_songs),
            "top_artists": list(top_artists),
            "by_table": list(by_table),
            "by_day": by_day,
            "by_hour": [{"hour": h, "total": by_hour_raw.get(h, 0)} for h in range(24)],
        }
    )


# --------------------------------------------------------------------------- #
# Panel de la plataforma (solo superusuario)
# --------------------------------------------------------------------------- #
class IsSuperuser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_superuser)


class PlatformBusinessViewSet(viewsets.ModelViewSet):
    serializer_class = PlatformBusinessSerializer
    permission_classes = [IsSuperuser]

    def get_queryset(self):
        since = timezone.now() - timedelta(days=30)
        return Business.objects.select_related("owner").annotate(
            songs_count=Count("songs", distinct=True),
            requests_30d=Count(
                "queue", filter=Q(queue__is_background=False, queue__requested_at__gte=since), distinct=True
            ),
        ).order_by("-created_at")

    @action(detail=True, methods=["get", "post"])
    def payments(self, request, pk=None):
        b = self.get_object()
        if request.method == "GET":
            return Response(PaymentSerializer(b.payments.all(), many=True).data)
        ser = PaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        payment = ser.save(business=b)
        # Extiende la suscripción desde hoy o desde la fecha vigente (la que sea mayor)
        start = max(b.subscription_until or timezone.localdate(), timezone.localdate())
        b.subscription_until = start + timedelta(days=30 * payment.months)
        b.is_active = True
        b.save(update_fields=["subscription_until", "is_active"])
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        b = self.get_object()
        b.approval = "approved" if request.data.get("approved", True) else "rejected"
        if b.approval == "approved":
            b.is_active = True
            if not b.subscription_until or b.subscription_until < timezone.localdate():
                b.subscription_until = timezone.localdate() + timedelta(days=30)
        b.save(update_fields=["approval", "is_active", "subscription_until"])
        return Response(self.get_serializer(b).data)


@api_view(["GET"])
@permission_classes([IsSuperuser])
def platform_summary(request):
    today = timezone.localdate()
    month_start = today.replace(day=1)
    qs = Business.objects.all()
    active = [b for b in qs if b.subscription_ok]
    return Response(
        {
            "businesses": qs.count(),
            "active": len(active),
            "suspended": qs.filter(is_active=False).count(),
            "pending": qs.filter(approval="pending").count(),
            "expiring_7d": qs.filter(
                is_active=True, subscription_until__gte=today, subscription_until__lte=today + timedelta(days=7)
            ).count(),
            "mrr": sum(b.monthly_price for b in active),
            "income_month": sum(p.amount for p in Payment.objects.filter(paid_at__date__gte=month_start)),
            "requests_today": QueueItem.objects.filter(is_background=False, requested_at__date=today).count(),
        }
    )
