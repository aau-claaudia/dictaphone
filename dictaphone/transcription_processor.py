import threading
import queue
from pathlib import Path
import whisper
import time
import subprocess
import whisper
import torch
from typing import Any

def convert_audio_to_wav(input_path, output_path):
    try:
        command = [
            "ffmpeg",
            "-i", str(input_path),
            "-ar", "16000",  # Set sample rate to 16 kHz
            "-ac", "1",      # Set audio channels to mono
            str(output_path)
        ]
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as e:
        # Log the error and raise an exception to indicate failure
        print(f"FFmpeg conversion failed: {e}")
        raise ValueError("Audio conversion failed. Ensure the file contains valid audio data.")

# This class is responsible for handling transcriptions
# Transcriptions are processed from a thread safe FIFO queue
class TranscriptionProcessor:
    def __init__(self, model_name="turbo"):
        self.device = torch.device("cpu") #TODO: hardcoding to cpu for test
        self.queue = queue.Queue()  # Thread-safe FIFO queue
        self.counter = 0  # Counter to track requests
        self.lock = threading.Lock()  # Lock to ensure thread-safe counter increment
        self.transcriptions = {}  # Dictionary to store transcriptions
        self.transcriptions_lock = threading.Lock()  # Lock for thread-safe access to transcriptions
        self.model = whisper.load_model(model_name, device=self.device)  # Load the Whisper model once
        self.worker_thread = threading.Thread(target=self._process_queue, daemon=True)
        self.worker_thread.start()  # Start the background worker thread

    def add_to_queue(self, file_path: str):
        """Thread-safe method to add a file to the queue."""
        with self.lock:
            self.counter += 1
            request_id = self.counter
        self.queue.put((request_id, file_path))
        print(f"Added file to queue: {file_path} with ID: {request_id}")
        return request_id

    def get_transcription(self, request_id: str) -> str:
        """Thread-safe method to retrieve transcription text by request ID."""
        with self.transcriptions_lock:
            #return self.transcriptions.get(request_id, "NOT_AVAILABLE")
            return self.transcriptions.get(request_id)

    def clear_transcriptions(self):
        with self.transcriptions_lock:
            self.transcriptions.clear()

    def _process_queue(self):
        """Background worker to process items from the queue."""
        while True:
            try:
                # Get the next item from the queue (blocking call)
                request_id, file_path = self.queue.get()
                print(f"Processing file with ID: {request_id}, Path: {file_path}")

                # Paths for the uploaded and converted files
                uploaded_file_path = Path(file_path)
                print(f"Uploaded file successfully converted to file: {uploaded_file_path}")
                #converted_file_path = uploaded_file_path.with_suffix(".wav")

                # Perform transcription
                try:
                    # Convert the uploaded file to WAV
                    #convert_audio_to_wav(uploaded_file_path, converted_file_path)
                    #print(f"Uploaded file successfully converted to file: {converted_file_path}")

                    # TODO: add logic for cleaning leading silence in file - discard file if it only contains silence

                    # transcribe chunk
                    transcribe_arguments = {"fp16": False}
                    # Setup CPU/GPU and model
                    #if torch.cuda.is_available():
                    #    device = torch.device("cuda")
                    #elif torch.backends.mps.is_available():
                    #    device = torch.device("mps")
                    #else:
                    #    device = torch.device("cpu")
                    transcribed_result: dict[str, Any] = self.model.transcribe(
                        Path(uploaded_file_path).resolve().as_posix(), **transcribe_arguments
                    )
                    transcription_text = transcribed_result["text"]
                    print(f"Transcription result for ID {request_id}: {transcription_text}")

                    # Store the transcription in a thread-safe manner
                    with self.transcriptions_lock:
                        self.transcriptions[str(request_id)] = transcription_text
                        # TODO: implement code for appending to outputfile on the server

                    #print(self.transcriptions)

                except ValueError as e:
                    print(f"Error processing file: {e}")

                # Mark the task as done
                self.queue.task_done()
            except Exception as e:
                print(f"Error processing file: {e}")

            # Sleep briefly to avoid busy-waiting
            time.sleep(0.1)