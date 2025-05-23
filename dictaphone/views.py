import os
import sys
from pathlib import Path
from django.http import JsonResponse, HttpResponse, Http404
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from backend.settings import transcription_processor
from .serializers import FileUploadSerializer
from django.http import HttpResponse
from django.http.response import JsonResponse


def index(request):
    # TODO: serve react application on /
    return HttpResponse("Welcome to the Dictaphone app!")

class FileUploadView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        print(request.data)
        if request.data and request.data.get('audio_chunk'):
            # parse uploaded file data
            file_serializer = FileUploadSerializer(data={'file': request.data.get('audio_chunk')})
            if file_serializer.is_valid():
                file_upload = file_serializer.save()
                file_upload.save()
                print(f"file name: {file_upload.file.name} path: {file_upload.file.path} size: {file_upload.file.size}")
                # Add the file to the transcription queue
                uploaded_file_path = file_upload.file.path
                request_id = transcription_processor.add_to_queue(uploaded_file_path)

                return JsonResponse({"message": "File uploaded successfully!", "request_id": request_id}, status=200)
            else:
                return Response(file_serializer.errors, status=400)
        else:
            return Response("No upload data.", status=400)

def get_transcription(request, request_id):
    #print(f"Requesting transcription for id = {request_id}")
    transcription = transcription_processor.get_transcription(request_id)
    response = {
        'transcription': transcription
    }
    #print("Returning response: ")
    #print(response)
    return JsonResponse(response)
