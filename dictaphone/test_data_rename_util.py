import unittest
import tempfile
import logging
import zipfile
from pathlib import Path
from .data_rename_util import safe_rename, rename_files, rename_in_zip_file, replace_title_in_log

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

    def test_rename_files_success(self):
        """Test that rename_files correctly renames files matching the pattern."""
        file1 = self.test_path / "test_old_1.txt"
        file2 = self.test_path / "test_old_2.txt"
        file3 = self.test_path / "other_file.txt"

        file1.touch()
        file2.touch()
        file3.touch()

        rename_files("old", "new", str(self.test_path))

        self.assertFalse(file1.exists(), "Original file should be renamed.")
        self.assertFalse(file2.exists(), "Original file should be renamed.")
        self.assertTrue(file3.exists(), "Unmatched file should not be renamed.")
        self.assertTrue((self.test_path / "test_new_1.txt").exists())
        self.assertTrue((self.test_path / "test_new_2.txt").exists())

    def test_rename_files_collision(self):
        """Test that rename_files handles collisions gracefully (skips rename)."""
        source = self.test_path / "collision_old.txt"
        target = self.test_path / "collision_new.txt"

        source.touch()
        target.touch()

        # Should catch the ValueError internally and log a warning, not crash
        rename_files("old", "new", str(self.test_path))

        self.assertTrue(source.exists(), "Source file should remain on collision.")
        self.assertTrue(target.exists(), "Target file should remain.")

    def test_rename_in_zip_file_success(self):
        """Test that files inside a zip are correctly renamed."""
        zip_path = self.test_path / "test_archive.zip"

        # Create a zip file with test content
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("old_title_doc.txt", "content1")
            zf.writestr("folder/old_title_pic.png", "content2")
            zf.writestr("unchanged.txt", "content3")

        rename_in_zip_file("old_title", "new_title", str(zip_path))

        with zipfile.ZipFile(zip_path, 'r') as zf:
            names = zf.namelist()
            self.assertIn("new_title_doc.txt", names)
            self.assertIn("folder/new_title_pic.png", names)
            self.assertIn("unchanged.txt", names)
            self.assertNotIn("old_title_doc.txt", names)
            self.assertEqual(zf.read("new_title_doc.txt").decode(), "content1")

    def test_rename_in_zip_file_bad_zip(self):
        """Test that the function handles corrupted zip files gracefully."""
        bad_zip_path = self.test_path / "corrupt.zip"
        with open(bad_zip_path, "w") as f:
            f.write("This is not a valid zip file.")

        # Should catch zipfile.BadZipFile and log a warning, not crash
        rename_in_zip_file("old", "new", str(bad_zip_path))

    def test_rename_in_zip_empty_zip_file(self):
        """Test that the function correctly handles an empty zip file."""
        zip_path = self.test_path / "test_empty_archive.zip"

        # Create a zip file with test content
        with zipfile.ZipFile(zip_path, 'w') as zf:
            pass

        # Should not do anything and not crash
        rename_in_zip_file("old", "new", str(zip_path))

    def test_replace_title_in_log(self):
        """Tests the replace_title_in_log function with various scenarios."""
        # --- Test Case 1: Successful replacement in a file ---
        log_content = (
            "2026-01-19 10:48:07,563 - Starting Recording_6.wav duration: 7 seconds\n"
            "Some other line with Recording_6 but no extension.\n"
            "2026-01-19 10:48:13,046 - Processed Recording_6.wav it took 5 seconds\n"
        )
        expected_content = (
            "2026-01-19 10:48:07,563 - Starting Final_Take_01.wav duration: 7 seconds\n"
            "Some other line with Recording_6 but no extension.\n"
            "2026-01-19 10:48:13,046 - Processed Final_Take_01.wav it took 5 seconds\n"
        )
        log_file = self.test_path / "test1.log"
        log_file.write_text(log_content)

        replace_title_in_log("Recording_6", "Final_Take_01", str(log_file))

        self.assertEqual(log_file.read_text(), expected_content)

        # --- Test Case 2: No occurrences to replace ---
        log_content_no_match = "No matching titles here.\nAnother line.\n"
        log_file_no_match = self.test_path / "test2.log"
        log_file_no_match.write_text(log_content_no_match)

        replace_title_in_log("Recording_6", "Final_Take_01", str(log_file_no_match))

        self.assertEqual(log_file_no_match.read_text(), log_content_no_match)

        # --- Test Case 3: File not found ---
        # The function should log a warning and not crash.
        non_existent_file = self.test_path / "non_existent.log"
        replace_title_in_log("Recording_6", "Final_Take_01", str(non_existent_file))

        # --- Test Case 4: Empty file ---
        empty_file = self.test_path / "empty.log"
        empty_file.touch()
        replace_title_in_log("Recording_6", "Final_Take_01", str(empty_file))
        self.assertEqual(empty_file.read_text(), "")