# Dictaphone

## Python packages needed
``` bash
pip install django django-cors-headers django-rest-framework celery redis channels_redis python-dotenv channels daphne pytest pytest-asyncio
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
``` bash
nikko@nikkoAtClaaudia:~/projects/dictaphone/frontend$ npm run dev --host
```

## Run unit test
``` bash
(.venv) nikko@nikkoAtClaaudia:~/projects/dictaphone$ python -m unittest dictaphone/test_audio_chunk_manager.py
```

## Run integration test
``` bash
(.venv) nikko@nikkoAtClaaudia:~/projects/dictaphone$ pytest -v --ignore=dictaphone/aau-whisper/
```

## Checkout and install the transcriber Python application
``` bash
cd dictaphone
git clone --depth 1 --single-branch --recursive --shallow-submodules -b "V1.12" https://github.com/aau-claaudia/transcriber.git aau-whisper
pip install --no-cache-dir numpy==1.26.4
pip install --no-cache-dir faster-whisper==1.0.0
cd aau-whisper
pip install -r requirements.txt
pip install -e .
```

## Start Celery worker and configure to run one task at a time from the queue
``` bash
(.venv) nikko@nikkoAtClaaudia:~/projects/dictaphone$ python -m celery -A backend worker -l info --concurrency=1
```