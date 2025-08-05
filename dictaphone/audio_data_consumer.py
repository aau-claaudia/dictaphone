import json
import struct
import asyncio

from channels.generic.websocket import AsyncWebsocketConsumer
import datetime
import os
import re
from django.conf import settings

class AudioChunkManager:
    def __init__(self, consumer):
        self.consumer = consumer
        self.active_recording_id = 1
        self.recordings = {}
        self.lock = asyncio.Lock() # Lock for async operations

    async def start_new_recording(self, title) -> int:
        async with self.lock:
            print(f"Starting new recording, ID = {self.active_recording_id}")
            if self.active_recording_id in self.recordings:
                raise ValueError("Error when creating new recording, ID is already used!")

            # setup metadata structure for the recording
            self.recordings[self.active_recording_id] = {
                'id': self.active_recording_id,
                'created': datetime.datetime.now(),
                'title': title,
                'status': 'active',
                'flushed_index': None, # how much of the file has been assembled
                'chunks': {}
            }
            # create directory for saving data
            recording_dir_name = self.get_dirname(title)
            path = 'RECORDINGS/' + recording_dir_name
            recording_path: str = os.path.join(settings.MEDIA_ROOT, path)
            os.makedirs(recording_path, exist_ok=True)
            recording_file_path: str = os.path.join(recording_path, "recording.wav")
            self.recordings[self.active_recording_id]['recording_path'] = recording_path
            self.recordings[self.active_recording_id]['recording_file_path'] = recording_file_path

            return self.active_recording_id

    async def finalize_active_recording(self, total_chunks) -> bool:
        async with self.lock:
            print(f"Finalizing recording, ID = {self.active_recording_id}")
            recording_valid = True

            # check if all chunks a saved and flushed
            for x in range(total_chunks):
                #print(f"checking index = {x}")
                if x not in self.recordings[self.active_recording_id]['chunks']:
                    print(f"Requesting resend for chunk with index = {x}")
                    await self.consumer.send_to_client({
                        'message_type': 'request_chunk',
                        'chunk_index': x
                    })
                    recording_valid = False

            if recording_valid:
                # increment recording_id after completed recording
                self.recordings[self.active_recording_id]['status'] = 'finished'
                self.active_recording_id = self.active_recording_id + 1
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
            print(f"Adding chunk, recording_id = {recording_id} chunk_index = {chunk_index}")
            # validate recording_id and chunk_index
            if recording_id not in self.recordings:
                raise ValueError(f"Error adding chunk, no such recording ID: {recording_id}!")
            if not self.validate_chunk_index(chunk_index):
                raise ValueError(f"Error adding chunk, bad chunk index: {chunk_index}!")
            if self.recordings[recording_id]['status'] == 'finished':
                print(f"Received chunk for finished recording - recording_id = {recording_id} chunk_index = {chunk_index}")
                return False
            index = int(chunk_index)
            if index in self.recordings[recording_id]['chunks']:
                # chunk already processed
                print(f"Chunk is already processed, chunk_index = {index}")
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
                print("Writing the first chunk.")
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
                print("Requesting re-send of first chunk.")
                await self.consumer.send_to_client({
                    'message_type': 'request_chunk',
                    'chunk_index': 0
                })
                return
        while self.recordings[self.active_recording_id]['flushed_index'] + 1 < len(self.recordings[self.active_recording_id]['chunks']):
            next_in_order_chunk = self.recordings[self.active_recording_id]['flushed_index'] + 1
            # check if the next in-order chunk is available
            if next_in_order_chunk in self.recordings[self.active_recording_id]['chunks']:
                print(f"Writing chunk with index = {next_in_order_chunk}")
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
                print(f"Requesting re-send for chunk with index = {next_in_order_chunk}")
                await self.consumer.send_to_client({
                    'message_type': 'request_chunk',
                    'chunk_index': next_in_order_chunk
                })
                break

    def get_file_path(self, recording_id) -> str:
        return self.recordings[recording_id]['recording_file_path']

    def get_file_size(self, recording_id) -> int:
        return os.path.getsize(self.recordings[recording_id]['recording_file_path'])

    def get_active_recording_id(self) -> int:
        return self.active_recording_id

    def get_dirname(self, title) -> str:
        # Not empty and does not contain any of these: <>:"/\|?* or whitespace at ends
        if bool(title) and not re.search(r'[<>:"/\\|?*\0]', title) and title == title.strip():
            return (str(self.active_recording_id) + "_" + title).replace(" ", "_")
        else:
            return str(self.active_recording_id)

    def validate_chunk_index(self, index):
        try:
            value = int(index)
            return value >= 0
        except (ValueError, TypeError):
            return False


class AudioDataConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.chunk_manager = AudioChunkManager(self)

    async def connect(self):
        # TODO: authentication
        await self.accept()

    async def disconnect(self, close_code):
        # TODO: looks like this is called if the client disconnects, e.g. if the client browser window is closed
        print("disconnect")

    async def receive(self, text_data=None, bytes_data=None):
        """
        control messages:
        {
            'type': "control_message",
            'message': "start_recording"
        }
        {
            'type': "control_message",
            'message': "stop_recording"
        }
        :param text_data: control messages from the client
        :param bytes_data: binary audio data from the client
        :return:
        """
        if text_data is not None:
            data = json.loads(text_data)
            if data.get("type") == "control_message":
                print("Control message received.")
                print(data.get("message"))
                if data.get("message") == "start_recording":
                    # TODO: handle ValueError (start_new_recording), logging
                    recording_id = await self.chunk_manager.start_new_recording(data.get("parameter"))
                    # send back acknowledgment with recording_id
                    await self.send(text_data=json.dumps({
                        'message_type': 'ack_start_recording',
                        'recording_id': recording_id
                    }))
                elif data.get("message") == "stop_recording":
                    total_chunks = data.get("parameter")
                    print(f"Received stop_recording. Total number of chunks in recording: {total_chunks}")
                    # Offload the finalization logic to a non-blocking background task
                    asyncio.create_task(self._handle_finalize_recording(total_chunks))
                else:
                    print("Unknown control message")
        elif bytes_data is not None:
            # handle binary audio chunks
            # bytes_data contains the full binary message received, the first 8 bytes contains the header
            header = bytes_data[:8]
            recording_id, chunk_index = struct.unpack(">II", header)  # Big-endian unsigned ints
            audio_data = bytes_data[8:]  # contains the audio chunk
            #save_audio_data_for_test(bytes_data, recording_id, chunk_index, True)
            #save_audio_data_for_test(audio_data, recording_id, chunk_index, False)
            print(f"Byte data received - header data - Rec. ID = {recording_id} chunk_index = {chunk_index}")
            # TODO: handle ValueError (add_chunk), logging
            chunk_added = await self.chunk_manager.add_chunk(recording_id, chunk_index, audio_data)
            if chunk_added:
                await self.send(text_data=json.dumps({
                    'message_type': 'ack_chunk',
                    'chunk_index': chunk_index
                }))

    async def _handle_finalize_recording(self, total_chunks):
        """
        This method runs in the background to check for recording completeness
        without blocking the main receive loop.
        """
        recording_id = self.chunk_manager.get_active_recording_id()
        recording_finalized = False
        number_of_retries = 10
        # try to verify file, and request resends if needed
        # try a number of times, and send an error message if not successful
        for i in range(number_of_retries):
            recording_finalized = await self.chunk_manager.finalize_active_recording(int(total_chunks))
            if recording_finalized:
                print("Recording has been finalized.")
                break
            else:
                print("Recording has not been finalized, sleeping for one second.")
                await asyncio.sleep(1)
        if recording_finalized:
            # send back file info (and ETA for transcription)
            print("Recording finalized - sending file info to client.")
            path = self.chunk_manager.get_file_path(recording_id)
            size = self.chunk_manager.get_file_size(recording_id)
            await self.send(text_data=json.dumps({
                'message_type': 'recording_complete',
                'path': path,
                'size': size
            }))
        else:
            # TODO: finalize timeout, handle error here, send error message to client
            pass

    async def send_to_client(self, json_object):
        await self.send(text_data=json.dumps(json_object))


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
    print(f"Saved chunk to {filepath}")