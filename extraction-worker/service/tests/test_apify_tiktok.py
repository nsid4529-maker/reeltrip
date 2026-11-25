"""No-network regressions for the optional authenticated TikTok provider."""
import io
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

from travel_workflow.apify_tiktok import download_apify_tiktok, media_record, NoRedirect, token_configured
from travel_workflow.video_acquisition import AcquisitionError
from service.contracts import ProcessingError
from service.pipeline import acquire_media, process
from service.server import Server, configuration_ready, tiktok_configuration

VIDEO = '7703925873447128323'
SOURCE = 'https://www.tiktok.com/@ambardriscoll/video/' + VIDEO
TOKEN = 'test-server-token'
RUN = 'ownRun123'
STORE = 'ownStore123'
DATASET = 'ownDataset123'


def run(status='SUCCEEDED', **values):
    return {'data': {'id': RUN, 'status': status, 'defaultDatasetId': DATASET,
                     'defaultKeyValueStoreId': STORE, **values}}


def item(**values):
    return {'id': VIDEO, 'webVideoUrl': SOURCE, 'text': 'Travel caption',
            'authorMeta': {'name': 'ambardriscoll'},
            'videoMeta': {'downloadAddr': 'https://api.apify.com/v2/key-value-stores/' + STORE + '/records/video-' + VIDEO + '.mp4'}, **values}


class Response(io.BytesIO):
    def __init__(self, data, content_type='application/json', length=None, status=200):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        super().__init__(body)
        self.status = status
        self.headers = {'Content-Type': content_type, 'Content-Length': str(len(body) if length is None else length)}


class Clock:
    now = 100.0
    def __call__(self): return self.now
    def sleep(self, seconds): self.now += seconds


