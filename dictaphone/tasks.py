from celery import shared_task
from celery.contrib.abortable import AbortableTask
import subprocess
import os
import shutil
import time
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

@shared_task(bind=True, base=AbortableTask)
def transcription_task(self, recording_directory, recording_file_path, model_size, language):
    logger.info("Starting the transcription task now...")
    logger.info(f"Transcribing file: {recording_file_path}")
    output_dir_path: str = os.path.join(recording_directory, 'TRANSCRIPTIONS/')
    os.makedirs(output_dir_path, exist_ok=True)
    transcriber_output_file: str = os.path.join(output_dir_path, "transcriber_output.txt")
    process = None  # Initialize the process variable

    try:
        # Prepare the command based on the language
        if language == 'auto':
            command = [
                'python', 'dictaphone/aau-whisper/app.py', '--job_name', 'files',
                '-o', output_dir_path, '-m', model_size, '--input', recording_file_path,
                '--merge_speakers', '--threads', '4', '--transcriber_gui'
            ]
        else:
            command = [
                'python', 'dictaphone/aau-whisper/app.py', '--job_name', 'files',
                '-o', output_dir_path, '-m', model_size, '--language', language,
                '--input', recording_file_path, '--merge_speakers', '--threads', '4',
                '--transcriber_gui'
            ]

        # Start the subprocess
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        # Periodically check if the task is aborted
        while process.poll() is None:  # While the process is still running
            if self.is_aborted():
                logger.info("Task was aborted. Terminating subprocess...")
                process.terminate()  # Terminate the subprocess
                process.wait()  # Wait for the process to terminate
                logger.info("Process terminated.")
                return "TASK ABORTED"
            time.sleep(2)  # Add a 2-second delay to reduce CPU usage

        # Capture the output and error after the process completes
        output, error = process.communicate()
        write_transcriber_output(error, output, transcriber_output_file)
    except subprocess.CalledProcessError as e:
        write_transcriber_output(e.stderr, e.stdout, transcriber_output_file)

    finally:
        # Ensure the subprocess is terminated if it is still running
        if process and process.poll() is None:
            process.terminate()
            process.wait()

    return "Task completed"

def write_transcriber_output(error, output, transcriber_output_file):
    with open(transcriber_output_file, 'w') as t_file:
        t_file.write(output)
        t_file.write(error)
