import unittest
import tempfile
import logging
from pathlib import Path
from .data_rename_util import safe_rename

class TestDataRenameUtil(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for each test
        self.test_dir = tempfile.TemporaryDirectory()
        self.test_path = Path(self.test_dir.name)

        # Suppress logging output during tests
        logging.getLogger('data_rename_util').setLevel(logging.CRITICAL)

    def tearDown(self):
        # Clean up the temporary directory
        self.test_dir.cleanup()

    def test_safe_rename_success(self):
        """Test that a file is successfully renamed when conditions are met."""
        source = self.test_path / "source.txt"
        destination = self.test_path / "destination.txt"

        # Create the source file
        source.touch()

        safe_rename(str(source), str(destination))

        self.assertFalse(source.exists(), "Source file should be removed.")
        self.assertTrue(destination.exists(), "Destination file should exist.")

    def test_safe_rename_source_missing(self):
        """Test that ValueError is raised if the source file does not exist."""
        source = self.test_path / "missing.txt"
        destination = self.test_path / "destination.txt"

        with self.assertRaises(ValueError):
            safe_rename(str(source), str(destination))

    def test_safe_rename_destination_exists(self):
        """Test that ValueError is raised if the destination file already exists."""
        source = self.test_path / "source.txt"
        destination = self.test_path / "existing.txt"

        source.touch()
        destination.touch()

        with self.assertRaises(ValueError):
            safe_rename(str(source), str(destination))
