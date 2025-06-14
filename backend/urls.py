"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from dictaphone.views import index, FileUploadView, GetTranscriptionsView, reset_data, SilenceThresholdView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('upload-audio-chunk/', FileUploadView.as_view(), name="upload_audio_chunk"),
    path('get-transcriptions/', GetTranscriptionsView.as_view(), name="get_transcriptions"),
    path('update-silence-threshold/', SilenceThresholdView.as_view(), name="update_silence_threshold"),
    path('reset-data/', reset_data, name="reset_data"),
    path('', index, name='index'),  # Example route
]
