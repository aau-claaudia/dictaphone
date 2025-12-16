from django.conf import settings
import logging
import torch

logger = logging.getLogger(__name__)

def calculate_available_memory() -> float:
    """
    Method for calculating the available memory for working with transcriptions.
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

            logger.info(f"Available GPU memory: {gpu_memory:.2f} GB")
            return gpu_memory
        else:
            # use the number of machine RAM if there is no GPU available
            machine_memory = float(settings.MEMORY_IN_GIGS)
            logger.info("Available memory: " + str(machine_memory) + " GB")
            return machine_memory
    except Exception as e:
        logger.error("Error calculating available memory - using default value, 16GB.")
        return 16.0
