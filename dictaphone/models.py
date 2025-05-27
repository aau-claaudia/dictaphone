from django.db import models

# Create your models here.

class FileUpload(models.Model):
    file = models.FileField(upload_to='UPLOADS')

class RequestIdJson(models.Model):
    request_id = models.CharField(max_length=255, blank=False, null=False)