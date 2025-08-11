from pathlib import Path
import asyncio
import pytest
from channels.testing import WebsocketCommunicator
from backend.asgi import application
from dictaphone.audio_data_consumer import AudioChunkManager, RecordingStatus
import os

# --- Test Configuration ---
# Integration test that tests the overall functionality of the AudioDataConsumer including correct handling of headers
# The total number of test data chunks to upload.
NUM_CHUNKS = 5
# Location of test files, raw data files including headers
TEST_DATA_DIR = Path(__file__).parent / "resources" / "test_chunks"

@pytest.fixture
def audio_chunks():
    """
    A pytest fixture that loads the raw binary audio chunks from files.
    It assumes the test data files are named chunk_0.bin, chunk_1.bin, etc.
    and that each file contains the complete message (header + audio data).
    """
    chunks = []
    if not TEST_DATA_DIR.exists():
        pytest.fail(f"Test data directory not found: {TEST_DATA_DIR}")

    for i in range(NUM_CHUNKS):
        file_path = TEST_DATA_DIR / f"chunk_1_{i}_header.raw"
        if not file_path.exists():
            pytest.fail(f"Test data file not found: {file_path}")
        chunks.append(file_path.read_bytes())
    return chunks

@pytest.mark.asyncio
async def test_audio_upload_and_finalize(audio_chunks, monkeypatch):
    """
    Tests the full lifecycle of an audio recording upload via WebSocket:
    1. Connect and start a new recording.
    2. Upload all audio chunks and receive acknowledgments.
    3. Stop the recording.
    4. Receive the final confirmation that the recording is complete.
    5. Disconnect.
    """
    # To ensure the test runs in a clean, isolated environment, we patch the
    # AudioChunkManager's initializer. This uses the `load_data_from_server`
    # flag you added to prevent the test from loading pre-existing recording
    # data from the server, which could interfere with test assertions.
    original_init = AudioChunkManager.__init__

    def mock_init(self, consumer, load_data_from_server=True):
        # Force load_data_from_server to be False for all test instantiations.
        original_init(self, consumer, load_data_from_server=False)

    monkeypatch.setattr(AudioChunkManager, "__init__", mock_init)

    communicator = WebsocketCommunicator(application, "/ws/dictaphone/data/")
    connected, _ = await communicator.connect()
    assert connected, "Failed to connect to the WebSocket."

    # 1. Send 'start_recording' and get the recording_id
    await communicator.send_json_to({
        "type": "control_message",
        "message": "start_recording",
        "parameter": "Verified normal test recording"
    })
    response = await communicator.receive_json_from()
    assert response.get("message_type") == "ack_start_recording"
    assert "recording_id" in response

    # 2. Send all audio chunks
    for i, chunk_data in enumerate(audio_chunks):
        await communicator.send_to(bytes_data=chunk_data)
        response = await communicator.receive_json_from()
        assert response.get("message_type") == "ack_chunk"
        assert response.get("chunk_index") == i

    # 3. Send 'stop_recording'
    await communicator.send_json_to({
        "type": "control_message",
        "message": "stop_recording",
        "parameter": NUM_CHUNKS
    })

    # 4. Wait for the final 'recording_complete' message. This may take a few seconds.
    final_response = await communicator.receive_json_from(timeout=15)
    assert final_response.get("message_type") == "recording_complete"
    assert "path" in final_response
    assert "size" in final_response
    assert "completion_status" in final_response
    assert final_response['completion_status'] == 'VERIFIED'

    # 5. Disconnect
    await communicator.disconnect()

