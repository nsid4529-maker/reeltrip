from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import io
import json
import os
from pathlib import Path
import sqlite3
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, Mock
import urllib.error
import urllib.request
from service.contracts import ProcessingError, canonical_url, name_in_text, result_from_model
from service.jobs import Jobs
from service.pipeline import acquire_media, analyse, api_request, process, resolve_source_url, transcribe_file
from service.server import authenticated, configuration_ready, Server
from service.bootstrap import prepare_volume

URL = 'https://www.instagram.com/reel/Test123'
TOKEN = 'test-only-' + 'x' * 40

def record():
    return {'source_url': URL, 'original_source_url': URL, 'duration_seconds': 30, 'platform': 'instagram',
            'sha256': 'a' * 64, 'acquired_at': '2026-11-17T12:00:00Z',
            'source_association': 'instagram_returned_shortcode_and_numeric_id_checked',
            'provider': {'author_handle': 'creator'}, 'audio_present': True}

def evidence():
    return {'caption': 'We recommend Café Soul in Ella.', 'frame_times': [0, 5, 10, 15, 20, 25],
            'transcript': {'text': 'We recommend Café Soul in Ella.',
                           'segments': [{'start': 0, 'end': 30, 'text': 'We recommend Café Soul in Ella.'}]}}

def model():
    return {'is_travel': True, 'reason': '', 'scope': 'Ella, Sri Lanka', 'title': 'Food in Ella', 'unknowns': [],
            'places': [{'name': 'Café Soul', 'location': 'Ella', 'details': 'The creator recommends Café Soul.',
                        'category': 'Food', 'day': 0, 'start': 0, 'end': 30,
                        'evidence_type': 'speech', 'evidence_quote': 'Café Soul in Ella'}]}

