import logging
from pathlib import Path
import zipfile
import os
import shutil
import tempfile

logger = logging.getLogger(__name__)

def safe_rename(old_name: str, new_name: str):
    source = Path(old_name)
    destination = Path(new_name)

    # 1. Check if source exists
    if not source.exists():
        logger.warning(f"Error renaming title: Source '{source}' not found.")
        raise ValueError(f"Error renaming title: Source '{source}' not found.")

    # 2. Check if destination already exists
    if destination.exists():
        logger.warning(f"Error renaming title: Destination '{destination}' already exists.")
        raise ValueError(f"Error renaming title: Destination '{destination}' already exists.")

    # 3. Perform the rename
    source.rename(destination) # this can raise OSError
    logger.info(f"Successfully renamed '{source}' to '{destination}'")

def rename_files(old_title: str, new_title: str, dir_path: str):
    directory = Path(dir_path)

    if not directory.is_dir():
        logger.warning(f"Directory not found: {dir_path}")
        return

    for path in directory.iterdir():
        if path.is_file() and old_title in path.name:
            new_filename = path.name.replace(old_title, new_title)
            new_path = directory / new_filename

            try:
                safe_rename(str(path), str(new_path))
            except (ValueError, OSError) as e:
                logger.warning(f"Failed to rename '{path.name}': {e}")

def rename_in_zip_file(old_title: str, new_title: str, zip_path: str):
    source_path = Path(zip_path)

    if not source_path.exists():
        logger.warning(f"Zip file not found: {zip_path}")
        return

    temp_zip_path = source_path.with_name(f"{source_path.name}.tmp")

    try:
        with zipfile.ZipFile(source_path, 'r') as in_zip, \
                zipfile.ZipFile(temp_zip_path, 'w') as out_zip:

            for info in in_zip.infolist():
                old_name = info.filename
                # Only rename the filename component, preserving directory structure
                if '/' in old_name:
                    head, tail = old_name.rsplit('/', 1)
                    new_tail = tail.replace(old_title, new_title)
                    new_name = f"{head}/{new_tail}"
                else:
                    new_name = old_name.replace(old_title, new_title)

                if old_name != new_name:
                    info.filename = new_name
                    logger.info(f"Renamed inside zip: '{old_name}' -> '{new_name}'")

                out_zip.writestr(info, in_zip.read(old_name))

        temp_zip_path.replace(source_path)
        logger.info(f"Successfully updated zip file: {zip_path}")

    except (zipfile.BadZipFile, OSError) as e:
        logger.warning(f"Failed to process zip file '{zip_path}': {e}")
        if temp_zip_path.exists():
            temp_zip_path.unlink()

def replace_title_in_log(old_title: str, new_title: str, file_path: str) -> None:
    """
    Reads a log file and replaces a specific title with a new one.

    The replacement is targeted and only occurs if the title is immediately
    followed by '.wav', ensuring other occurrences of the word are not changed.
    The operation is performed safely using a temporary file.

    Args:
        old_title: The existing title string to be replaced.
        new_title: The new title string to substitute.
        file_path: The path to the log file to process.
    """
    if not os.path.isfile(file_path):
        logger.warning(f"Error: The transcription log file '{file_path}' was not found or is not a regular file.")
        return

    # Construct the exact strings to find and replace to meet the criteria.
    find_string = f"{old_title}.wav"
    replace_string = f"{new_title}.wav"

    # Create a secure temporary file to write the changes to.
    temp_fd, temp_path = tempfile.mkstemp()

    try:
        with os.fdopen(temp_fd, 'w') as temp_file:
            with open(file_path, 'r') as source_file:
                # Read the source file line by line
                for line in source_file:
                    # Replace all occurrences in the current line and write to the temp file
                    modified_line = line.replace(find_string, replace_string)
                    temp_file.write(modified_line)

        # Copy the permission bits from the original file to the temp file
        shutil.copymode(file_path, temp_path)

        # Atomically replace the original file with the temporary one
        shutil.move(temp_path, file_path)

        logger.info(f"Successfully updated the transcription log file with the new title.")

    except Exception as e:
        # If any error occurs, clean up the temporary file
        os.remove(temp_path)
        logger.warning(f"There was an error updating the transcription log file: {e}")

def proces_transcription_data_for_title_rename(old_title: str, new_title: str, transcription_dir: str):
    if not os.path.isdir(transcription_dir):
        # no transcription data to proces
        return

    # 1) rename transcription files
    rename_files(old_title, new_title, transcription_dir)

    # 2) rename title in log file
    replace_title_in_log(old_title, new_title, os.path.join(transcription_dir, "transcribe.log"))

    # 3) rename files in zip file
    rename_in_zip_file(old_title, new_title, os.path.join(transcription_dir, "files.zip"))