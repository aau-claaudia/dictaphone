import os
import unittest
from pathlib import Path

class DummyConsumer:
    """A dummy consumer to capture request re-send messages sent by AudioChunkManager."""
    def __init__(self):
        self.sent_messages = []

    def send_to_client(self, msg):
        self.sent_messages.append(msg)

class TestAudioChunkManager(unittest.TestCase):
    def setUp(self):
        current_path = Path(os.path.dirname(os.path.realpath(__file__)))
        self.chunks_dir = current_path / "resources/test_chunks"
        self.reference_file = current_path / "resources/test_chunks/recording.wav"
        self.output_file = current_path / "resources/test_chunks/output.wav"
        self.consumer = DummyConsumer()
        from audio_data_consumer import AudioChunkManager
        self.manager = AudioChunkManager(self.consumer)
        self.recording_id = 1
        self.manager.recordings[self.recording_id] = {
            'id': self.recording_id,
            'created': None,
            'title': "test",
            'status': 'active',
            'flushed_index': None,
            'chunks': {},
            'recording_file_path': str(self.output_file)
        }

    def load_chunk(self, index):
        name = f"chunk_{self.recording_id}_{index}.raw"
        with open(self.chunks_dir / name, "rb") as f:
            return f.read()

    def compare_output_to_reference(self):
        with open(self.output_file, "rb") as f1, open(self.reference_file, "rb") as f2:
            self.assertEqual(f1.read(), f2.read())

    def test_in_order(self):
        # 1) All chunks in order
        for idx in range(5):
            data = self.load_chunk(idx)
            self.manager.add_chunk(self.recording_id, idx, data)
        self.compare_output_to_reference()

    def test_out_of_order(self):
        # 2) Chunks out of order
        order = [0, 2, 1, 4, 3]
        for idx in order:
            data = self.load_chunk(idx)
            self.manager.add_chunk(self.recording_id, idx, data)
        # Manager should request resend for chunk 1
        self.assertTrue(any(msg.get('chunk_index') == 1 for msg in self.consumer.sent_messages))
        self.compare_output_to_reference()

    def test_missing_and_resend(self):
        # 3) Leave out chunk 2, then resend it
        for idx in [0, 1, 3, 4]:
            data = self.load_chunk(idx)
            self.manager.add_chunk(self.recording_id, idx, data)
        # Manager should request resend for chunk 2
        self.assertTrue(any(msg.get('chunk_index') == 2 for msg in self.consumer.sent_messages))
        # Now supply chunk 2
        data = self.load_chunk(2)
        self.manager.add_chunk(self.recording_id, 2, data)
        self.compare_output_to_reference()

    def test_first_chunk_missing(self):
        # 4) Start with chunk 1, then supply chunk 0 after request
        for idx in [1, 2, 3, 4]:
            data = self.load_chunk(idx)
            self.manager.add_chunk(self.recording_id, idx, data)
        # Manager should request resend for chunk 0
        self.assertTrue(any(msg.get('chunk_index') == 0 for msg in self.consumer.sent_messages))
        # Now supply chunk 0
        data = self.load_chunk(0)
        self.manager.add_chunk(self.recording_id, 0, data)
        self.compare_output_to_reference()

if __name__ == "__main__":
    unittest.main()