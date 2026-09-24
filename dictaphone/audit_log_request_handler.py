import requests
import logging
from backend import settings

logger = logging.getLogger(__name__)

def send_audit_event(event, message, meta):
    try:
        requests.post(
            settings.AUDIT_LOG_URL,
            json={
                "event": event,
                "message": message,
                "meta": meta,
            },
            timeout=(0.2, 0.2),
        )
    except requests.RequestException:
        logger.warning("Audit event could not be delivered.")