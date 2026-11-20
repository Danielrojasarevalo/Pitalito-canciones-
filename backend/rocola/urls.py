from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("owner/songs", views.SongViewSet, basename="songs")
router.register("owner/playlists", views.PlaylistViewSet, basename="playlists")
router.register("platform/businesses", views.PlatformBusinessViewSet, basename="platform-businesses")

urlpatterns = [
    path("auth/login/", views.login),
    path("auth/logout/", views.logout),
    path("auth/register/", views.register),
    path("auth/me/", views.me),
    # Cliente (QR)
    path("public/server-info/", views.server_info),
    path("public/<slug:slug>/", views.public_business),
    path("public/<slug:slug>/songs/", views.public_songs),
    path("public/<slug:slug>/request/", views.public_request),
    # Reproductor
    path("player/<slug:slug>/", views.player_state),
    path("player/<slug:slug>/next/", views.player_next),
    # Dueño
    path("owner/business/", views.OwnerBusinessView.as_view()),
    path("owner/business/player-token/", views.regenerate_player_token),
    path("owner/queue/", views.QueueView.as_view()),
    path("owner/queue/skip/", views.queue_skip),
    path("owner/queue/pause/", views.queue_pause),
    path("owner/queue/reorder/", views.queue_reorder),
    path("owner/queue/add/", views.queue_add),
    path("owner/queue/<int:item_id>/", views.queue_remove),
    path("owner/history/", views.owner_history),
    path("owner/stats/", views.owner_stats),
    # Plataforma
    path("platform/summary/", views.platform_summary),
    path("", include(router.urls)),
]
