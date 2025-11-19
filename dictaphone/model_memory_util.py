import math

from backend import settings
import logging
import torch

logger = logging.getLogger(__name__)

def calculate_model_memory() -> int:
    """
    Method for calculating the available memory for working with whisper models.

    Returns:
        The available memory in GB on the device that will be used for loading and working with whisper models.
    """
    try:
        if torch.cuda.is_available():
            gpu_memory = 0.0
            device_count = torch.cuda.device_count()
            logger.info(f"Found {device_count} CUDA-enabled GPU(s).")

            for i in range(device_count):
                # Total memory
                total_mem_gb = torch.cuda.get_device_properties(i).total_memory / (1024**3)
                logger.info(f"Total VRAM on device: {total_mem_gb:.2f} GB")
                gpu_memory += total_mem_gb

            logger.info("Available GPU memory for whisper models (floored): " + str(math.floor(gpu_memory)))
            return math.floor(gpu_memory)
        else:
            # use the number of machine RAM if there is no GPU available
            machine_memory = int(settings.MEMORY_IN_GIGS)
            logger.info("Available memory for whisper models: " + str(machine_memory))

            return machine_memory
    except Exception as e:
        logger.error("Error calculating available memory for whisper models - using default value, 16GB.")
        return 16

# A dictionary mapping Whisper model names to their required memory needs in GB.
WHISPER_MODELS = {
    "base": 1,
    "small": 2,
    "medium": 5,
    "large-v3": 10,
    "large-v3-turbo": 6,
}

def get_whisper_model_list() -> list:
    """
    Method for generating a list of whisper models that are available with the current memory availability.

    Returns:
        A list of whisper models. Models that require more VRAM than available
        are marked with "(not enough memory)".
    """
    available_memory = calculate_model_memory()
    return [
        f"{model} (not enough memory)" if mem_req > available_memory else model
        for model, mem_req in WHISPER_MODELS.items()
    ]

