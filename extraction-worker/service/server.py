"""Small authenticated HTTP service intended behind Railway's HTTPS edge."""
from __future__ import annotations
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import signal
import threading
from urllib.parse import unquote, urlsplit
from .contracts import ProcessingError, canonical_url
from .jobs import Jobs, error_payload
from .uploads import MAX_BYTES


def configuration_ready():
    token = os.environ.get('REELTRIP_PROCESSOR_TOKEN', '')
    return bool(len(token) >= 32 and os.environ.get('OPENAI_API_KEY') and all(shutil.which(x) for x in ('ffmpeg', 'ffprobe', 'curl')))


def tiktok_configuration():
    # Configuration presence only, not a live provider request or approval claim.
    from travel_workflow.apify_tiktok import token_configured
    selected = os.environ.get('REELTRIP_TIKTOK_PROVIDER', 'tikwm')
    return {'provider': selected if selected in {'tikwm', 'apify'} else 'unconfigured',
            'configured': selected == 'tikwm' or (selected == 'apify' and token_configured())}


def authenticated(header, token):
    if not isinstance(header, str) or not token or len(token) < 32 or len(header) > 2048:
        return False
    return hmac.compare_digest(header.encode(), ('Bearer ' + token).encode())


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 20
    def __init__(self, address, jobs, *, ready=configuration_ready):
        self.jobs, self.ready = jobs, ready
        self.semaphore = threading.BoundedSemaphore(24)
        self.chat_slots = threading.BoundedSemaphore(2)
        self.upload_slots = threading.BoundedSemaphore(2)
        super().__init__(address, Handler)
    def process_request(self, request, client_address):
        if not self.semaphore.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.semaphore.release()
            raise
    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.semaphore.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'ReelTrip'
    sys_version = ''
    def setup(self):
        super().setup()
        self.connection.settimeout(15)
    def log_message(self, *_):
        pass  # No request URLs, tokens, IPs or provider exception text in logs.
    def parse_request(self):
        if not super().parse_request():
            return False
        lengths = self.headers.get_all('Content-Length', [])
        # Reject ambiguous framing before either authentication or job dispatch.
        # Railway terminates HTTP/2; this origin accepts one length-delimited request.
        if (self.headers.get_all('Transfer-Encoding') or len(lengths) > 1
                or len(self.headers.get_all('Authorization', [])) > 1
                or (lengths and (not lengths[0].isascii() or not lengths[0].isdigit()
                                 or len(lengths[0]) > 10))):
            self.close_connection = True
            self.respond(400, {'error': error_payload('invalid_request', 'Invalid request framing.')})
            return False
        return True
    def respond(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass
    def authorized(self):
        if authenticated(self.headers.get('Authorization'), os.environ.get('REELTRIP_PROCESSOR_TOKEN', '')):
            return True
        self.respond(401, {'error': error_payload('unauthorized', 'This request is not authorised.')})
        return False
    def do_GET(self):
        if self.path == '/health':
            self.respond(200, {'ok': True, 'ready': self.server.ready(), 'tiktok': tiktok_configuration()})
            return
        if not self.authorized():
            return
        if self.path.startswith('/v1/uploads/') or self.path.startswith('/v1/upload-jobs/'):
            self.upload_get()
            return
        if not self.path.startswith('/v1/jobs/'):
            self.respond(404, {'error': error_payload('not_found', 'This route does not exist.')})
            return
        try:
            self.respond(200, self.server.jobs.get(self.path[len('/v1/jobs/'):]))
        except ProcessingError as error:
            self.respond(404, {'error': error_payload(error.code, error.message, error.retryable)})
        except Exception:
            self.respond(503, {'error': error_payload('service_unavailable', 'Video analysis is temporarily unavailable.', True)})
    def do_POST(self):
        if not self.authorized():
            return
        if self.path == '/v1/chat':
            self.chat_request()
            return
        if self.path == '/v1/uploads' or self.path.startswith('/v1/uploads/'):
            self.upload_post()
            return
        if self.path != '/v1/jobs':
            self.respond(404, {'error': error_payload('not_found', 'This route does not exist.')})
            return
        if not self.server.ready():
            self.respond(503, {'error': error_payload('service_unavailable', 'Video analysis is temporarily unavailable. Please try again later.', True)})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if self.headers.get('Transfer-Encoding') or not 0 < length <= 4096:
                self.respond(413, {'error': error_payload('invalid_request', 'Submit one video link at a time.')})
                return
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                self.respond(415, {'error': error_payload('invalid_request', 'Send a JSON request.')})
                return
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) != {'url'}:
                raise ValueError
            url = canonical_url(body['url'])
            if urlsplit(url).hostname in {'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'} and not tiktok_configuration()['configured']:
                self.respond(503, {'error': error_payload('service_unavailable', 'TikTok retrieval is not configured. Please try again later.', True)})
                return
            job = self.server.jobs.submit(url)
            self.respond(200 if job['status'] == 'complete' else 202, job)
        except ProcessingError as error:
            status = 429 if error.code in {'queue_full', 'daily_limit'} else 400
            self.respond(status, {'error': error_payload(error.code, error.message, error.retryable)})
        except (ValueError, UnicodeError, TimeoutError):
            self.respond(400, {'error': error_payload('invalid_request', 'Submit one valid video link.')})
        except Exception:
            self.respond(503, {'error': error_payload('service_unavailable', 'Video analysis is temporarily unavailable.', True)})

    def upload_error(self, error):
        codes = {'upload_not_found': 404, 'not_found': 404, 'upload_expired': 410,
                 'upload_too_large': 413, 'upload_storage_full': 429,
                 'daily_limit': 429, 'queue_full': 429, 'upload_timeout': 408}
        self.respond(codes.get(error.code, 400), {'error': error_payload(error.code, error.message, error.retryable)})

    def upload_post(self):
        owner = self.headers.get('X-Upload-Owner')
        jobs_path = re.fullmatch(r'/v1/uploads/([0-9a-f-]+)/jobs', self.path)
        if jobs_path:
            if not self.server.ready():
                self.respond(503, {'error': error_payload('service_unavailable', 'Video analysis is temporarily unavailable.', True)}); return
            try:
                if self.headers.get('Content-Length', '0') not in {'0', '2'}:
                    raise ValueError
                if self.headers.get('Content-Length') == '2' and self.rfile.read(2) != b'{}':
                    raise ValueError
                job = self.server.jobs.submit_upload(jobs_path[1], owner)
                self.respond(200 if job['status'] == 'complete' else 202, job)
            except ProcessingError as error:
                self.upload_error(error)
            except Exception:
                self.respond(400, {'error': error_payload('invalid_request', 'Choose a saved uploaded video.')})
            return
        if self.path != '/v1/uploads':
            self.respond(404, {'error': error_payload('not_found', 'This route does not exist.')}); return
        if not self.server.upload_slots.acquire(blocking=False):
            self.respond(429, {'error': error_payload('upload_storage_full', 'Video uploads are busy. Please try again shortly.', True)}); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BYTES:
                raise ProcessingError('upload_too_large', 'Choose a video file up to 50 MB.')
            raw_title = self.headers.get('X-Reel-Filename', '')
            if len(raw_title) > 2400:
                raise ValueError
            title = unquote(raw_title, errors='strict')
            self.connection.settimeout(30)
            result = self.server.jobs.uploads.receive(self.rfile, length, self.headers.get('Content-Type', '').split(';')[0], title, owner)
            self.respond(201, result)
        except ProcessingError as error:
            self.upload_error(error)
        except (ValueError, UnicodeError, TimeoutError):
            self.respond(400, {'error': error_payload('media_invalid', 'The video upload could not be read. Please try again.')})
        except Exception:
            self.respond(503, {'error': error_payload('service_unavailable', 'Video upload is temporarily unavailable.', True)})
        finally:
            self.server.upload_slots.release()

    def upload_get(self):
        owner = self.headers.get('X-Upload-Owner')
        try:
            job_path = re.fullmatch(r'/v1/upload-jobs/([0-9a-f-]+)', self.path)
            if job_path:
                result = self.server.jobs.get(job_path[1], upload_owner=owner)
                if not result.get('uploadId'):
                    raise ProcessingError('upload_not_found', 'This uploaded analysis is unavailable.')
                self.respond(200, result); return
            result_path = re.fullmatch(r'/v1/uploads/([0-9a-f-]+)/analysis', self.path)
            if result_path:
                self.respond(200, self.server.jobs.upload_result(result_path[1], owner)); return
            media_path = re.fullmatch(r'/v1/uploads/([0-9a-f-]+)', self.path)
            if not media_path:
                raise ProcessingError('upload_not_found', 'This uploaded video is unavailable.')
            row = self.server.jobs.uploads.get(media_path[1], owner, require_file=True)
            size, start, end = row['size'], 0, row['size'] - 1
            range_header = self.headers.get('Range')
            if range_header:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header)
                if not match or not (match[1] or match[2]):
                    self.respond(416, {'error': 'Invalid media range.'}); return
                if match[1]:
                    start, end = int(match[1]), min(int(match[2]) if match[2] else size-1, size-1)
                else:
                    start = max(0, size - int(match[2]))
                if start > end or start >= size:
                    self.respond(416, {'error': 'Invalid media range.'}); return
            self.send_response(206 if range_header else 200)
            for key, value in {'Content-Type': row['mime'], 'Content-Length': str(end-start+1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}.items():
                self.send_header(key, value)
            if range_header:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            with self.server.jobs.uploads.file(row['id'], row['mime']).open('rb') as video:
                video.seek(start); remaining = end-start+1
                while remaining:
                    data = video.read(min(65536, remaining))
                    if not data:
                        break
                    self.wfile.write(data); remaining -= len(data)
        except ProcessingError as error:
            self.upload_error(error)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(503, {'error': error_payload('service_unavailable', 'This upload is temporarily unavailable.', True)})

    def chat_request(self):
        if not self.server.chat_slots.acquire(blocking=False):
            self.respond(429, {'error': 'Bundle chat is busy.'}); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 120000 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                self.respond(400, {'error': 'Invalid conversation.'}); return
            from .chat import answer, validate_input
            body = validate_input(json.loads(self.rfile.read(length)))
            self.server.jobs.reserve_chat()
            self.respond(200, answer(body))
        except ProcessingError as error:
            self.respond(429 if error.code == 'daily_limit' else 503, {'error': 'Bundle chat is temporarily unavailable.'})
        except (ValueError, UnicodeError, TimeoutError):
            self.respond(400, {'error': 'Invalid conversation.'})
        except Exception:
            self.respond(503, {'error': 'Bundle chat is temporarily unavailable.'})
        finally:
            self.server.chat_slots.release()


def main():
    directory = Path(os.environ.get('REELTRIP_DATA_DIR', '/data'))
    jobs = Jobs(directory / 'jobs.sqlite3', daily_limit=int(os.environ.get('REELTRIP_DAILY_LIMIT', '25')),
                pending_limit=int(os.environ.get('REELTRIP_PENDING_LIMIT', '20')))
    jobs.start(workers=int(os.environ.get('REELTRIP_WORKERS', '2')))
    server = Server(('0.0.0.0', int(os.environ.get('PORT', '8080'))), jobs)
    def stop(*_):
        jobs.stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        jobs.shutdown()
        server.server_close()

if __name__ == '__main__':
    main()
