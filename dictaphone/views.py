import os
from django.http import Http404
from django.http import HttpResponse
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

def index(request):
    # TODO: serve react application on /
    #logger.info("Executing default view.")
    return HttpResponse("Welcome to the Dictaphone app!")

def serve_file(request, path):
    #logger.info("Executing the serve_file view")
    # Determine the base directory based on the URL prefix
    # TODO: redo serve file path logic
    if request.path.startswith('/work/'):
        base_dir = '/work'  # the files are saved here on UCloud
    elif 'media/TRANSCRIPTIONS' in request.path:
        base_dir = os.path.join(settings.MEDIA_ROOT, 'TRANSCRIPTIONS/')
    elif 'media/RECORDINGS' in request.path:
        # Open the file and create the response
        with open(request.path, 'rb') as f:
            response = HttpResponse(f.read(), content_type='application/octet-stream')
            response['Content-Disposition'] = 'attachment; filename="{}"'.format(os.path.basename(request.path))
            return response
    else:
        raise Http404("File not found")

    # Construct the full file path
    file_path = os.path.join(base_dir, path)
    # Check if the file exists
    if not os.path.exists(file_path):
        raise Http404("File not found")

    # Open the file and create the response
    with open(file_path, 'rb') as f:
        response = HttpResponse(f.read(), content_type='application/octet-stream')
        response['Content-Disposition'] = 'attachment; filename="{}"'.format(os.path.basename(file_path))
        return response