class ContractTests(unittest.TestCase):
    def test_normalizes_aliases_and_removes_tracking(self):
        self.assertEqual(canonical_url('https://instagram.com/reels/Test123/?igsh=secret'), URL)
        self.assertEqual(canonical_url('https://m.tiktok.com/@creator/video/1234567890123?x=1'), 'https://www.tiktok.com/@creator/video/1234567890123')

    def test_rejects_untrusted_destinations_and_credentials(self):
        for value in ['http://instagram.com/reel/Test123', 'https://instagram.com.evil.test/reel/Test123',
                      'https://user:pass@m.tiktok.com/@creator/video/123', 'https://instagram.com:99/reel/Test123',
                      'https://instagram.com/creator', 'https://127.0.0.1/reel/Test123', 'file:///etc/passwd', None]:
            with self.subTest(value=value), self.assertRaises(ProcessingError):
                canonical_url(value)

    def test_shortlink_checks_every_redirect_and_preserves_exact_id(self):
        with tempfile.TemporaryDirectory() as directory:
            transfer = Mock(return_value=(302, {'location': 'https://www.tiktok.com/@creator/video/1234567890123?_r=1'}))
            self.assertEqual(resolve_source_url('https://vm.tiktok.com/Abc123/', Path(directory), transfer=transfer), 'https://www.tiktok.com/@creator/video/1234567890123')
            self.assertEqual(transfer.call_count, 1)
            for location in ['http://www.tiktok.com/@creator/video/123', 'https://user@www.tiktok.com/@creator/video/123',
                             'https://evil.test/@creator/video/123', 'https://www.instagram.com/reel/Test123']:
                with self.subTest(location=location), self.assertRaises(ProcessingError):
                    resolve_source_url('https://vm.tiktok.com/Abc123', Path(directory), transfer=Mock(return_value=(302, {'location': location})))

    def test_shortlink_loops_are_bounded_and_no_html_is_treated_as_video(self):
        with tempfile.TemporaryDirectory() as directory:
            transfer = Mock(return_value=(302, {'location': 'https://vt.tiktok.com/Abc123'}))
            with self.assertRaises(ProcessingError):
                resolve_source_url('https://vm.tiktok.com/Abc123', Path(directory), transfer=transfer)
            self.assertEqual(transfer.call_count, 3)
            with self.assertRaises(ProcessingError):
                resolve_source_url('https://vm.tiktok.com/Abc123', Path(directory), transfer=Mock(return_value=(200, {})))

    def test_result_identity_providers_and_ai_label_are_server_controlled(self):
        raw = model(); raw['source_url'] = 'https://evil.test'; raw['providers'] = ['Evil']
        result = result_from_model(raw, record(), evidence())
        self.assertEqual(result['source']['source_url'], URL)
        self.assertEqual(result['source']['analysis_kind'], 'ai')
        self.assertEqual(result['source']['days'][0]['day'], 0)
        self.assertEqual(result['matches'][0]['providers'], ['OpenTable'])
        self.assertFalse(result['provenance']['manually_reviewed'])
        self.assertEqual(result['provenance']['original_url'], URL)
        alias = record(); alias['source_url'] = URL.replace('/reel/', '/p/')
        self.assertEqual(result['source']['id'], result_from_model(raw, alias, evidence())['source']['id'])

    def test_invalid_timestamp_or_unsupported_quote_fails(self):
        for changed in [{'start': -1}, {'end': 31}, {'category': 'Invented'}, {'evidence_quote': 'Nobu'}, {'day': 35}]:
            raw = model(); raw['places'][0].update(changed)
            with self.subTest(changed=changed), self.assertRaises(ProcessingError):
                result_from_model(raw, record(), evidence())

    def test_speech_timestamp_requires_matching_transcript_chunk(self):
        raw = model(); raw['places'][0].update({'start': 4, 'end': 7})
        with self.assertRaises(ProcessingError):
            result_from_model(raw, record(), evidence())

    def test_hallucinated_named_venue_is_omitted(self):
        raw = model(); raw['places'].append({**raw['places'][0], 'name': 'Unmentioned Restaurant'})
        with self.assertRaisesRegex(ProcessingError, 'name is absent'):
            result_from_model(raw, record(), evidence())
        result = result_from_model(raw, record(), evidence(), allow_partial=True)
        self.assertEqual([item['title'] for item in result['matches']], ['Café Soul'])
        self.assertTrue(any('uncertain venue' in line for line in result['source']['unknowns']))
        self.assertIn('1 detail(s)', result['source']['unknowns'][0])

    def test_native_script_name_requires_literal_source_evidence(self):
        raw = model(); raw['places'][0].update({'name': '平安神宮', 'evidence_quote': '平安神宮'})
        ev = evidence(); ev['transcript']['segments'][0]['text'] = '朝は平安神宮を訪れます。'
        result = result_from_model(raw, record(), ev)
        self.assertEqual(result['matches'][0]['title'], '平安神宮')
        raw['places'][0]['name'] = 'Heian Shrine'
        with self.assertRaises(ProcessingError):
            result_from_model(raw, record(), ev)

    def test_spoken_and_written_conjunction_preserves_evidenced_venue(self):
        for name, spoken in [('Pear & Plum', 'Pear and Plum'), ('Pear and Plum', 'Pear & Plum'), ('Pear&Plum', 'Pear and Plum')]:
            with self.subTest(name=name, spoken=spoken):
                quote = 'We recommend ' + spoken + ' in Ella.'
                raw = model(); raw['places'][0].update({'name': name, 'evidence_quote': quote})
                ev = evidence(); ev['transcript']['text'] = quote; ev['transcript']['segments'][0]['text'] = quote
                result = result_from_model(raw, record(), ev)
                self.assertEqual([match['title'] for match in result['matches']], [name])
                self.assertEqual(result['matches'][0]['quote'], quote)
                # A normalised name is allowed; a rewritten source quote is not.
                raw['places'][0]['evidence_quote'] = quote.replace(spoken, name)
                with self.assertRaises(ProcessingError):
                    result_from_model(raw, record(), ev)

    def test_name_conjunction_normalization_does_not_allow_other_names_or_substrings(self):
        self.assertTrue(name_in_text('Pear & Plum', 'Visit PEAR and PLUM.'))
        for name, quote in [('Pear & Cherry', 'Visit Pear and Plum.'), ('Pear & Plum', 'Visit Pear Plum.'),
                            ('Pear & Plum', 'Visit PearandPlum.'), ('Pear', 'Visit Pearl.'),
                            ('Pear & Plum', 'Visit Pear and Plums.'), ('', 'Visit Pear and Plum.')]:
            with self.subTest(name=name, quote=quote):
                self.assertFalse(name_in_text(name, quote))

    def test_conjunction_alias_cannot_hide_unsupported_multi_place_route(self):
        quote = 'Visit Pear and Plum then Cedar Kitchen.'
        raw = model(); raw['places'][0].update({'name': 'Pear & Plum', 'evidence_quote': quote})
        raw['places'].append({**raw['places'][0], 'name': 'Cedar Kitchen'})
        ev = evidence(); ev['transcript']['text'] = quote; ev['transcript']['segments'][0]['text'] = quote
        ev['caption'] = 'Save this guide for later.'
        raw['practical_tips'] = [{'subject': 'Route', 'topic': 'Route', 'details': quote,
                                 'evidence_type': 'caption', 'evidence_quote': ev['caption'], 'start': 0, 'end': 30}]
        with self.assertRaises(ProcessingError):
            result_from_model(raw, record(), ev)
        raw['practical_tips'][0].update({'evidence_type': 'speech', 'evidence_quote': quote})
        result = result_from_model(raw, record(), ev)
        self.assertEqual(len(result['matches']), 2)
        self.assertEqual(len(result['source']['practical_tips']), 1)

    def test_screen_text_requires_actual_sampled_timestamp(self):
        raw = model(); raw['places'][0].update({'evidence_type': 'screen_text', 'start': 1, 'end': 2})
        with self.assertRaises(ProcessingError):
            result_from_model(raw, record(), evidence())

    def test_weekdays_are_not_numbered_trip_days_and_visual_evidence_is_precise(self):
        raw = model(); raw['places'][0].update({'day': 2, 'evidence_type': 'screen_text', 'evidence_quote': 'TUESDAY Café Soul', 'start': 3, 'end': 3})
        ev = evidence(); ev['frame_times'] = [0, 3, 6]
        result = result_from_model(raw, record(), ev)
        self.assertEqual(result['source']['days'][0]['day'], 0)
        self.assertEqual(result['matches'][0]['second'], 3)
        raw['places'][0]['end'] = 30
        with self.assertRaises(ProcessingError): result_from_model(raw, record(), ev)

    def test_nontravel_video_never_becomes_an_itinerary(self):
        result = result_from_model({'is_travel': False, 'reason': 'A software tutorial.'}, record(), evidence())
        self.assertEqual(result, {'not_travel': True, 'reason': 'A software tutorial.'})

    def test_multi_place_tip_cannot_use_generic_caption_as_route_evidence(self):
        raw = model()
        raw['places'].append({**raw['places'][0], 'name': 'Nine Arch Bridge',
                              'category': 'Experiences', 'evidence_quote': 'Nine Arch Bridge in Ella'})
        ev = evidence()
        ev['transcript']['segments'][0]['text'] = 'Visit Café Soul in Ella and Nine Arch Bridge in Ella.'
        ev['caption'] = 'Save this guide for later.'
        raw['practical_tips'] = [{'subject': 'Recommended route', 'topic': 'Route',
                                 'details': 'Visit Café Soul then Nine Arch Bridge.',
                                 'evidence_type': 'caption', 'evidence_quote': ev['caption'],
                                 'start': 0, 'end': 30}]
        with self.assertRaises(ProcessingError):
            result_from_model(raw, record(), ev)
        partial = result_from_model(raw, record(), ev, allow_partial=True)
        self.assertEqual(len(partial['matches']), 2)
        self.assertEqual(partial['source']['practical_tips'], [])
        self.assertIn('1 detail(s)', partial['source']['unknowns'][0])
        raw['practical_tips'][0].update({'evidence_type': 'speech',
                                         'evidence_quote': ev['transcript']['segments'][0]['text']})
        valid = result_from_model(raw, record(), ev)
        self.assertEqual(len(valid['source']['practical_tips']), 1)

    def test_multi_place_visual_tip_cannot_merge_different_frames(self):
        raw = model()
        raw['places'][0].update({'evidence_type': 'screen_text', 'evidence_index': 1,
                                'evidence_quote': 'MONDAY Café Soul'})
        raw['places'].append({**raw['places'][0], 'name': 'Nine Arch Bridge',
                              'evidence_index': 2, 'category': 'Experiences',
                              'evidence_quote': 'TUESDAY Nine Arch Bridge'})
        raw['practical_tips'] = [{'subject': 'Weekly guide', 'topic': 'Timing',
                                 'details': 'Café Soul on Monday; Nine Arch Bridge on Tuesday.',
                                 'evidence_type': 'screen_text', 'evidence_index': 1,
                                 'evidence_quote': 'MONDAY Café Soul; TUESDAY Nine Arch Bridge',
                                 'start': 0, 'end': 0}]
        with self.assertRaises(ProcessingError):
            result_from_model(raw, record(), evidence())
        partial = result_from_model(raw, record(), evidence(), allow_partial=True)
        self.assertEqual(len(partial['matches']), 2)
        self.assertEqual(partial['source']['practical_tips'], [])
        # A single schedule card with both names at one frame is consistent.
        raw['places'][1]['evidence_index'] = 1
        valid = result_from_model(raw, record(), evidence())
        self.assertEqual(len(valid['source']['practical_tips']), 1)

