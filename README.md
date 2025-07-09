# Dictaphone

## Python packages needed
``` bash
pip install django django-cors-headers extendable-media-recorder extendable-media-recorder-wav-encoder django-rest-framework celery channels daphne
```

## Start development server
``` bash
daphne -p 8001 backend.asgi:application
```

