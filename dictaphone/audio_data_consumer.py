import json
import struct
import asyncio

from channels.generic.websocket import AsyncWebsocketConsumer
import datetime
import os
import re
from django.conf import settings
import logging
from enum import Enum
from .tasks import transcription_task

logger = logging.getLogger(__name__)

class RecordingStatus(Enum):
    """Represents the finalization status of a recording."""
    VERIFIED = 1                 # Normal completion
    INTERRUPTED_VERIFIED = 2     # Recording was stopped by disconnect, but received data is okay (no detection of missing chunks)
    DATA_LOSS = 3                # For when finalization fails due to missing data, e.g. a chunk is missing
    INTERRUPTED_NOT_VERIFIED = 4 # Recording was stopped because of server disconnect, and could not be finalized


class AudioChunkManager:
    def __init__(self, consumer, load_data_from_server=True):
        self.consumer = consumer
        self.active_recording_id = 0 # first recording will have ID = 1
        self.recordings = {}
        self.lock = asyncio.Lock() # Lock for async operations
        if load_data_from_server:
            # not running in test mode
            self.recording_base_path = get_recording_base_path()
            self.initialize_recording_data(load_all_recordings_status(self.recording_base_path))
        else:
            # running integration test
            recording_path: str = os.path.join(settings.MEDIA_ROOT, 'RECORDINGS/')
            os.makedirs(recording_path, exist_ok=True)
            self.recording_base_path = recording_path

    def initialize_recording_data(self, data: list[dict]):
        if len(data) < 1:
            logger.info("No previous recording data found on server.")
            return
        logger.info("Loading previous recording data from server.")
        max_recording_id = 0
        for recording in data:
            recording_id = recording['recording_id']
            self.recordings[recording_id] = {
                'id': recording_id,
                'title': recording['title'],
                'status': recording['status'],
                'recording_file_path': recording['file_path'],
                'recording_path': recording['recording_path'],
                'transcription_start_time': recording['transcription_start_time'],
                'file_size': recording['file_size'],
                'results': recording['results'] if recording['results'] is not None else []
            }
            if recording_id > max_recording_id:
                max_recording_id = recording_id
        self.active_recording_id = max_recording_id

    async def start_new_recording(self, title) -> int:
        async with self.lock:
            self.active_recording_id = self.active_recording_id + 1
            logger.info(f"Starting new recording, ID = {self.active_recording_id}")
            if self.active_recording_id in self.recordings:
                raise ValueError("Error when creating new recording, ID is already used!")

            # setup metadata structure for the recording
            self.recordings[self.active_recording_id] = {
                'id': self.active_recording_id,
                'title': title,
                'status': 'active',
                'flushed_index': None, # how much of the file has been assembled
                'chunks': {}
            }
            recording_dir_name = self.get_dirname(title)
            recording_path: str = self.recording_base_path + recording_dir_name
            os.makedirs(recording_path, exist_ok=True)
            recording_file_path: str = os.path.join(recording_path, validate_linux_filename(title) + ".wav")
            self.recordings[self.active_recording_id]['recording_path'] = recording_path
            self.recordings[self.active_recording_id]['recording_file_path'] = recording_file_path

            return self.active_recording_id

    async def finalize_active_recording(self, total_chunks=None) -> bool:
        number_of_chunks = total_chunks
        ask_for_resend = True
        if number_of_chunks is None:
            # finalizing interrupted (disconnected) recording, number of chunks is what we have
            number_of_chunks = len(self.recordings[self.active_recording_id]['chunks'])
            # don't ask for resend since the connection is lost
            ask_for_resend = False

        async with self.lock:
            logger.info(f"Finalizing recording, ID = {self.active_recording_id}")
            recording_valid = True

            # check if all chunks a saved and flushed
            for x in range(number_of_chunks):
                #logger.info(f"checking index = {x}")
                if x not in self.recordings[self.active_recording_id]['chunks']:
                    if ask_for_resend:
                        logger.info(f"Requesting resend for chunk with index = {x}")
                        await self.consumer.send_to_client({
                            'message_type': 'request_chunk',
                            'chunk_index': x
                        })
                    recording_valid = False

            if recording_valid:
                if total_chunks is None:
                    # finishing interrupted recording
                    self.recordings[self.active_recording_id]['status'] = RecordingStatus.INTERRUPTED_VERIFIED
                else:
                    self.recordings[self.active_recording_id]['status'] = RecordingStatus.VERIFIED
                return True
            else:
                return False

    async def add_chunk(self, recording_id, chunk_index, data) -> bool:
        """
        :param data: binary data to save
        :param chunk_index: the chunk index
        :param recording_id: the recording id
        :return: returns true if a chunk was processed and false if the chunk has already been processed
        """
        async with self.lock:
            logger.info(f"Adding chunk, recording_id = {recording_id} chunk_index = {chunk_index}")
            # validate recording_id and chunk_index
            if recording_id not in self.recordings:
                raise ValueError(f"Error adding chunk, no such recording ID: {recording_id}!")
            if not self.validate_chunk_index(chunk_index):
                raise ValueError(f"Error adding chunk, bad chunk index: {chunk_index}!")
            if self.recordings[recording_id]['status'] != 'active':
                logger.info(f"Received chunk for finished recording - recording_id = {recording_id} chunk_index = {chunk_index}")
                return False
            index = int(chunk_index)
            if index in self.recordings[recording_id]['chunks']:
                # chunk already processed
                logger.info(f"Chunk is already processed, chunk_index = {index}")
                return False

            new_chunk = {
                'index': index,
                'timestamp': datetime.datetime.now(),
                'flushed': False,
                'data': data
            }

            # save chunk
            self.recordings[recording_id]['chunks'][index] = new_chunk

            # run file assembly code
            await self.assemble_audio_file()
            return True

    """
    Assemble as much of the file as possible.
    Work from flushed_index up to in-order chunks that are ready to be assembled
    """
    async def assemble_audio_file(self):
        if self.recordings[self.active_recording_id]['flushed_index'] is None:
            # nothing has been written
            if 0 in self.recordings[self.active_recording_id]['chunks']:
                # we have received the first chunk
                logger.info("Writing the first chunk.")
                # save data to file
                with open(self.recordings[self.active_recording_id]['recording_file_path'], "wb") as f:
                    f.write(self.recordings[self.active_recording_id]['chunks'][0]['data'])
                # remove data from memory
                self.recordings[self.active_recording_id]['chunks'][0]['flushed'] = True
                self.recordings[self.active_recording_id]['chunks'][0]['data'] = {}
                # update flushed index
                self.recordings[self.active_recording_id]['flushed_index'] = 0
            else:
                # first chunk not received, cannot write anything, ask for re-send of first chunk
                logger.info("Requesting re-send of first chunk.")
                await self.consumer.send_to_client({
                    'message_type': 'request_chunk',
                    'chunk_index': 0
                })
                return
        while self.recordings[self.active_recording_id]['flushed_index'] + 1 < len(self.recordings[self.active_recording_id]['chunks']):
            next_in_order_chunk = self.recordings[self.active_recording_id]['flushed_index'] + 1
            # check if the next in-order chunk is available
            if next_in_order_chunk in self.recordings[self.active_recording_id]['chunks']:
                logger.info(f"Writing chunk with index = {next_in_order_chunk}")
                data_to_write = self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['data']

                # write the audio data to file
                with open(self.recordings[self.active_recording_id]['recording_file_path'], "ab") as f:
                    f.write(data_to_write)

                # remove data from memory
                self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['flushed'] = True
                self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['data'] = {}
                # update flushed index
                self.recordings[self.active_recording_id]['flushed_index'] = next_in_order_chunk
            else:
                # if not, request re-send and break from the while loop, we cannot write anymore chunks
                logger.info(f"Requesting re-send for chunk with index = {next_in_order_chunk}")
                await self.consumer.send_to_client({
                    'message_type': 'request_chunk',
                    'chunk_index': next_in_order_chunk
                })
                break

    def get_file_path(self, recording_id) -> str:
        return self.recordings[recording_id]['recording_file_path']

    def get_recording_dir_path(self, recording_id) -> str:
        return self.recordings[recording_id]['recording_path']

    def get_file_size(self, recording_id) -> int:
        return os.path.getsize(self.recordings[recording_id]['recording_file_path'])

    def get_active_recording_id(self) -> int:
        return self.active_recording_id

    def is_active_recording(self, recording_id) -> bool:
        return recording_id in self.recordings and self.recordings[recording_id]['status'] == 'active'

    def get_recording_status(self, recording_id):
        if recording_id in self.recordings:
            return self.recordings[recording_id]['status']
        else:
            return 'Recording ID not found'

    def set_recording_status(self, recording_id, status: RecordingStatus):
        if recording_id in self.recordings:
            logger.info(f"Setting recoding status for recording ID: {recording_id} to {status.name}.")
            self.recordings[recording_id]['status'] = status
        else:
            logger.info(f"Cannot update status, no such recording ID: {recording_id}.")

    def get_dirname(self, title) -> str:
        # Not empty and does not contain any of these: <>:"/\|?* or whitespace at ends
        if bool(title) and not re.search(r'[<>:"/\\|?*\0]', title) and title == title.strip():
            return (str(self.active_recording_id) + "_" + title).replace(" ", "_")
        else:
            return str(self.active_recording_id)

    def set_active_recording_id(self, recording_id: int):
        # method used for setting up tests
        self.active_recording_id = recording_id

    def validate_chunk_index(self, index):
        try:
            value = int(index)
            return value >= 0
        except (ValueError, TypeError):
            return False

    async def get_recording_data(self) -> [dict]:
        async with self.lock:
            return self.recordings