class PipelineTests(unittest.TestCase):
    def test_duration_and_dimensions_rejected_before_full_decode(self):
        for duration, width, height in [(181, 720, 1280), (60, 16000, 9000)]:
            probe = {'duration_seconds': duration, 'audio_present': True, 'streams': [{'codec_type': 'video', 'width': width, 'height': height}]}
            with (tempfile.TemporaryDirectory() as directory,
                  patch('travel_workflow.instagram_resolver.download_instagram', return_value={}),
                  patch('service.pipeline.probe_video', return_value=probe), patch('service.pipeline.decode_video') as decode):
                with self.assertRaises(ProcessingError): acquire_media(URL, Path(directory))
                decode.assert_not_called()

    def test_transcription_multipart_uses_current_model_without_secret_in_body(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'audio.mp3'; audio.write_bytes(b'fake-audio-test-fixture')
            calls = []
            def request(path, body, content_type):
                calls.append((path, body, content_type)); return {'text': 'Café Soul in Ella'}
            self.assertEqual(transcribe_file(audio, request=request), 'Café Soul in Ella')
            self.assertEqual(calls[0][0], '/audio/transcriptions')
            self.assertIn(b'gpt-transcribe', calls[0][1])
            self.assertIn(b'fake-audio-test-fixture', calls[0][1])

    def test_analysis_sends_frames_and_transcript_and_checks_completed_state(self):
        with tempfile.TemporaryDirectory() as directory:
            frame = Path(directory) / 'frame.jpg'; frame.write_bytes(b'jpeg-test-fixture')
            captured = []
            def request(path, body, content_type):
                payload = json.loads(body); captured.append(payload)
                return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(model())}]}], 'usage': {'input_tokens': 10}}
            result, usage = analyse(record(), [(0, frame)], evidence()['transcript'], request=request)
            self.assertEqual(len(result['matches']), 1)
            self.assertFalse(captured[0]['store'])
            self.assertEqual(captured[0]['text']['format']['type'], 'json_schema')
            self.assertTrue(any(x['type'] == 'input_image' for x in captured[0]['input'][0]['content']))
            with self.assertRaises(ProcessingError):
                analyse(record(), [(0, frame)], evidence()['transcript'], request=lambda *_: {'status': 'incomplete'})

    def test_translated_name_gets_one_correction_instead_of_silent_omission(self):
        transcript = {'text': '朝は平安神宮を訪れます。', 'segments': [{'start': 0, 'end': 30, 'text': '朝は平安神宮を訪れます。'}]}
        calls = []
        def request(path, body, content_type):
            calls.append(json.loads(body))
            raw = model(); raw['places'][0].update({'name': 'Heian Shrine' if len(calls) == 1 else '平安神宮',
                                                    'evidence_quote': '平安神宮', 'evidence_index': 0})
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(raw)}]}]}
        result, usage = analyse(record(), [], transcript, request=request)
        self.assertEqual([match['title'] for match in result['matches']], ['平安神宮'])
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(usage['attempts']), 2)
        self.assertIn('original script', calls[1]['input'][-1]['content'][0]['text'])

    def test_unverified_names_cannot_escape_or_expand_correction_limit(self):
        raw = model(); raw['places'][0]['name'] = 'Unmentioned Restaurant'
        request = Mock(return_value={'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(raw)}]}]})
        with self.assertRaises(ProcessingError):
            analyse(record(), [], evidence()['transcript'], request=request)
        self.assertEqual(request.call_count, 2)

    def test_network_errors_never_expose_credentials_or_upstream_body(self):
        opener = Mock(); opener.open.side_effect = urllib.error.HTTPError('https://api.openai.com', 403, 'SECRET', {}, None)
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-secret'}), self.assertRaises(ProcessingError) as caught:
            api_request('/responses', b'{}', 'application/json', opener=opener)
        self.assertNotIn('SECRET', str(caught.exception))
        self.assertNotIn('test-secret', str(caught.exception))

    def test_oversized_clip_never_calls_ai(self):
        r = record(); r.update({'duration_seconds': 181, 'file': '/tmp/example.mp4'})
        with tempfile.TemporaryDirectory() as directory, patch('service.pipeline.acquire_media', return_value=r), patch('service.pipeline.analyse') as ai:
            with self.assertRaises(ProcessingError) as caught:
                process(URL, Path(directory))
            self.assertEqual(caught.exception.code, 'video_too_long'); ai.assert_not_called()

class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.path = Path(self.temp.name) / 'jobs.sqlite'
    def tearDown(self):
        self.temp.cleanup()
    def test_deduplication_does_not_spend_quota_twice(self):
        jobs = Jobs(self.path, daily_limit=1)
        first = jobs.submit(URL); second = jobs.submit(URL + '?tracking=abc')
        self.assertEqual(first['id'], second['id'])
        jobs.finish(first['id'], {'result': {'not_travel': True, 'reason': 'Test'}})
        self.assertEqual(jobs.submit(URL)['status'], 'complete')
        with self.assertRaises(ProcessingError) as caught: jobs.submit(URL + 'other')
        self.assertEqual(caught.exception.code, 'daily_limit')
    def test_old_pipeline_results_are_preserved_but_not_reused(self):
        from service import PIPELINE_VERSION
        jobs = Jobs(self.path)
        old = jobs.submit(URL)
        with patch('service.jobs.PIPELINE_VERSION', '2026-11-19-detail-v8'):
            jobs.finish(old['id'], {'result': {'not_travel': True, 'reason': 'Previous result'}})
        current = jobs.submit(URL)
        self.assertNotEqual(current['id'], old['id'])
        self.assertEqual(jobs.get(old['id'])['result']['pipeline_version'], '2026-11-19-detail-v8')
        self.assertEqual(jobs.submit(URL)['id'], current['id'], 'pending jobs still deduplicate')
        jobs.finish(current['id'], {'result': {'not_travel': True, 'reason': 'Current result'}})
        self.assertEqual(jobs.submit(URL)['id'], current['id'])
        self.assertEqual(jobs.get(current['id'])['result']['pipeline_version'], PIPELINE_VERSION)
    def test_queue_limit_and_atomic_claim(self):
        jobs = Jobs(self.path, pending_limit=2)
        jobs.submit(URL); jobs.submit(URL + 'other')
        with self.assertRaises(ProcessingError) as caught: jobs.submit(URL + 'third')
        self.assertEqual(caught.exception.code, 'queue_full')
        with ThreadPoolExecutor(max_workers=4) as pool:
            claims = list(pool.map(lambda _: jobs.claim(), range(4)))
        self.assertEqual(len([c for c in claims if c]), 2)
        self.assertEqual(len({c['id'] for c in claims if c}), 2)
    def test_concurrent_submissions_cannot_exceed_daily_cap(self):
        jobs = Jobs(self.path, daily_limit=3, pending_limit=20)
        def submit(i):
            try: return jobs.submit(URL + str(i))
            except ProcessingError: return None
        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(submit, range(20)))
        self.assertEqual(len([r for r in results if r]), 3)
    def test_restart_preserves_completed_results_and_marks_interrupted_retryable(self):
        jobs = Jobs(self.path)
        completed, pending = jobs.submit(URL), jobs.submit(URL + 'other')
        jobs.finish(completed['id'], {'result': {'not_travel': True, 'reason': 'Test'}})
        resumed = Jobs(self.path)
        self.assertEqual(resumed.get(completed['id'])['status'], 'complete')
        result = resumed.get(pending['id']); self.assertEqual(result['status'], 'failed'); self.assertTrue(result['error']['retryable'])
    def test_job_id_validation_and_stage_allowlist(self):
        jobs = Jobs(self.path); job = jobs.submit(URL); jobs.claim()
        for bad in ['../../etc/passwd', 'not-a-uuid', None]:
            with self.assertRaises(ProcessingError): jobs.get(bad)
        jobs.set_stage(job['id'], 'SECRET FROM LOG'); self.assertEqual(jobs.get(job['id'])['stage'], 'acquiring')
    def test_job_timeout_kills_process_group_and_removes_media(self):
        jobs = Jobs(self.path); row = {'id': jobs.submit(URL)['id'], 'source_url': URL}
        process = Mock(); process.pid = 999999; process.poll.return_value = None
        created = []
        original = tempfile.TemporaryDirectory
        def temporary(*args, **kwargs):
            obj = original(*args, **kwargs); created.append(obj.name); (Path(obj.name) / 'private-video.mp4').write_bytes(b'data'); return obj
        with (patch('service.jobs.subprocess.Popen', return_value=process), patch('service.jobs.os.killpg') as kill,
              patch('service.jobs.tempfile.TemporaryDirectory', side_effect=temporary), patch('service.jobs.time.monotonic', side_effect=[0, 2])):
            result = jobs.run_job(row, deadline_seconds=1)
        self.assertEqual(result['error']['code'], 'processing_timeout'); kill.assert_called_once()
        self.assertTrue(all(not Path(p).exists() for p in created))

class BootstrapTests(unittest.TestCase):
    def test_volume_permissions_prepared_before_permanent_privilege_drop(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'jobs.sqlite3').touch()
            calls = Mock()
            with (patch.dict(os.environ, {'REELTRIP_DATA_DIR': directory}), patch('service.bootstrap.os.geteuid', return_value=0),
                  patch('service.bootstrap.pwd.getpwnam', return_value=Mock(pw_uid=10001, pw_gid=10001)),
                  patch('service.bootstrap.os.chown', calls.chown), patch('service.bootstrap.os.chmod', calls.chmod),
                  patch('service.bootstrap.os.setgroups', calls.setgroups), patch('service.bootstrap.os.setgid', calls.setgid),
                  patch('service.bootstrap.os.setuid', calls.setuid), patch('service.bootstrap.os.umask', calls.umask)):
                prepare_volume()
            self.assertEqual([call[0] for call in calls.mock_calls], ['chown', 'chmod', 'chown', 'chmod', 'setgroups', 'setgid', 'setuid', 'umask'])
            calls.setuid.assert_called_once_with(10001)

class HttpTests(unittest.TestCase):
    def test_auth_requires_exact_nonempty_token_and_readiness_is_owner_configuration(self):
        self.assertTrue(authenticated('Bearer ' + TOKEN, TOKEN))
        for header, token in [(None, TOKEN), ('Bearer wrong', TOKEN), ('Bearer ', ''), ('bearer ' + TOKEN, TOKEN)]:
            self.assertFalse(authenticated(header, token))
        with patch.dict(os.environ, {}, clear=True): self.assertFalse(configuration_ready())
    def test_ambiguous_request_framing_never_dispatches_jobs(self):
        jobs = Mock()
        server = Server(('127.0.0.1', 0), jobs, ready=lambda: True)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for framing in ['Content-Length: 2\r\nContent-Length: 20', 'Transfer-Encoding: chunked\r\nContent-Length: 2', 'Content-Length: +2', 'Authorization: a\r\nAuthorization: b']:
                with socket.create_connection(server.server_address, timeout=2) as sock:
                    sock.sendall(('POST /v1/jobs HTTP/1.1\r\nHost: localhost\r\n' + framing + '\r\n\r\n{}').encode())
                    self.assertIn(b' 400 ', sock.recv(4096))
            jobs.submit.assert_not_called()
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_http_auth_queue_and_poll_contract(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'REELTRIP_PROCESSOR_TOKEN': TOKEN}):
            jobs = Jobs(Path(directory) / 'jobs.sqlite')
            server = Server(('127.0.0.1', 0), jobs, ready=lambda: True)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            base = 'http://127.0.0.1:' + str(server.server_port)
            try:
                with urllib.request.urlopen(base + '/health') as response:
                    health = json.load(response)
                    self.assertEqual({key: health[key] for key in ('ok', 'ready')}, {'ok': True, 'ready': True})
                    self.assertIn('configured', health['tiktok'])
                with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(base + '/v1/jobs/not-an-id')
                self.assertEqual(caught.exception.code, 401)
                request = urllib.request.Request(base + '/v1/jobs', data=json.dumps({'url': URL}).encode(), headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.status, 202); job = json.load(response)
                poll = urllib.request.Request(base + '/v1/jobs/' + job['id'], headers={'Authorization': 'Bearer ' + TOKEN})
                with urllib.request.urlopen(poll) as response: self.assertEqual(json.load(response), job)
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=2)

if __name__ == '__main__': unittest.main()
