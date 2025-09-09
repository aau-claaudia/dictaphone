import os
from django.http import Http404
from django.http import HttpResponse
import logging

from django.shortcuts import render

from backend import settings

logger = logging.getLogger(__name__)

def index(request):
    return render(request, 'index.html')

def serve_file(request, path):
    # Determine the base directory based on the URL prefix
    if request.path.startswith('/work/'):
        base_dir = '/work'  # the files are saved here on UCloud
    elif 'media/RECORDINGS' in request.path:
        base_dir = os.path.join(settings.MEDIA_ROOT, 'RECORDINGS/')
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