def load_all_recordings_status(base_recordings_path: str) -> list[dict]:
    """
    Scans the base recordings directory to find all recordings and their
    finalization status from 'completion_log.txt' files.
    Args:
        base_recordings_path: The root directory where all recording subdirectories are stored
    Returns:
        A list of dictionaries, where each dictionary contains:
        - 'recording_id': The recording id
        - 'path': The full path to the recorded file.
        - 'status': The RecordingStatus enum member (e.g., RecordingStatus.VERIFIED).
    """
    logger.info(f"Scanning for recordings in: {base_recordings_path}")
    all_statuses = []

    try:
        # Iterate through all items in the base path to find directories
        for item_name in os.listdir(base_recordings_path):
            recording_dir = os.path.join(base_recordings_path, item_name)
            if not os.path.isdir(recording_dir):
                continue

            # Extract the title from the directory name (e.g., "1_My_Title" -> "My_Title")
            parts = item_name.split('_', 1)
            title = parts[1] if len(parts) > 1 else item_name
            log_path = os.path.join(recording_dir, "completion_log.txt")
            wav_path = os.path.join(recording_dir, title + ".wav")
            # get transcription file links
            transcription_dir = os.path.join(recording_dir, "TRANSCRIPTIONS")
            results = None
            if os.path.isdir(transcription_dir):
                #logger.info("Loading transcription file links.")
                results = prepare_results(transcription_dir)

            # Handle case where there is both a log and a wav file
            if os.path.isfile(log_path) and os.path.isfile(wav_path):
                try:
                    with open(log_path, "r") as f:
                        lines = f.readlines()
                        if len(lines) < 2:
                            logger.warning(f"Malformed completion log (too short): {log_path}")
                            continue
                        log_data = {}
                        for line in lines:
                            if ":" in line:
                                key, value = line.split(":", 1)
                                log_data[key.strip()] = value.strip()
                        recording_id = int(log_data["Recording ID"])
                        status_name = log_data["Status"]
                        status = RecordingStatus[status_name]  # Convert string back to enum
                        # if there is transcription start time and not transcription end time, then add start time
                        # this signals to client that there is an active transcription
                        transcription_start_time = None
                        if "Transcription start time" in log_data and "Transcription end time" not in log_data:
                            transcription_start_time = log_data["Transcription start time"]
                        all_statuses.append({"recording_id": recording_id,
                                             "recording_path": recording_dir,
                                             "file_path": wav_path,
                                             "status": status,
                                             "title": title,
                                             "transcription_start_time": transcription_start_time,
                                             "file_size": os.path.getsize(wav_path),
                                             "results": results})
                except (IndexError, TypeError, ValueError, KeyError) as e:
                    logger.error(f"Could not parse completion log {log_path}: {e}")
            elif os.path.isfile(wav_path):
                try:
                    # If the server disconnected during recording, then only the wav file is present
                    logger.info("Loading recording state for file with no completion log file")
                    recording_id = int(parts[0])
                    all_statuses.append({"recording_id": recording_id,
                                         "recording_path": recording_dir,
                                         "file_path": wav_path,
                                         "status": RecordingStatus.INTERRUPTED_NOT_VERIFIED,
                                         "title": title,
                                         "transcription_start_time": None,
                                         "file_size": None,
                                         "results": results})
                except (IndexError, TypeError, ValueError) as e:
                    logger.error(f"Could not parse recording ID from directory {recording_dir}: {e}")
            elif os.path.isfile(log_path):
                # handle case with only log file, exceptional error, cleanup directory
                os.remove(log_path)
                logger.error("The recording directory only has a log file, recording was interrupted before any data was written, cleaning.")
                clean_dir(recording_dir)
            else:
                # handle case with empty directory, exceptional error, cleanup directory
                logger.error("The recording directory is empty, cleaning.")
                clean_dir(recording_dir)
    except FileNotFoundError:
        logger.error(f"Recordings directory not found: {base_recordings_path}")
    return all_statuses