@pytest.mark.asyncio
async def test_disconnect_during_upload_finalize_recording(audio_chunks, monkeypatch):
    """
    Tests that if a client disconnects mid-upload, the consumer correctly
    identifies the interruption and finalizes the recording with the data
    it has received so far.
    """
    # We need to inspect the AudioChunkManager after the consumer is gone.
    # This list will hold the instance created by our mocked __init__.
    manager_holder = []
    original_init = AudioChunkManager.__init__

    def mock_init(self, consumer, load_data_from_server=True):
        # Use the original __init__ but ensure it's a clean slate.
        original_init(self, consumer, load_data_from_server=False)
        # Store the instance so the test can access it later.
        manager_holder.append(self)

    monkeypatch.setattr(AudioChunkManager, "__init__", mock_init)

    communicator = WebsocketCommunicator(application, "/ws/dictaphone/data/")
    connected, _ = await communicator.connect()
    assert connected, "Failed to connect to the WebSocket."

    # 1. Start a new recording and capture the ID.
    await communicator.send_json_to({
        "type": "control_message",
        "message": "start_recording",
        "parameter": "Interrupted Test Recording"
    })
    response = await communicator.receive_json_from()
    assert response.get("message_type") == "ack_start_recording"
    recording_id = response.get("recording_id")
    assert recording_id is not None

    # 2. Send a few chunks, but not all of them, to simulate an interruption.
    num_chunks_to_send = 2
    for i in range(num_chunks_to_send):
        await communicator.send_to(bytes_data=audio_chunks[i])
        ack = await communicator.receive_json_from()
        assert ack.get("chunk_index") == i

    # 3. Abruptly disconnect the client, triggering the `disconnect` logic.
    await communicator.disconnect()

    # The `disconnect` method spawns a background task. We wait for it to run.
    await asyncio.sleep(0.5)

    # 4. Verify the outcome on the server side by inspecting the manager.
    assert len(manager_holder) == 1, "AudioChunkManager was not instantiated."
    manager = manager_holder[0]
    final_status = manager.get_recording_status(recording_id)
    assert final_status == RecordingStatus.INTERRUPTED_VERIFIED

@pytest.mark.asyncio
async def test_disconnect_during_upload_finalize_recording_detect_data_loss(audio_chunks, monkeypatch):
    """
    Tests that if a client disconnects mid-upload, the consumer correctly
    identifies the interruption and detects that a chunk is missing during finalization
    """
    # We need to inspect the AudioChunkManager after the consumer is gone.
    # This list will hold the instance created by our mocked __init__.
    manager_holder = []
    original_init = AudioChunkManager.__init__

    def mock_init(self, consumer, load_data_from_server=True):
        # Use the original __init__ but ensure it's a clean slate.
        original_init(self, consumer, load_data_from_server=False)
        # Store the instance so the test can access it later.
        manager_holder.append(self)

    monkeypatch.setattr(AudioChunkManager, "__init__", mock_init)

    communicator = WebsocketCommunicator(application, "/ws/dictaphone/data/")
    connected, _ = await communicator.connect()
    assert connected, "Failed to connect to the WebSocket."

    # 1. Start a new recording and capture the ID.
    await communicator.send_json_to({
        "type": "control_message",
        "message": "start_recording",
        "parameter": "Interrupted Test Recording with data loss"
    })
    response = await communicator.receive_json_from()
    assert response.get("message_type") == "ack_start_recording"
    recording_id = response.get("recording_id")
    assert recording_id is not None

    # 2. Send 4 chunks, but not the second
    num_chunks_to_send = 4
    for i in range(num_chunks_to_send):
        if i==2:
            # simulate data loss
            continue
        await communicator.send_to(bytes_data=audio_chunks[i])
        if i>2:
            resend = await communicator.receive_json_from()
            assert resend.get("chunk_index") == 2
        ack = await communicator.receive_json_from()
        assert ack.get("chunk_index") == i

    # 3. Abruptly disconnect the client, triggering the `disconnect` logic.
    await communicator.disconnect()

    # The `disconnect` method spawns a background task. We wait for it to run.
    await asyncio.sleep(0.5)

    # 4. Verify the outcome on the server side by inspecting the manager.
    assert len(manager_holder) == 1, "AudioChunkManager was not instantiated."
    manager = manager_holder[0]
    final_status = manager.get_recording_status(recording_id)
    assert final_status == RecordingStatus.DATA_LOSS
