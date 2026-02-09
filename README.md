# Dictaphone
The dictaphone application is designed to continuously transmit recording data through a customized WebSocket implementation. 
This ensures that there will not be any cached sensitive data in the browser, but only momentarily in the Javascript memory.
Reliable Data Transfer has been implemented by use of acknowledgment of data packets and package request/re-send functionality. 
Also, a custom header is prefixed on the client side for binary data packets, and this header is stripped on the server side to ensure package order integrity. 
Transcription of recordings is done using the Transcriber project. Transcriptions are started as Celery tasks. 

## Sequence diagram - user and component interaction
![Sequence Diagram](documentation/architecture.svg)

# Setting up dictaphone for local development

## Python packages needed
``` bash
pip install django django-cors-headers django-rest-framework celery redis channels-redis python-dotenv channels daphne pytest pytest-asyncio torch
```

## npm packages needed
``` bash
npm install extendable-media-recorder extendable-media-recorder-wav-encoder react-spinners
```

## npm package for testing the app on mobile phones (https needed)
``` bash
npm install @vitejs/plugin-basic-ssl --save-dev
```

## Prepare Django backend.
Create an environment file for test in the "dictaphone" project directory called ".env" with the following content (modify to fit your project directory and memory size)
MEMORY_IN_GIGS is used for determining the usable whisper models.
```
SECRET_KEY='django-insecure-1t2i)9v^1^n$4@_w72wlb$71r)=o1(kg2lnma-!fni9*ei#y75'
DEBUG=True
DJANGO_LOG_HANDLER='console'
DJANGO_LOG_LEVEL='DEBUG'
DJANGO_LOG_FILE='/home/nikko/projects/dictaphone/django.log'
MEMORY_IN_GIGS=64
```

## Start daphne server for serving WebSocket (activate Python env)
``` bash
daphne -p 8000 backend.asgi:application
```

## Start development react frontend
``` bash
nikko@nikkoAtClaaudia:~/projects/dictaphone/frontend$ npm run dev --host
```

## Run unit and integration tests
``` bash
(.venv) nikko@nikkoAtClaaudia:~/projects/dictaphone$ pytest -v --ignore=dictaphone/aau-whisper/
```

## Checkout and install the transcriber Python application
``` bash
cd dictaphone
git clone --depth 1 --single-branch --recursive --shallow-submodules -b "V1.16" https://github.com/aau-claaudia/transcriber.git aau-whisper
cd aau-whisper
pip install -r requirements.txt
pip install -e .
```

## Start Celery worker and configure to run one task at a time from the queue (activate Python env)
``` bash
(.venv) nikko@nikkoAtClaaudia:~/projects/dictaphone$ python -m celery -A backend worker -l info --concurrency=1
```

# Testing on mobile device in local setup
First create a wireless hotspot from your phone, and connect to this network from your pc.
Then lookup the ip of that connection using e.g. the ifconfig command.
Use this ip to start daphne with the -b flag.

## Start daphne server for serving WebSocket (activate Python env)
``` bash
daphne -b 10.49.223.156 -p 8000 backend.asgi:application
```
The Celery worker is started as usual in the local setup.
Before starting the development server, edit the vite.config.js file. 
Change the plugin definition at the top to the one with basicSsl - this is needed for access from a mobile phone.
In the same file change the "target" definitions to point to your network ip.
Now start the development server as usual.

## Start development react frontend
``` bash
nikko@nikkoAtClaaudia:~/projects/dictaphone/frontend$ npm run dev
```
You will see from the output that the server starts listening on HTTPS on your IP. 
From your browser, now go to this URL, e.g. https://10.49.223.156:5173
Click "accept the risk" and the app should show.