def clean_dir(path):
    try:
        # handle case with empty directory, exceptional error, cleanup directory
        os.removedirs(path)
    except OSError as e:
        logger.error("Directory could not be cleaned.", e)


class AudioDataConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.chunk_manager = AudioChunkManager(self)
        self.active_tasks = {} # {task_id: {details}}
        self.monitor_task = None
        self.transcription_group_name = "transcription_monitor_group"

    async def connect(self):
        await self.accept()
        # The group is used to be able to get transcription_completed messages across client re-connects
        # The group_add operation is idempotent
        await self.channel_layer.group_add(
            self.transcription_group_name,
            self.channel_name
        )

    async def disconnect(self, close_code):
        # this is called if the client disconnects, e.g. if the client browser window is closed or refreshed
        logger.info("Client disconnected.")
        if self.chunk_manager.is_active_recording(self.chunk_manager.get_active_recording_id()):
            # try to finalize the active recording
            # the recording state will be RecordingStatus.INTERRUPTED_VERIFIED or RecordingStatus.DATA_LOSS
            logger.info(f"Disconnect - try to finalize active recording, id: {self.chunk_manager.get_active_recording_id().__str__()}")
            asyncio.create_task(self._handle_finalize_recording())
        else:
            logger.info("Disconnect - no active recording to finalize.")

    async def receive(self, text_data=None, bytes_data=None):
        """
        control messages:
        start_recording
        stop_recording
        initialize
        start_transcription
        cancel_transcription

        :param text_data: control messages from the client
        :param bytes_data: binary audio data from the client
        :return:
        """
        if text_data is not None:
            data = json.loads(text_data)
            if data.get("type") == "control_message":
                logger.info("Control message received.")
                logger.info(data.get("message"))
                if data.get("message") == "start_recording":
                    recording_id = await self.chunk_manager.start_new_recording(data.get("parameter"))
                    # send back acknowledgment with recording_id
                    await self.send(text_data=json.dumps({
                        'message_type': 'ack_start_recording',
                        'recording_id': recording_id
                    }))
                elif data.get("message") == "stop_recording":
                    total_chunks = data.get("parameter")
                    logger.info(f"Received stop_recording. Total number of chunks in recording: {total_chunks}")
                    # Offload the finalization logic to a non-blocking background task
                    asyncio.create_task(self._handle_finalize_recording(total_chunks))
                elif data.get("message") == "initialize":
                    logger.info("Received initialize control message.")
                    recording_data = await self.chunk_manager.get_recording_data()
                    # RecordingStatus is not serializable by json.dumps
                    client_data = {}
                    for item in recording_data.values():
                        client_data[item['id']] = {
                            'recording_id': item['id'],
                            'title': item['title'],
                            'status': RecordingStatus(item['status']).value,
                            'recording_file_path': item['recording_file_path'],
                            "transcription_start_time": item['transcription_start_time'],
                            'file_size': item['file_size'],
                            'results': item['results']
                        }
                    await self.send(text_data=json.dumps({
                        'message_type': 'initialization_data',
                        'recordings': list(client_data.values())
                    }))
                elif data.get("message") == "start_transcription":
                    logger.info("Received start_transcription control message.")
                    param_object = data.get("parameter")
                    recording_id = param_object.get("recordingId")
                    model = param_object.get("model")
                    language = param_object.get("language")
                    logger.info(f"Transcription params: {recording_id}, {model}, {language}")
                    # start transcription task and send back the task id
                    await self.start_transcription_task(recording_id, model, language)
                elif data.get("message") == "cancel_transcription":
                    param_object = data.get("parameter")
                    task_id = param_object.get("taskId")
                    logger.info(f"Received cancel_transcription control message, taks ID: {task_id}")
                    await self.cancel_transcription_task(task_id)
                else:
                    logger.info("Unknown control message")
        elif bytes_data is not None:
            # handle binary audio chunks
            # bytes_data contains the full binary message received, the first 8 bytes contains the header
            header = bytes_data[:8]
            recording_id, chunk_index = struct.unpack(">II", header)  # Big-endian unsigned ints
            audio_data = bytes_data[8:]  # contains the audio chunk
            #save_audio_data_for_test(bytes_data, recording_id, chunk_index, True)
            #save_audio_data_for_test(audio_data, recording_id, chunk_index, False)
            logger.info(f"Byte data received - header data - Rec. ID = {recording_id} chunk_index = {chunk_index}")
            chunk_added = False
            try:
                chunk_added = await self.chunk_manager.add_chunk(recording_id, chunk_index, audio_data)
            except ValueError as e:
                logger.error(f"Error when adding chunk with Rec. ID = {recording_id} chunk_index = {chunk_index}", e)
            if chunk_added:
                await self.send(text_data=json.dumps({
                    'message_type': 'ack_chunk',
                    'chunk_index': chunk_index
                }))

    async def _handle_finalize_recording(self, total_chunks=None):
        """
        This method runs in the background to check for recording completeness
        without blocking the main receive loop.
        """
        recording_id = self.chunk_manager.get_active_recording_id()
        recording_finalized = False
        number_of_retries = 10
        success_status: RecordingStatus = RecordingStatus.VERIFIED
        send_info_to_client = True

        if total_chunks is None:
            # if we are verifying an interrupted recording (client disconnect)
            # don't expect additional chunks
            # don't send info to client and modify success flag
            number_of_retries = 1
            send_info_to_client = False
            success_status = RecordingStatus.INTERRUPTED_VERIFIED

        # method for writing completion log file
        def write_completion_log(status: RecordingStatus):
            """Writes a completion log file for the recording."""
            try:
                # We get the full .wav file path to derive the recording's directory.
                wav_path = self.chunk_manager.get_file_path(recording_id)
                if not wav_path:
                    logger.error(f"Cannot write completion log for recording {recording_id}: path is unknown.")
                    return

                recording_dir = os.path.dirname(wav_path)
                log_path = os.path.join(recording_dir, "completion_log.txt")
                timestamp_finalized = datetime.datetime.now(datetime.timezone.utc).isoformat()

                os.makedirs(recording_dir, exist_ok=True)
                with open(log_path, "w") as f:
                    f.write(f"Recording ID: {recording_id}\n")
                    f.write(f"Status: {status.name}\n")
                    f.write(f"Completion time: {timestamp_finalized}\n")
                logger.info(f"Wrote completion log for recording {recording_id} with status {status.name}")
            except Exception as e:
                logger.error(f"Failed to write completion log for recording {recording_id}: {e}")

        # try to verify file, and request resends if needed
        # try a number of times, and send an error message if not successful
        for i in range(number_of_retries):
            if total_chunks is not None:
                recording_finalized = await self.chunk_manager.finalize_active_recording(int(total_chunks))
            else:
                recording_finalized = await self.chunk_manager.finalize_active_recording()
            if recording_finalized:
                logger.info("Recording has been finalized.")
                break
            else:
                if total_chunks is not None:
                    # only sleep for normal finalization (not when handling interrupted recordings)
                    logger.info("Recording has not been finalized, sleeping for one second.")
                    await asyncio.sleep(1)
        if recording_finalized:
            # write a log file indicating successful verification
            await asyncio.to_thread(write_completion_log, success_status)
            # send back file info (and ETA for transcription)
            logger.info("Recording finalized.")
            if send_info_to_client:
                logger.info("Sending file info to client.")
                await self.send_finalization_data(recording_id, success_status)
        else:
            # write a log file indicating possible data loss
            self.chunk_manager.set_recording_status(recording_id, RecordingStatus.DATA_LOSS)
            await asyncio.to_thread(write_completion_log, RecordingStatus.DATA_LOSS)
            # send back file info (and ETA for transcription)
            logger.info("Recording could not be finalized within timeout.")
            if send_info_to_client:
                logger.info("Sending file info to client.")
                await self.send_finalization_data(recording_id, RecordingStatus.DATA_LOSS)

    async def send_finalization_data(self, recording_id, status: RecordingStatus):
        path = self.chunk_manager.get_file_path(recording_id)
        size = self.chunk_manager.get_file_size(recording_id)
        await self.send(text_data=json.dumps({
            'message_type': 'recording_complete',
            'recording_id': recording_id,
            'completion_status': status.value,
            'path': path,
            'size': size
        }))

    async def send_to_client(self, json_object):
        await self.send(text_data=json.dumps(json_object))

    async def start_transcription_task(self, recording_id, model, language):
        # Start the server monitoring
        if self.monitor_task is None:
            logger.info("Starting server monitoring of transcription tasks.")
            self.monitor_task = asyncio.create_task(self._task_monitor(self.active_tasks))
        # Start the Celery task
        recording_dir_path = self.chunk_manager.get_recording_dir_path(recording_id)
        recording_file_path = self.chunk_manager.get_file_path(recording_id)
        # Get the file size
        size = None
        try:
            size = os.path.getsize(recording_file_path)
        except FileNotFoundError:
            logger.error(f"Error when starting transcription, nu such file path, recording ID: {recording_id}")
        task = transcription_task.delay(recording_dir_path, recording_file_path, model, language)
        # Store the task ID to monitor it
        task_id = task.id
        self.active_tasks[task_id] = {
            "recording_id": recording_id,
            "transcription_dir": os.path.join(recording_dir_path, "TRANSCRIPTIONS")
        }
        logger.info(f"Started transcription task {task_id} for recording {recording_id}")
        self.log_transcription_start(recording_id)
        # Send the task_id back to the client
        await self.send(text_data=json.dumps({
            "message_type": "transcription_started",
            "task_id": task_id,
            "recording_id": recording_id,
            "file_size": size
        }))

    async def cancel_transcription_task(self, task_id:str):
        if not task_id or task_id not in self.active_tasks:
            logger.warning(f"Received cancellation request for unknown or missing task_id: {task_id}")
            return
        logger.info(f"Requesting cancellation for task {task_id}")
        task_result = transcription_task.AsyncResult(task_id)
        task_result.abort()  # Abort the task
        # remove from active_tasks
        self.active_tasks.pop(task_id)

    async def _task_monitor(self, active_tasks: dict):
        try:
            while True:
                await asyncio.sleep(5) # Check every 5 second
                if not active_tasks:
                    logger.info("No active tasks to monitor. Stopping monitor.")
                    break # Exit the loop, which will end the task.
                # Iterate over a copy of the keys as the dictionary may change size
                for task_id in list(active_tasks.keys()):
                    result = transcription_task.AsyncResult(task_id)
                    if result.ready(): # The task has finished (successfully or not)
                        try:
                            task_info = active_tasks.pop(task_id)
                            logger.info(f"Task {task_id} for recording {task_info['recording_id']} finished with state: {result.state}")
                            self.log_transcription_end(task_info['recording_id'])
                            await self.channel_layer.group_send(
                                self.transcription_group_name,
                                {
                                    "type": "transcription_completed",  # This maps to the handler method
                                    "task_id": task_id,
                                    "recording_id": task_info['recording_id'],
                                    "state": result.state, # e.g., 'SUCCESS', 'FAILURE', 'REVOKED'
                                    "results": prepare_results(task_info["transcription_dir"])
                                }
                            )
                        except KeyError:
                            # Task was removed in another operation, just continue
                            pass
                    else:
                        logger.info(f"Transcription task {task_id} not ready yet.")
        finally:
            # This ensures the monitor task reference is cleared, so a new one can be started later.
            logger.info("Transcription task monitor has shut down.")
            self.monitor_task = None

    async def transcription_completed(self, event):
        """
        Handler for the 'transcription_completed' event sent to a group.
        Forwards the message to the client over the current WebSocket connection.
        """
        await self.send(text_data=json.dumps({
            "message_type": "transcription_completed",
            "task_id": event["task_id"],
            "recording_id": event["recording_id"],
            "state": event["state"],
            "results": event["results"]
        }))

    def log_transcription_start(self, recording_id: int):
        """Logs the start time of a transcription, clearing previous timestamps.
        Args:
            recording_id: The ID of the recording.
        """
        try:
            wav_path = self.chunk_manager.get_file_path(recording_id)
            if not wav_path:
                logger.error(f"Cannot log transcription start for {recording_id}: path is unknown.")
                return

            log_path = os.path.join(os.path.dirname(wav_path), "completion_log.txt")
            if not os.path.exists(log_path):
                logger.warning(f"Completion log for recording {recording_id} not found. Cannot log transcription start.")
                return

            with open(log_path, "r") as f:
                lines = f.readlines()

            timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
            start_key = "Transcription start time:"
            end_key = "Transcription end time:"

            # Remove any previous start/end time to handle re-transcription
            filtered_lines = [line for line in lines if not line.strip().startswith((start_key, end_key))]
            filtered_lines.append(f"{start_key} {timestamp}\n")

            with open(log_path, "w") as f:
                f.writelines(filtered_lines)
        except Exception as e:
            logger.error(f"Failed to log transcription start for {recording_id}: {e}")

    def log_transcription_end(self, recording_id: int):
        """Logs the end time of a transcription.
        Args:
            recording_id: The ID of the recording.
        """
        try:
            wav_path = self.chunk_manager.get_file_path(recording_id)
            if not wav_path:
                logger.error(f"Cannot log transcription end for {recording_id}: path is unknown.")
                return

            log_path = os.path.join(os.path.dirname(wav_path), "completion_log.txt")
            if not os.path.exists(log_path):
                logger.warning(f"Completion log for recording {recording_id} not found. Cannot log transcription end.")
                return

            timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

            with open(log_path, "a") as f:
                f.write(f"Transcription end time: {timestamp}\n")
        except Exception as e:
            logger.error(f"Failed to log transcription end for {recording_id}: {e}")


