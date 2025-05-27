from rest_framework import serializers
from .models import FileUpload, RequestIdJson

class FileUploadSerializer(serializers.ModelSerializer):
    class Meta:
        model = FileUpload
        fields = ['file']

class RequestIdJsonSerializer(serializers.ModelSerializer):
    class Meta:
        model = RequestIdJson
        fields = ['request_id']

class MultipleRequestIdJsonSerializer(serializers.Serializer):
    requests = RequestIdJsonSerializer(many=True)