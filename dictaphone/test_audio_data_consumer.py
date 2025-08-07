from pathlib import Path

import pytest
from channels.testing import WebsocketCommunicator


from backend.asgi import application

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
async def test_audio_upload_and_finalize(audio_chunks):
    """
    Tests the full lifecycle of an audio recording upload via WebSocket:
    1. Connect and start a new recording.
    2. Upload all audio chunks and receive acknowledgments.
    3. Stop the recording.
    4. Receive the final confirmation that the recording is complete.
    5. Disconnect.
    """
    communicator = WebsocketCommunicator(application, "/ws/dictaphone/data/")
    connected, _ = await communicator.connect()
    assert connected, "Failed to connect to the WebSocket."

    # 1. Send 'start_recording' and get the recording_id
    await communicator.send_json_to({
        "type": "control_message",
        "message": "start_recording",
        "parameter": "My Test Recording"
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

    # 5. Disconnect
    await communicator.disconnect()

