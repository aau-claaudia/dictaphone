import os
import sys
import json
from pathlib import Path
from django.http import JsonResponse, HttpResponse, Http404
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from backend.settings import transcription_processor
from .serializers import FileUploadSerializer, MultipleRequestIdJsonSerializer, RequestIdJsonSerializer, SilenceThresholdSerializer, RecordingFilePathSerializer
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
                file_url = request.build_absolute_uri(os.path.join(settings.MEDIA_ROOT, file_upload.file.name))
                file_path = file_upload.file.path
                #request_id = transcription_processor.add_to_queue(uploaded_file_path)
                #return JsonResponse({"message": "File uploaded successfully!", "request_id": request_id}, status=200)
                return JsonResponse({"message": "File uploaded successfully!", "file_url": file_url, "file_path": file_path}, status=200)
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


class ResetRecordingView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        #print(request.data)
        if request.data and request.data.get('file_path'):
            # parse file_url from data
            file_path_serializer = RecordingFilePathSerializer(data={'file_path': request.data.get('file_path')})
            if file_path_serializer.is_valid():
                file_path = file_path_serializer.validated_data['file_path']
                #print(file_path)
                # delete file
                if os.path.isfile(file_path):
                    os.remove(file_path)
                    print(f"Removed file: {file_path}")
                return JsonResponse({"message": "Recoding successfully deleted!", "file_url": file_path}, status=200)
            else:
                return Response(file_path_serializer.errors, status=400)
        else:
            return Response("No file_url data.", status=400)


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
                    transcription_result = transcription_processor.get_transcription(request_id.get('request_id'))
                    if transcription_result is not None:
                        responses.append({
                            'request_id': request_id.get('request_id'),
                            'transcription_text': transcription_result['text'],
                            'transcription_confidence': transcription_result['confidence'],
                            'transcription_file_name': transcription_result['file_name']
                        })
                    else:
                        responses.append({
                            'request_id': request_id.get('request_id'),
                            'transcription_text': None,
                            'transcription_confidence': None,
                            'transcription_file_name': None
                        })
                    response['transcriptions'] = responses
                return JsonResponse(response)
            return Response(serializer.errors, status=400)
        return Response({'error': 'No requestId data provided'}, status=400)


def serve_file(request, path):
    #print("Serve file view")
    # Determine the base directory based on the URL prefix
    # TODO: redo serve file path logic
    if request.path.startswith('/work/'):
        base_dir = '/work'  # the files are saved here on UCloud
    elif 'media/TRANSCRIPTIONS' in request.path:
        base_dir = os.path.join(settings.MEDIA_ROOT, 'TRANSCRIPTIONS/')
    elif 'UPLOADS/INPUT' in request.path:
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

def reset_data(request):
    # clear the transcription texts
    transcription_processor.clear_transcriptions()
    # delete the audio files
    directory_path: str = os.path.join(settings.MEDIA_ROOT, 'UPLOADS/INPUT')
    clean_dir(directory_path)

    return HttpResponse("Server data deleted.", status=200)

def clean_dir(directory):
    for item in os.listdir(directory):
        source_path = os.path.join(directory, item)
        # Check if the item is a file (not a directory)
        if os.path.isfile(source_path):
            os.remove(source_path)
            print(f"Removed file: {source_path}")