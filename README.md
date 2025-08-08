# Dictaphone

## Python packages needed
``` bash
pip install django django-cors-headers django-rest-framework celery channels daphne pytest pytest-asyncio
```
## npm packages needed
``` bash
npm install extendable-media-recorder extendable-media-recorder-wav-encoder
```

## Start development server
``` bash
daphne -p 8001 backend.asgi:application
```

## Start development react frontend
```
nikko@nikkoAtClaaudia:~/projects/dictaphone/frontend$ npm run dev --host
```

## Run unit test
```
(.venv) nikko@nikkoAtClaaudia:~/projects/dictaphone$ python -m unittest dictaphone/test_audio_chunk_manager.py
```

## Run integration test
```
(.venv) nikko@nikkoAtClaaudia:~/projects/dictaphone$ pytest -v --ignore=dictaphone/aau-whisper/
```