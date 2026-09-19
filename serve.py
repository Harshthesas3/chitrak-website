"""CHITRAK local server — Range-capable static host for the scroll-scrubbed hero.

Why this exists: `python -m http.server` ignores HTTP Range requests, and
Chrome's media pipeline can refuse to SEEK a video served without ranges.
Symptom: page looks perfect but the bike never changes frame.
Fix: serve with `python serve.py` (defaults to http://localhost:8000).

Usage:
    python serve.py [port]      # default 8000, serves this folder
"""
import http.server
import functools
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def send_head(self):
        path = self.translate_path(self.path.split("?")[0].split("#")[0])
        if not os.path.isfile(path):
            self.send_error(404, "File not found")
            return None
        size = os.path.getsize(path)
        ctype = self.guess_type(path)
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        f = open(path, "rb")
        if m:
            s = int(m.group(1)) if m.group(1) else 0
            e = int(m.group(2)) if m.group(2) else size - 1
            e = min(e, size - 1)
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Range", f"bytes {s}-{e}/{size}")
            self.send_header("Content-Length", str(e - s + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            f.seek(s)
            self.wfile.write(f.read(e - s + 1))
            f.close()
            return None
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return f

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), RangeHandler)
    print(f"CHITRAK serving {ROOT} at http://localhost:{PORT}  (Ctrl+C to stop)")
    srv.serve_forever()
