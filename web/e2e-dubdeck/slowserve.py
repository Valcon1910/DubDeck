"""Throttled static file server with Range support (test helper)."""
import os, re, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = sys.argv[1]
RATE = 1_000_000  # bytes/sec


class H(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.serve(head=True)

    def do_GET(self):
        self.serve()

    def serve(self, head=False):
        path = os.path.join(ROOT, os.path.basename(self.path.split("?")[0]))
        if not os.path.isfile(path):
            self.send_error(404); return
        size = os.path.getsize(path)
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        if m:
            start = int(m.group(1)); end = int(m.group(2) or end)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        if head:
            return
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(65536, left))
                    self.wfile.write(chunk)
                    left -= len(chunk)
                    time.sleep(len(chunk) / RATE)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", 8766), H).serve_forever()