class ApifyAcquisitionTests(unittest.TestCase):
    def test_exact_video_download_has_fixed_cost_scope_and_no_credential_urls(self):
        opener = Mock()
        opener.open.side_effect = [Response(run('RUNNING')), Response(run()), Response([item()]), Response(b'video', 'video/mp4')]
        clock = Clock()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'video.mp4'
            result = download_apify_tiktok(SOURCE + '?tracking=ignored', target, token=TOKEN, opener=opener, clock=clock, sleep=clock.sleep)
            self.assertEqual(target.read_bytes(), b'video')
        self.assertEqual(result['video_id'], VIDEO)
        self.assertEqual(result['author_handle'], 'ambardriscoll')
        self.assertEqual(result['caption'], 'Travel caption')
        self.assertFalse(result['browser_credentials_used'])
        self.assertNotIn(TOKEN, json.dumps(result))
        self.assertNotIn('downloadAddr', result)
        calls = opener.open.call_args_list
        first = calls[0].args[0]
        query = parse_qs(urlsplit(first.full_url).query)
        self.assertEqual(query['maxTotalChargeUsd'], ['0.01'])
        self.assertEqual(query['timeout'], ['45'])
        self.assertEqual(query['restartOnError'], ['false'])
        data = json.loads(first.data)
        self.assertEqual(data['postURLs'], [SOURCE])
        self.assertTrue(data['shouldDownloadVideos'])
        self.assertFalse(data['scrapeRelatedVideos'])
        self.assertEqual(data['resultsPerPage'], 1)
        self.assertEqual(data['downloadSubtitlesOptions'], 'NEVER_DOWNLOAD_SUBTITLES')
        self.assertEqual(sum(call.args[0].method == 'POST' for call in calls), 1)
        for call in calls:
            request = call.args[0]
            self.assertEqual(urlsplit(request.full_url).hostname, 'api.apify.com')
            self.assertNotIn(TOKEN, request.full_url)
            self.assertEqual(request.get_header('Authorization'), 'Bearer ' + TOKEN)
        self.assertIn('/key-value-stores/' + STORE + '/records/video-' + VIDEO, calls[-1].args[0].full_url)

    def test_missing_invalid_token_or_source_makes_no_request(self):
        opener = Mock()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'video.mp4'
            for token in ['', 'bad\nvalue', 'x' * 513, 'é']:
                with self.subTest(token=token), self.assertRaises(AcquisitionError):
                    download_apify_tiktok(SOURCE, target, token=token, opener=opener)
            for source in ['https://www.instagram.com/reel/ABC123', 'https://vm.tiktok.com/abc123']:
                with self.subTest(source=source), self.assertRaises(AcquisitionError):
                    download_apify_tiktok(source, target, token=TOKEN, opener=opener)
        opener.open.assert_not_called()

    def test_access_refusal_rate_limits_and_lost_submit_do_not_retry(self):
        for error in [HTTPError('https://api.apify.com/private?token=secret', code, 'secret body', {}, None) for code in (401, 403, 402, 429, 302)]+[URLError('secret connection detail')]:
            opener = Mock(); opener.open.side_effect = error
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(AcquisitionError) as raised:
                download_apify_tiktok(SOURCE, Path(directory) / 'video.mp4', token=TOKEN, opener=opener)
            self.assertEqual(opener.open.call_count, 1)
            self.assertNotIn('secret', str(raised.exception))
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test'))

    def test_provider_outages_do_not_blame_video_access_or_retry_submission(self):
        errors = [(HTTPError('https://api.apify.com/private?token=secret', code, 'secret body', {}, None),
                   'service_busy' if code in (402, 429) else 'service_unavailable')
                  for code in (401, 403, 402, 429, 500, 503)]
        errors.append((URLError('secret connection detail'), 'service_unavailable'))
        for error, expected in errors:
            opener = Mock(); opener.open.side_effect = error
            with self.subTest(error=type(error).__name__, expected=expected), tempfile.TemporaryDirectory() as directory:
                def acquire(source, root):
                    return download_apify_tiktok(source, root/'video.mp4', token=TOKEN, opener=opener)
                with patch('service.pipeline.acquire_media', side_effect=acquire), self.assertRaises(ProcessingError) as raised:
                    process(SOURCE, Path(directory))
                self.assertEqual(raised.exception.code, expected)
                self.assertTrue(raised.exception.retryable)
                self.assertNotIn('secret', str(raised.exception))
                self.assertNotIn('public', str(raised.exception))
                self.assertEqual(opener.open.call_count, 1)

    def test_unavailable_video_still_has_source_specific_error(self):
        with tempfile.TemporaryDirectory() as directory, patch('service.pipeline.acquire_media', side_effect=AcquisitionError('Video unavailable')):
            with self.assertRaises(ProcessingError) as raised:
                process(SOURCE, Path(directory))
            self.assertEqual(raised.exception.code, 'source_unavailable')

    def test_response_identity_and_own_store_are_required(self):
        other = '7703925873447128324'
        for value in [item(id=other), item(webVideoUrl=SOURCE.replace(VIDEO, other)), item(errorCode='POST_NOT_FOUND_OR_PRIVATE'),
                      item(videoMeta={}), item(webVideoUrl='https://evil.test/video/' + VIDEO)]:
            with self.subTest(value=value), self.assertRaises(AcquisitionError):
                media_record(value, SOURCE, STORE)
        good = item()['videoMeta']['downloadAddr']
        for url in [good.replace(STORE, 'someoneElse'), good.replace(VIDEO, other), good.replace('https:', 'http:'),
                    good.replace('api.apify.com', 'api.apify.com.evil.test'), good.replace('api.apify.com', 'user:pass@api.apify.com'),
                    good.replace('api.apify.com', 'api.apify.com:444'), good+'#fragment',
                    good.replace('/records/', '/records/../'), good.replace('/records/', '/records/%2F')]:
            with self.subTest(url=url), self.assertRaises(AcquisitionError):
                media_record(item(videoMeta={'downloadAddr': url}), SOURCE, STORE)
        path, metadata = media_record(item(videoMeta={'downloadAddr': good+'?token=not-persisted'}), SOURCE, STORE)
        self.assertNotIn('token', path)
        self.assertNotIn('not-persisted', json.dumps(metadata))

    def test_deadline_cancels_only_the_started_run(self):
        opener = Mock(); clock = Clock()
        def respond(request, **kwargs):
            if request.full_url.endswith('/abort'):
                return Response(run('ABORTED'))
            clock.now += 69
            return Response(run('RUNNING'))
        opener.open.side_effect = respond
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(AcquisitionError, 'time limit'):
            download_apify_tiktok(SOURCE, Path(directory)/'video.mp4', token=TOKEN, opener=opener, clock=clock, sleep=clock.sleep)
        self.assertEqual(opener.open.call_count, 2)
        self.assertEqual(opener.open.call_args_list[-1].args[0].full_url, 'https://api.apify.com/v2/actor-runs/' + RUN + '/abort')

    def test_video_without_caption_still_uses_audio_and_frames(self):
        _, metadata = media_record(item(text=None), SOURCE, STORE)
        self.assertEqual(metadata['caption'], '')
        for value in [42, [], {}]:
            with self.subTest(caption=value), self.assertRaises(AcquisitionError):
                media_record(item(text=value), SOURCE, STORE)

    def test_wrong_poll_identity_aborts_original_run(self):
        opener=Mock(); opener.open.side_effect=[Response(run('RUNNING')), Response(run(id='otherRun')), Response(run('ABORTED'))]
        clock=Clock()
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(AcquisitionError, 'different run'):
            download_apify_tiktok(SOURCE, Path(directory)/'video.mp4', token=TOKEN, opener=opener, clock=clock, sleep=clock.sleep)
        self.assertEqual(opener.open.call_args_list[-1].args[0].full_url, 'https://api.apify.com/v2/actor-runs/' + RUN + '/abort')

    def test_terminal_failure_or_extra_results_never_download_media(self):
        for responses, count in [([Response(run('TIMED-OUT'))],1), ([Response(run()), Response([item(),item()])],2),
                                  ([Response(run()),Response([item(errorCode='POST_SENSITIVE')])],2)]:
            opener=Mock(); opener.open.side_effect=responses
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(AcquisitionError):
                download_apify_tiktok(SOURCE,Path(directory)/'video.mp4',token=TOKEN,opener=opener)
            self.assertEqual(opener.open.call_count,count)

    def test_download_rejects_html_truncation_and_redirect_without_partial_file(self):
        responses=[Response(b'html','text/html'),Response(b'short','video/mp4',length=100),
                   HTTPError('https://api.apify.com/record',302,'redirect',{'Location':'https://evil.test'},None)]
        for response in responses:
            opener=Mock();opener.open.side_effect=[Response(run()),Response([item()]),response]
            with tempfile.TemporaryDirectory() as directory:
                target=Path(directory)/'video.mp4'
                with self.assertRaises(AcquisitionError):download_apify_tiktok(SOURCE,target,token=TOKEN,opener=opener)
                self.assertFalse(target.exists())
            self.assertEqual(opener.open.call_count,3)

    def test_existing_file_is_never_removed_or_overwritten(self):
        opener=Mock()
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'video.mp4';target.write_bytes(b'keep')
            with self.assertRaises(AcquisitionError):download_apify_tiktok(SOURCE,target,token=TOKEN,opener=opener)
            self.assertEqual(target.read_bytes(),b'keep')
        opener.open.assert_not_called()

    def test_truncated_control_and_media_responses_are_sanitized_and_not_retried(self):
        for error in [http.client.IncompleteRead(b'secret response content', 100), TimeoutError('secret'), OSError('secret')]:
            class BrokenResponse(Response):
                def read(self, size=-1):
                    raise error
            for responses, count in [([BrokenResponse(b'partial')], 1),
                                     ([Response(run()), Response([item()]), BrokenResponse(b'partial', 'video/mp4')], 3)]:
                opener = Mock(); opener.open.side_effect = responses
                with self.subTest(error=type(error).__name__, response_count=count), tempfile.TemporaryDirectory() as directory:
                    def acquire(source, root):
                        return download_apify_tiktok(source, root/'video.mp4', token=TOKEN, opener=opener)
                    with patch('service.pipeline.acquire_media', side_effect=acquire), self.assertRaises(ProcessingError) as raised:
                        process(SOURCE, Path(directory))
                    self.assertEqual(raised.exception.code, 'service_unavailable')
                    self.assertFalse((Path(directory)/'video.mp4').exists())
                    self.assertNotIn('secret', str(raised.exception))
                self.assertEqual(opener.open.call_count, count)


