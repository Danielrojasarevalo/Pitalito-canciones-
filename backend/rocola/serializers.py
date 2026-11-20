from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Business, Payment, Playlist, PlaylistItem, QueueItem, Song

User = get_user_model()


class SongSerializer(serializers.ModelSerializer):
    audio_url = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()
    times_requested = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Song
        fields = [
            "id", "title", "artist", "album", "genre", "duration", "explicit", "is_blocked",
            "source", "youtube_id", "audio_file", "cover", "audio_url", "cover_url", "color",
            "created_at", "times_requested",
        ]
        read_only_fields = ["created_at"]
        extra_kwargs = {
            "audio_file": {"write_only": True, "required": False},
            "cover": {"write_only": True, "required": False},
            "title": {"required": False, "allow_blank": True},
        }

    def get_audio_url(self, obj):
        return obj.audio_file.url if obj.audio_file else ""

    def get_cover_url(self, obj):
        return obj.cover.url if obj.cover else ""


class PublicSongSerializer(SongSerializer):
    class Meta(SongSerializer.Meta):
        fields = ["id", "title", "artist", "album", "genre", "duration", "explicit", "cover_url", "color", "source"]


class PlaylistSerializer(serializers.ModelSerializer):
    song_ids = serializers.SerializerMethodField()
    songs_count = serializers.SerializerMethodField()
    is_background = serializers.SerializerMethodField()

    class Meta:
        model = Playlist
        fields = ["id", "name", "shuffle", "song_ids", "songs_count", "is_background", "created_at"]
        read_only_fields = ["created_at"]

    def get_song_ids(self, obj):
        return list(obj.items.values_list("song_id", flat=True))

    def get_songs_count(self, obj):
        return obj.items.count()

    def get_is_background(self, obj):
        return obj.business.background_playlist_id == obj.id


class BusinessOwnerSerializer(serializers.ModelSerializer):
    """Lo que el dueño puede ver y editar de su negocio."""

    subscription_ok = serializers.BooleanField(read_only=True)

    class Meta:
        model = Business
        fields = [
            "id", "name", "slug", "city", "phone", "accent_color", "plan", "monthly_price", "is_active",
            "subscription_until", "subscription_ok", "approval", "player_token", "background_playlist", "tables_count",
            "max_requests_per_table", "requests_window_minutes", "repeat_block_minutes", "block_explicit",
            "blocked_artists", "requests_enabled", "hours_start", "hours_end", "allow_dedications",
        ]
        read_only_fields = ["slug", "plan", "monthly_price", "is_active", "subscription_until", "approval", "player_token"]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "business", "amount", "months", "method", "reference", "paid_at"]
        read_only_fields = ["business"]


class PlatformBusinessSerializer(serializers.ModelSerializer):
    """Para el panel de la plataforma (superadministrador)."""

    owner_username = serializers.CharField(source="owner.username", read_only=True)
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    subscription_ok = serializers.BooleanField(read_only=True)
    songs_count = serializers.IntegerField(read_only=True)
    requests_30d = serializers.IntegerField(read_only=True)
    # Solo para crear
    username = serializers.CharField(write_only=True, required=False)
    password = serializers.CharField(write_only=True, required=False, min_length=4)

    class Meta:
        model = Business
        fields = [
            "id", "name", "slug", "city", "phone", "plan", "monthly_price", "is_active", "subscription_until",
            "subscription_ok", "approval", "owner_username", "owner_email", "songs_count", "requests_30d", "created_at", "username", "password",
        ]
        read_only_fields = ["slug", "created_at"]

    def validate(self, attrs):
        if self.instance is None:
            if not attrs.get("username") or not attrs.get("password"):
                raise serializers.ValidationError("Usuario y contraseña del dueño son obligatorios.")
            if User.objects.filter(username=attrs["username"]).exists():
                raise serializers.ValidationError({"username": "Ese usuario ya existe."})
        return attrs

    def create(self, validated_data):
        username = validated_data.pop("username")
        password = validated_data.pop("password")
        owner = User.objects.create_user(username=username, password=password)
        return Business.objects.create(owner=owner, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("username", None)
        password = validated_data.pop("password", None)
        if password:
            instance.owner.set_password(password)
            instance.owner.save()
        return super().update(instance, validated_data)


class QueueItemSerializer(serializers.ModelSerializer):
    song = SongSerializer(read_only=True)

    class Meta:
        model = QueueItem
        fields = ["id", "song", "status", "position", "is_background", "table", "dedication", "requested_at", "played_at"]
