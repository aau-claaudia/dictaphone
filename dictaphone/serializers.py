from rest_framework import serializers
from .models import FileUpload, RequestIdJson, SilenceThreshold, RecordingFilePath

class FileUploadSerializer(serializers.ModelSerializer):
    class Meta:
        model = FileUpload
        fields = ['file']

class RequestIdJsonSerializer(serializers.ModelSerializer):
    class Meta:
        model = RequestIdJson
        fields = ['request_id']

class SilenceThresholdSerializer(serializers.ModelSerializer):
    class Meta:
        model = SilenceThreshold
        fields = ['silence_threshold']

class RecordingFilePathSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecordingFilePath
        fields = ['file_path']

class MultipleRequestIdJsonSerializer(serializers.Serializer):
    requests = RequestIdJsonSerializer(many=True)