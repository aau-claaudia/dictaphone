import os
import unittest
from pathlib import Path
from transcription_processor import trim_start

class TestSilenceHandling(unittest.TestCase):
    def setUp(self):
        current_path = Path(os.path.dirname(os.path.realpath(__file__)))
        self.file_path_silence = current_path / "resources" / "chunk_silence.wav"
        self.file_path_silence_2 = current_path / "resources" / "chunk_silence2.wav"
        self.file_path_leading_silence = current_path / "resources" / "chunk_leading_silence.wav"
        self.file_path_leading_silence_investigate = current_path / "resources" / "chunk_soft_speaking.wav"

    def test_silence_handling(self):
        print("Running audio handling tests...")

        file_name = trim_start(self.file_path_silence.as_posix(), -30)
        print(f"File name: {file_name}")
        self.assertIsNone(file_name)

        file_name = trim_start(self.file_path_silence_2.as_posix(), -30)
        print(f"File name: {file_name}")
        self.assertIsNone(file_name)

        file_name = trim_start(self.file_path_leading_silence.as_posix(), -30)
        print(f"File name: {file_name}")
        self.assertIsNotNone(file_name)

        # shows trim values in the console from sound file with low speaking
        trim_start(self.file_path_leading_silence_investigate.as_posix(), -50)
        trim_start(self.file_path_leading_silence_investigate.as_posix(), -40)
        trim_start(self.file_path_leading_silence_investigate.as_posix(), -35)
        trim_start(self.file_path_leading_silence_investigate.as_posix(), -30)
        trim_start(self.file_path_leading_silence_investigate.as_posix(), -25)
        trim_start(self.file_path_leading_silence_investigate.as_posix(), -20)
        trim_start(self.file_path_leading_silence_investigate.as_posix(), -15)