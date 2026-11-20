from django.contrib import admin

from .models import Business, Payment, Playlist, PlaylistItem, QueueItem, Song


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "owner", "plan", "approval", "is_active", "subscription_until")
    list_filter = ("plan", "approval", "is_active")
    search_fields = ("name", "slug", "owner__username")


@admin.register(Song)
class SongAdmin(admin.ModelAdmin):
    list_display = ("title", "artist", "business", "source", "explicit", "is_blocked")
    list_filter = ("business", "source", "explicit", "is_blocked")
    search_fields = ("title", "artist")


class PlaylistItemInline(admin.TabularInline):
    model = PlaylistItem
    extra = 0


@admin.register(Playlist)
class PlaylistAdmin(admin.ModelAdmin):
    list_display = ("name", "business", "shuffle")
    inlines = [PlaylistItemInline]


@admin.register(QueueItem)
class QueueItemAdmin(admin.ModelAdmin):
    list_display = ("song", "business", "status", "table", "is_background", "requested_at", "played_at")
    list_filter = ("business", "status", "is_background")


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("business", "amount", "months", "method", "paid_at")
