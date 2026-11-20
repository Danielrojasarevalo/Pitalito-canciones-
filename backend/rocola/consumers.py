"""WebSocket: cada negocio tiene un grupo; celulares y pantallas reciben el estado en vivo."""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import services
from .models import Business


class RocolaConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.slug = self.scope["url_route"]["kwargs"]["slug"]
        state = await self._state()
        if state is None:
            await self.close()
            return
        self.group = services.group_name(self.slug)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "state", "state": state})

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def state_update(self, event):
        await self.send_json({"type": "state", "state": event["state"]})

    @database_sync_to_async
    def _state(self):
        b = Business.objects.filter(slug=self.slug).first()
        return services.build_state(b) if b else None