class ProviderSelectionTests(unittest.TestCase):
    def test_unconfigured_tiktok_rejects_before_submit_but_instagram_and_uploads_accept(self):
        server_token = 'test-worker-token-' * 3
        jobs = Mock()
        jobs.submit.return_value = {'id': 'test-job', 'status': 'queued'}
        jobs.uploads.receive.return_value = {'id': 'test-upload', 'status': 'uploaded'}
        with patch.dict(os.environ, {'REELTRIP_TIKTOK_PROVIDER': 'apify', 'REELTRIP_PROCESSOR_TOKEN': server_token}, clear=True):
            server = Server(('127.0.0.1', 0), jobs, ready=lambda: True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = 'http://127.0.0.1:' + str(server.server_port)
            headers = {'Authorization': 'Bearer ' + server_token, 'Content-Type': 'application/json'}
            try:
                with urllib.request.urlopen(base + '/health') as response:
                    health = json.load(response)
                    self.assertTrue(health['ready'])
                    self.assertEqual(health['tiktok'], {'provider': 'apify', 'configured': False})
                for url in [SOURCE, 'https://vm.tiktok.com/abc123']:
                    request = urllib.request.Request(base + '/v1/jobs', data=json.dumps({'url': url}).encode(), headers=headers)
                    with self.assertRaises(HTTPError) as raised:
                        urllib.request.urlopen(request)
                    self.assertEqual(raised.exception.code, 503)
                    self.assertEqual(json.load(raised.exception)['error']['code'], 'service_unavailable')
                jobs.submit.assert_not_called()
                request = urllib.request.Request(base + '/v1/jobs', data=json.dumps({'url': 'https://www.instagram.com/reel/ABC123/'}).encode(), headers=headers)
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.status, 202)
                jobs.submit.assert_called_once()
                upload = urllib.request.Request(base + '/v1/uploads', data=b'video', headers={**headers, 'Content-Type': 'video/mp4', 'X-Upload-Owner': 'test-owner'})
                with urllib.request.urlopen(upload) as response:
                    self.assertEqual(response.status, 201)
                jobs.uploads.receive.assert_called_once()
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_apify_is_explicit_and_keeps_probe_decode(self):
        def downloaded(source,target):target.write_bytes(b'video');return {'name':'Apify','video_id':VIDEO}
        probe={'duration_seconds':91,'audio_present':True,'streams':[{'codec_type':'video','width':720,'height':1280}]}
        with patch.dict(os.environ,{'REELTRIP_TIKTOK_PROVIDER':'apify','APIFY_API_TOKEN':TOKEN},clear=True),tempfile.TemporaryDirectory() as directory:
            with patch('travel_workflow.apify_tiktok.download_apify_tiktok',side_effect=downloaded) as apify, \
                 patch('travel_workflow.tiktok_resolver.download_tiktok') as tikwm,patch('service.pipeline.probe_video',return_value=probe) as probed, \
                 patch('service.pipeline.decode_video',return_value={'full_video_decode_passed':True}) as decoded:
                result=acquire_media(SOURCE,Path(directory))
                self.assertEqual(result['source_association'],'apify_run_storage_and_video_id_checked')
                apify.assert_called_once();tikwm.assert_not_called();probed.assert_called_once();decoded.assert_called_once()

    def test_default_stays_tikwm_and_failure_never_rotates(self):
        with patch.dict(os.environ,{},clear=True),tempfile.TemporaryDirectory() as directory:
            with patch('travel_workflow.apify_tiktok.download_apify_tiktok') as apify, \
                 patch('travel_workflow.tiktok_resolver.download_tiktok',side_effect=AcquisitionError('refused')) as tikwm:
                with self.assertRaises(AcquisitionError):acquire_media(SOURCE,Path(directory))
                tikwm.assert_called_once();apify.assert_not_called()

    def test_missing_provider_config_does_not_disable_instagram_or_upload_readiness(self):
        for settings in [{'REELTRIP_TIKTOK_PROVIDER':'apify'}, {'REELTRIP_TIKTOK_PROVIDER':'unknown'}]:
            with patch.dict(os.environ,{**settings,'OPENAI_API_KEY':'test','REELTRIP_PROCESSOR_TOKEN':'x'*40},clear=True),patch('shutil.which',return_value='/test/bin'):
                self.assertTrue(configuration_ready())
                self.assertFalse(tiktok_configuration()['configured'])
                with tempfile.TemporaryDirectory() as directory, self.assertRaises(ProcessingError) as raised:
                    acquire_media(SOURCE,Path(directory))
                self.assertEqual(raised.exception.code,'service_unavailable')
        with patch.dict(os.environ,{'REELTRIP_TIKTOK_PROVIDER':'apify','APIFY_API_TOKEN':TOKEN},clear=True):
            self.assertTrue(tiktok_configuration()['configured'])
            self.assertTrue(token_configured())


if __name__=='__main__':unittest.main()
