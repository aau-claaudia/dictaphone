import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.urls import path
from dictaphone.audio_data_consumer import AudioDataConsumer
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing code that may import ORM models.
django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    # Django's ASGI application to handle traditional HTTP requests
    "http": django_asgi_app,
    # WebSocket handler
    'websocket': URLRouter([
        path('ws/dictaphone/data/', AudioDataConsumer.as_asgi()),
    ])
})