def prepare_results(transcription_dir: str) -> list[dict]:
    results = []
    if os.path.isdir(transcription_dir):
        # List the files in the output directory and construct the URLs
        for filename in os.listdir(transcription_dir):
            file_url = os.path.join(transcription_dir, filename)
            results.append({
                'file_name': filename,
                'file_url': file_url
            })
        results.sort(key=lambda x: x['file_name'])
    return results

def validate_linux_filename(title: str) -> str:
    """
    Validates and sanitizes a string to be suitable as a filename on a Linux system.

    This function performs two main actions:
    1.  Validates the title against critical Linux filename restrictions.
    2.  Sanitizes the title by replacing spaces with underscores.

    A valid Linux filename:
    - Must not contain the null character (\\0).
    - Must not contain the path separator (/).
    - Should not be exactly "." or "..", as these are reserved directory names.
    - Must not be an empty string.

    Args:
        title: The string to validate as a potential filename.

    Returns:
        A sanitized version of the `title` string with spaces replaced by
        underscores if it passes validation. Otherwise, returns the
        generic string "recording".
    """
    if not isinstance(title, str):
        # Handle cases where input is not a string, though type hints suggest it should be.
        return "recording"

    # 1. Check for empty string
    if not title:
        return "recording"

    # 2. Check for forbidden characters: null character and path separator
    if '\0' in title or '/' in title:
        return "recording"

    # 3. Check for reserved names (current and parent directory)
    if title == "." or title == "..":
        return "recording"

    # If all checks pass, sanitize spaces and return the valid filename
    return title.replace(' ', '_')

