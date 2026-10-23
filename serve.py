#!/usr/bin/env python3
"""scadshape web server.

Two modes:
  development (default)  SCADSHAPE_HOST:8790 (default 127.0.0.1; for the phone e.g. the Tailscale IP),
                         receives benchmarks and logs (below).
  public (SCADSHAPE_PUBLIC=1, the scadshape-public service)  127.0.0.1:8791 behind the Cloudflare tunnel:
                         static files only, strict CSP, no POST endpoints and no access log.

Serves dist/ and receives benchmark results from the web
version's "Benchmark" button (POST /api/bench → data/bench.jsonl) plus errors
and progress from the phone (POST /api/log → data/client.jsonl).

Precompressed files (x.gz next to x) are sent with Content-Encoding: gzip
when the browser supports it. Cache-Control: no-cache makes a rebuild
show up at once, while unchanged files give 304 (Last-Modified).
"""
import email.utils
import json
import os
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("SCADSHAPE_HOST", "127.0.0.1")
# Public mode (behind the Cloudflare tunnel): no POST endpoints, strict CSP, no access log.
PUBLIC = os.environ.get("SCADSHAPE_PUBLIC") == "1"
# 'unsafe-eval': the constraint solver planegcs (Emscripten/embind) creates functions with new Function;
# without it e.g. the redundant-dimension check fails silently. The page has no third-party content.
CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; "
    "manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)
PORT = int(os.environ.get("SCADSHAPE_PORT", "8790"))
BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("SCADSHAPE_ROOT", os.path.join(BASE, "dist"))
POST_LOGS = {
    "/api/bench": os.path.join(BASE, "data", "bench.jsonl"),
    "/api/log": os.path.join(BASE, "data", "client.jsonl"),
}
MAX_POST = 64 * 1024


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        if PUBLIC:
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def log_message(self, format, *args):
        if not PUBLIC:
            super().log_message(format, *args)

    def send_head(self):
        path = self.translate_path(self.path)
        gz = path + ".gz"
        if (
            os.path.isfile(path)
            and os.path.isfile(gz)
            and "gzip" in self.headers.get("Accept-Encoding", "")
        ):
            st = os.stat(gz)
            ims = self.headers.get("If-Modified-Since")
            if ims:
                try:
                    if int(st.st_mtime) <= email.utils.parsedate_to_datetime(ims).timestamp():
                        self.send_response(HTTPStatus.NOT_MODIFIED)
                        self.send_header("Vary", "Accept-Encoding")
                        self.end_headers()
                        return None
                except (TypeError, ValueError, IndexError, OverflowError):
                    pass
            f = open(gz, "rb")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
            self.send_header("Content-Length", str(st.st_size))
            self.send_header("Last-Modified", self.date_time_string(st.st_mtime))
            self.end_headers()
            return f
        return super().send_head()

    def do_POST(self):
        log_path = None if PUBLIC else POST_LOGS.get(self.path)
        if log_path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if not 0 < length <= MAX_POST:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return
        try:
            report = json.loads(self.rfile.read(length))
            if not isinstance(report, dict):
                raise ValueError
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        report["received"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        report["client"] = self.client_address[0]
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(report, ensure_ascii=False) + "\n")
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"scadshape: http://{HOST}:{PORT}/", flush=True)
    server.serve_forever()
