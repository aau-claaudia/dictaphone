import os
import sys
import json
from pathlib import Path
from django.http import JsonResponse, HttpResponse, Http404
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from backend.settings import transcription_processor
from .serializers import FileUploadSerializer, MultipleRequestIdJsonSerializer, RequestIdJsonSerializer, SilenceThresholdSerializer
from django.http import HttpResponse
from django.http.response import JsonResponse
from django.conf import settings


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


class SilenceThresholdView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        #print(request.data)
        if request.data and request.data.get('silence_threshold'):
            # parse silence threshold from data
            silence_threshold_serializer = SilenceThresholdSerializer(data={'silence_threshold': request.data.get('silence_threshold')})
            if silence_threshold_serializer.is_valid():
                threshold = silence_threshold_serializer.validated_data['silence_threshold']
                #print(threshold)
                transcription_processor.set_silence_threshold(threshold)
                return JsonResponse({"message": "Silence threshold successfully configured!", "silence_threshold": threshold}, status=200)
            else:
                return Response(silence_threshold_serializer.errors, status=400)
        else:
            return Response("No silence threshold data.", status=400)


class GetTranscriptionsView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        request_id_json = request.data.get('request_ids')
        if request_id_json:
            request_id_json_data = json.loads(request_id_json)
            print(request_id_json_data)
            serializer = MultipleRequestIdJsonSerializer(data={'requests': request_id_json_data})
            if serializer.is_valid():
                response = {}
                responses = []
                requests_meta_data = serializer.validated_data['requests']
                for request_id in requests_meta_data:
                    print(f"Serialized request_id: {request_id}")
                    transcription = transcription_processor.get_transcription(request_id.get('request_id'))
                    responses.append({
                        'request_id': request_id.get('request_id'),
                        'transcription_text': transcription
                    })
                    response['transcriptions'] = responses
                return JsonResponse(response)
            return Response(serializer.errors, status=400)
        return Response({'error': 'No requestId data provided'}, status=400)


def reset_data(request):
    # clear the transcription texts
    transcription_processor.clear_transcriptions()
    # delete the audio files
    directory_path: str = os.path.join(settings.MEDIA_ROOT, 'UPLOADS')
    clean_dir(directory_path)

    return HttpResponse("Server data deleted.", status=200)

def clean_dir(directory):
    for item in os.listdir(directory):
        source_path = os.path.join(directory, item)
        # Check if the item is a file (not a directory)
        if os.path.isfile(source_path):
            os.remove(source_path)
            print(f"Removed file: {source_path}")