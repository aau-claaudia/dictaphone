"""
This module creates an audit log test service.
The service captures and validates incoming JSON messages.

Run with:
    python3 audit_log_service_mock.py --127.0.0.1 --port PORT

Accepted messages are printed to the terminal and are also available from
curl -X GET http://127.0.0.1:PORT/messages for the lifetime of the process.
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MAX_BODY_BYTES = 1_000_000


def validate_payload(payload: Any) -> list[str]:
    """Return validation errors for the expected message schema.
    The audit log service can be called with messages like this example:
    curl -X POST http://127.0.0.1:PORT/append \
      -H "Content-Type: application/json" \
      -d '{
        "event": "RECORDING_STARTED",
        "message": "Recording started by user",
        "meta": {
          "recordingID": "12345"
        }
      }'
    """
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]

    errors = []
    expected_fields = {"event", "message", "meta"}
    unexpected_fields = sorted(set(payload) - expected_fields)
    missing_fields = sorted(expected_fields - set(payload))

    if missing_fields:
        errors.append(f"missing fields: {', '.join(missing_fields)}")
    if unexpected_fields:
        errors.append(f"unexpected fields: {', '.join(unexpected_fields)}")
    if "event" in payload and not isinstance(payload["event"], str):
        errors.append("event must be a string")
    if "message" in payload and not isinstance(payload["message"], str):
        errors.append("message must be a string")

    meta = payload.get("meta")
    if "meta" in payload and not isinstance(meta, dict):
        errors.append("meta must be a JSON object")

    return errors


class MessageProxyHandler(BaseHTTPRequestHandler):
    """HTTP handler that stores valid messages in memory."""

    messages: list[dict[str, Any]] = []

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8") + b"\n"
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/append":
            self._send_json(404, {"error": "not found"})
            return

        content_type = self.headers.get_content_type()
        if content_type != "application/json":
            self._send_json(415, {"error": "Content-Type must be application/json"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send_json(400, {"error": "invalid Content-Length"})
            return
        if content_length < 1 or content_length > MAX_BODY_BYTES:
            self._send_json(400, {"error": "invalid request body size"})
            return

        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "request body must be valid JSON"})
            return

        errors = validate_payload(payload)
        if errors:
            self._send_json(422, {"error": "invalid payload", "details": errors})
            return

        self.messages.append(payload)
        print(f"\nAccepted message #{len(self.messages)}:")
        print(json.dumps(payload, indent=2), flush=True)
        self._send_json(201, {"accepted": True, "index": len(self.messages) - 1})

    def do_GET(self) -> None:
        if self.path == "/messages":
            self._send_json(200, self.messages)
        else:
            self._send_json(404, {"error": "not found"})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.client_address[0]} - {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), MessageProxyHandler)
    print(f"Listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()