import json
import struct
from channels.generic.websocket import AsyncWebsocketConsumer
import io
import shutil
import threading
import datetime
import os
import re
import wave
from django.conf import settings

class AudioChunkManager:
    def __init__(self, consumer):
        self.consumer = consumer
        self.active_recording_id = 1
        self.recordings = {}
        self.lock = threading.Lock()  # Lock to ensure thread-safe properties

    def start_new_recording(self, title) -> str:
        with self.lock:
            print(f"Starting new recording, ID = {self.active_recording_id}")
            if self.active_recording_id in self.recordings:
                raise ValueError("Error when creating new recording, ID is already used!")

            # setup metadata structure for the recording
            self.recordings[self.active_recording_id] = {
                'id': self.active_recording_id,
                'created': datetime.datetime.now(),
                'title': title,
                'status': 'active',
                'wav_header': None,
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

    def finalize_active_recording(self):
        with self.lock:
            print(f"Finalizing recording, ID = {self.active_recording_id}")
            # TODO:
            # increment recording_id after completed recording
            self.active_recording_id = self.active_recording_id + 1


    def add_chunk(self, recording_id, chunk_index, data):
        with self.lock:
            print(f"Adding chunk, recording_id = {recording_id} chunk_index = {chunk_index}")
            # validate recording_id and chunk_index
            if recording_id not in self.recordings:
                raise ValueError(f"Error adding chunk, no such recording ID: {recording_id}!")
            if not self.validate_chunk_index(chunk_index):
                raise ValueError(f"Error adding chunk, bad chunk index: {chunk_index}!")

            index = int(chunk_index)
            new_chunk = {
                'index': index,
                'timestamp': datetime.datetime.now(),
                'flushed': False
            }

            if index == 0:
                # if first chunk extract wav header
                print("Extracting wav header.")
                wav_header = data[:44]
                self.recordings[recording_id]['wav_header'] = wav_header
                new_chunk['data'] = data
                new_chunk['has_header'] = True
            else:
                # add header if possible
                if 'wav_header' in self.recordings[recording_id]:
                    print("Adding wav header to chunk.")
                    new_chunk['data'] = self.recordings[recording_id]['wav_header'] + data
                    new_chunk['has_header'] = True
                else:
                    print("Adding chunk without header.")
                    new_chunk['data'] = data
                    new_chunk['has_header'] = False

            # save chunk
            self.recordings[recording_id]['chunks'][index] = new_chunk

            # run file assembly code
            self.assemble_audio_file()

    """
    Assemble as much of the file as possible.
    Work from flushed_index up to in-order chunks that are ready to be assembled
    """
    def assemble_audio_file(self):
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
                self.consumer.send_to_client({
                    'message_type': 'request_chunk',
                    'chunk_index': 0
                })
                return
        while self.recordings[self.active_recording_id]['flushed_index'] + 1 < len(self.recordings[self.active_recording_id]['chunks']):
            next_in_order_chunk = self.recordings[self.active_recording_id]['flushed_index'] + 1
            # check if the next in-order chunk is available
            if next_in_order_chunk in self.recordings[self.active_recording_id]['chunks']:
                print(f"Writing chunk with index = {next_in_order_chunk}")
                # make backup of data file (overwrite existing backup)
                backup_file_path = self.recordings[self.active_recording_id]['recording_file_path'] + '_backup.wav'
                shutil.copyfile(self.recordings[self.active_recording_id]['recording_file_path'], backup_file_path)
                data_to_write = None
                # insert wav header if needed
                if not self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['has_header']:
                    data_to_write = (self.recordings[self.active_recording_id]['wav_header'] +
                                     self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['data'])
                else:
                    data_to_write = self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['data']
                # write the audio data to file
                audio_data = []
                # append existing data
                with wave.open(self.recordings[self.active_recording_id]['recording_file_path'], "rb") as w:
                    audio_data.append([w.getparams(), w.readframes(w.getnframes())])
                # append new data
                with wave.open(io.BytesIO(data_to_write), "rb") as w:
                    audio_data.append([w.getparams(), w.readframes(w.getnframes())])
                # replace working file
                with wave.open(self.recordings[self.active_recording_id]['recording_file_path'], "wb") as output:
                    output.setparams(audio_data[0][0])
                    for params, frames in audio_data:
                        output.writeframes(frames)
                # remove data from memory
                self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['flushed'] = True
                self.recordings[self.active_recording_id]['chunks'][next_in_order_chunk]['data'] = {}
                # update flushed index
                self.recordings[self.active_recording_id]['flushed_index'] = next_in_order_chunk
            else:
                # if not, request re-send and break from the while loop, we cannot write anymore chunks
                print(f"Requesting re-send for chunk with index = {next_in_order_chunk}")
                self.consumer.send_to_client({
                    'message_type': 'request_chunk',
                    'chunk_index': next_in_order_chunk
                })
                break

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
        # TODO: server disconnect? how to handle?
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
                    recording_id = self.chunk_manager.start_new_recording(data.get("parameter"))
                    # send back acknowledgment with recording_id
                    await self.send(text_data=json.dumps({
                        'message_type': 'ack_start_recording',
                        'recording_id': recording_id
                    }))
                elif data.get("message") == "stop_recording":
                    # TODO:
                    pass
                else:
                    print("Unknown control message")
        elif bytes_data is not None:
            # handle binary audio chunks
            # bytes_data contains the full binary message received, the first 8 bytes contains the header
            header = bytes_data[:8]
            recording_id, chunk_index = struct.unpack(">II", header)  # Big-endian unsigned ints
            audio_data = bytes_data[8:]  # contains the audio chunk
            print(f"Byte data received - header data - Rec. ID = {recording_id} chunk_index = {chunk_index}")
            # TODO: handle ValueError (add_chunk), logging
            self.chunk_manager.add_chunk(recording_id, chunk_index, audio_data)
            print("Chunk index before sending ack: " + str(chunk_index))
            await self.send(text_data=json.dumps({
                'message_type': 'ack_chunk',
                'chunk_index': chunk_index
            }))

    async def send_to_client(self, json_object):
        await self.send(text_data=json.dumps(json_object))
