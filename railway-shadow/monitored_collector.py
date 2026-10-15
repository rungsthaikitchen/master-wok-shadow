"""Optional collector launcher with a token-protected health endpoint.
Disabled by default. No checkout hooks, source writes, or alert delivery.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
import hmac
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

from monitor_ops import open_monitor, health


def check(filename, max_age):
    db = open_monitor(filename)
    try:
        return health(db, max_age=max_age)['state'] == 'HEALTHY'
    finally:
        db.close()


def handler(token, filename, child, max_age=180):
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError('HEALTH_TOKEN_REQUIRED')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not record request headers, paths or client addresses.

        def do_GET(self):
            if self.path != '/healthz':
                self.reply(404, 'NOT_FOUND')
                return
            authorization = self.headers.get('Authorization', '')
            if not hmac.compare_digest(authorization.encode(), ('Bearer ' + token).encode()):
                self.reply(401, 'UNAUTHORIZED')
                return
            try:
                healthy = child.poll() is None and check(filename, max_age)
            except Exception:
                healthy = False
            self.reply(200 if healthy else 503, 'HEALTHY' if healthy else 'UNHEALTHY')

        def reply(self, code, state):
            body = json.dumps({'state': state}).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


class Server(HTTPServer):
    # Bound each connection so an idle client cannot hold the only worker forever.
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(2)
        return connection, address


def main():
    if os.environ.get('MASTER_WOK_COLLECTOR_ENABLED') != 'true':
        print(json.dumps({'state': 'DISABLED'}), flush=True)
        return 0
    token = os.environ.get('MASTER_WOK_HEALTH_TOKEN', '')
    if len(token) < 32:
        raise ValueError('HEALTH_TOKEN_REQUIRED')
    filename = os.environ.get('MASTER_WOK_MONITOR_DB', '')
    if not Path(filename).is_absolute():
        raise ValueError('ABSOLUTE_MONITOR_DB_REQUIRED')
    port = int(os.environ.get('PORT', '8080'))
    max_age = int(os.environ.get('MASTER_WOK_HEALTH_MAX_AGE_SECONDS', '180'))
    if not 1 <= port <= 65535 or not 30 <= max_age <= 86400:
        raise ValueError('INVALID_HEALTH_CONFIGURATION')
    # Bind before spawning: a configuration/port failure starts no collector.
    class Starting:
        def poll(self): return 1
    server = Server(('0.0.0.0', port), handler(token, filename, Starting(), max_age))
    child = None
    stopped = False
    def stop(*args):
        nonlocal stopped
        stopped = True
    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        child = subprocess.Popen([sys.executable, str(Path(__file__).with_name('shadow_collector.py'))])
        server.RequestHandlerClass = handler(token, filename, child, max_age)
        server.timeout = 0.5
        while not stopped and child.poll() is None:
            server.handle_request()
        # Unexpected child exit, including exit zero, must fail the worker service.
        return 0 if stopped else 1
    finally:
        server.server_close()
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        for sig, prior in previous.items():
            signal.signal(sig, prior)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'state': 'UNHEALTHY', 'reason': 'MONITORED_COLLECTOR_FAILED'}), flush=True)
        raise SystemExit(1)
