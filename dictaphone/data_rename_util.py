import logging
from pathlib import Path

logger = logging.getLogger(__name__)

def safe_rename(old_name: str, new_name: str):
    source = Path(old_name)
    destination = Path(new_name)

    # 1. Check if source exists
    if not source.exists():
        logger.error(f"Error renaming title: Source '{source}' not found.")
        raise ValueError(f"Error renaming title: Source '{source}' not found.")

    # 2. Check if destination already exists
    if destination.exists():
        logger.error(f"Error renaming title: Destination '{destination}' already exists.")
        raise ValueError(f"Error renaming title: Destination '{destination}' already exists.")

    # 3. Perform the rename
    source.rename(destination) # this can raise OSError
    logger.info(f"Successfully renamed '{source}' to '{destination}'")

def rename_files(old_title: str, new_title: str, dir_path: str):
    pass


def rename_in_zip_file(old_title: str, new_title: str, zip_path: str):
    # check if the file is empty before processing
    pass


def rename_transcribe_log_content(old_title: str, new_title: str, file_path: str):
    # check if the file exist before processing
    pass