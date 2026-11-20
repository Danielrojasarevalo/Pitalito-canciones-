from django.urls import path

from .consumers import RocolaConsumer

websocket_urlpatterns = [path("ws/rocola/<slug:slug>/", RocolaConsumer.as_asgi())]
