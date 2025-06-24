from celery import shared_task
from celery.contrib.abortable import AbortableTask
import subprocess
import os
import shutil
import time

from django.conf import settings

# TODO: adapt to run on a single file (recording) - and also change the cleanup to clean only the single input file

@shared_task(bind=True, base=AbortableTask)
def transcription_task(self, model_size, language):
    print('starting the transcription task now...')
    directory_path: str = os.path.join(settings.MEDIA_ROOT, 'UPLOADS/INPUT')
    output_dir_path: str = os.path.join(settings.MEDIA_ROOT, 'TRANSCRIPTIONS/')
    transcriber_output_file: str = os.path.join(output_dir_path, "transcriber_output.txt")
    process = None  # Initialize the process variable

    try:
        # Prepare the command based on the language
        if language == 'auto':
            command = [
                'python', 'transcriber/aau-whisper/app.py', '--job_name', 'files',
                '-o', output_dir_path, '-m', model_size, '--input_dir', directory_path,
                '--merge_speakers', '--threads', '4', '--transcriber_gui'
            ]
        else:
            command = [
                'python', 'transcriber/aau-whisper/app.py', '--job_name', 'files',
                '-o', output_dir_path, '-m', model_size, '--language', language,
                '--input_dir', directory_path, '--merge_speakers', '--threads', '4',
                '--transcriber_gui'
            ]

        # Start the subprocess
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        # Periodically check if the task is aborted
        while process.poll() is None:  # While the process is still running
            if self.is_aborted():
                print("Task was aborted. Terminating subprocess...")
                process.terminate()  # Terminate the subprocess
                process.wait()  # Wait for the process to terminate
                print("Process terminated.")
                # clean up the input files
                clean_dir(directory_path)
                print("Input folder cleaned.")
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

    # moved uploaded files from the input directory to COMPLETED folder
    transcribed_path: str = os.path.join(settings.MEDIA_ROOT, 'COMPLETED')
    os.makedirs(transcribed_path, exist_ok=True)

    for item in os.listdir(directory_path):
        source_path = os.path.join(directory_path, item)
        target_path = os.path.join(transcribed_path, item)
        # Check if the item is a file (not a directory)
        if os.path.isfile(source_path):
            shutil.move(source_path, target_path)
            print(f"Moved file: {source_path} to {target_path}")

    return "Task completed"

def write_transcriber_output(error, output, transcriber_output_file):
    with open(transcriber_output_file, 'w') as t_file:
        t_file.write(output)
        t_file.write(error)

def clean_dir(directory):
    for item in os.listdir(directory):
        source_path = os.path.join(directory, item)
        # Check if the item is a file (not a directory)
        if os.path.isfile(source_path):
            os.remove(source_path)
            print(f"Removed file: {source_path}")