def get_recording_base_path() -> str:
    # check if there is a mounted directory in the UCloud work folder
    source_directory = settings.UCLOUD_DIRECTORY
    mounted_folder = False
    recording_base_dir = None
    for entry in os.scandir(source_directory):
        # Check if the entry is a directory
        if entry.is_dir():
            mounted_folder = True
            recording_base_dir = entry.path
            if entry.name == 'RECORDINGS':
                logger.info("Using existing RECORDINGS directory in UCloud mounted folder.")
                return entry.path + '/'
    if not mounted_folder:
        # no UCloud mounted folder, create recordings dir and return path to it
        logger.info("No UCloud mounted folder, creating RECORDINGS directory.")
        recording_path: str = os.path.join(settings.MEDIA_ROOT, 'RECORDINGS/')
        os.makedirs(recording_path, exist_ok=True)
        return recording_path
    else:
        # create RECORDINGS folder in UCloud folder
        logger.info("Creating/using RECORDINGS directory in UCloud mounted folder.")
        recording_path: str = os.path.join(recording_base_dir, 'RECORDINGS/')
        os.makedirs(recording_path, exist_ok=True)
        return recording_path

def save_audio_data_for_test(audio_data, recording_id, chunk_index, includes_header, directory="dictaphone/resources/test_chunks"):
    """
    Saves a chunk of audio data to a file for testing.
    includes_header: Is the transport header with recording_id and chunk_index included in the data
    The file will be named as: chunk_{recording_id}_{chunk_index}.raw
    or chunk_{recording_id}_{chunk_index}_header.raw
    """
    os.makedirs(directory, exist_ok=True)
    if includes_header:
        filename = f"chunk_{recording_id}_{chunk_index}_header.raw"
    else:
        filename = f"chunk_{recording_id}_{chunk_index}.raw"
    filepath = os.path.join(directory, filename)
    with open(filepath, "wb") as f:
        f.write(audio_data)
    logger.info(f"Saved chunk to {filepath}")