import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from travel_workflow.http_transfer import TransferError, curl_transfer
from travel_workflow.instagram_resolver import QUERY_URL, resolve_instagram
from travel_workflow.video_acquisition import AcquisitionError

SOURCE = 'https://www.instagram.com/reel/DUS2TMzkbQn'
TOKEN_PAGE = '<script>["LSD",[],{"token":"anonymous_test"}]</script>'


def payload():
    return {'data': {'xig_polaris_media': {'if_not_gated_logged_out': {
        'code': 'DUS2TMzkbQn', 'pk': '3824357847522718759', 'media_type': 2,
        'video_versions': [{'url': 'https://scontent.example.cdninstagram.com/video.mp4'}],
        'caption': {'text': 'Sri Lanka party guide'}, 'has_audio': True}}}}


class InstagramRetryTests(unittest.TestCase):
    def test_short_network_failure_retries_same_public_page_once(self):
        calls = []
        def respond(url, target, *_):
            calls.append(url)
            if len(calls) == 1:
                raise TransferError('Transfer failed', 'network', curl_code=56)
            target.write_text('<script type="application/json">'+json.dumps(payload())+'</script>')
            return 200, {}
        with patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond), \
             patch('travel_workflow.instagram_resolver.time.sleep') as sleep:
            result = resolve_instagram(SOURCE)
        self.assertEqual(calls, [SOURCE+'/', SOURCE+'/'])
        self.assertEqual(result['metadata']['source_shortcode'], 'DUS2TMzkbQn')
        sleep.assert_called_once_with(0.3)

    def test_query_503_retries_read_only_query_without_changing_provider(self):
        calls = []
        def respond(url, target, *_):
            calls.append(url)
            target.write_text(TOKEN_PAGE if len(calls) == 1 else json.dumps(payload()))
            return (503, {}) if len(calls) == 2 else (200, {})
        with patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond), \
             patch('travel_workflow.instagram_resolver.time.sleep'):
            result = resolve_instagram(SOURCE)
        self.assertEqual(calls, [SOURCE+'/', QUERY_URL, QUERY_URL])
        self.assertEqual(result['metadata']['caption'], 'Sri Lanka party guide')

    def test_retry_budget_is_shared_by_page_and_query(self):
        calls = []
        def respond(url, target, *_):
            calls.append(url)
            target.write_text(TOKEN_PAGE)
            return (200, {}) if len(calls) == 2 else (503, {})
        with patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond), \
             patch('travel_workflow.instagram_resolver.time.sleep'):
            with self.assertRaises(TransferError) as error:
                resolve_instagram(SOURCE)
        self.assertEqual(calls, [SOURCE+'/', SOURCE+'/', QUERY_URL])
        self.assertEqual((error.exception.kind, error.exception.status, error.exception.stage),
                         ('http', 503, 'Instagram public query'))

    def test_denial_removed_and_login_responses_never_retry(self):
        for status in (401, 403, 404, 410, 302, 307, 429):
            with self.subTest(status=status), \
                 patch('travel_workflow.instagram_resolver.curl_transfer', return_value=(status, {})) as transfer, \
                 patch('travel_workflow.instagram_resolver.time.sleep') as sleep:
                with self.assertRaises(AcquisitionError):
                    resolve_instagram(SOURCE)
                self.assertEqual(transfer.call_count, 1)
                sleep.assert_not_called()

    def test_rate_limit_retries_only_with_short_explicit_server_backoff(self):
        for after in (None, 'bogus', '-1', '3', '3600', 'Tue, 24 Nov 2026 21:00:00 GMT', '1'):
            calls = []
            def respond(url, target, *_):
                calls.append(url)
                target.write_text('<script type="application/json">'+json.dumps(payload())+'</script>')
                return (429, {} if after is None else {'retry-after': after}) if len(calls) == 1 else (200, {})
            with self.subTest(after=after), \
                 patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond), \
                 patch('travel_workflow.instagram_resolver.time.sleep') as sleep:
                if after == '1':
                    resolve_instagram(SOURCE)
                    self.assertEqual(len(calls), 2)
                    sleep.assert_called_once_with(1.0)
                else:
                    with self.assertRaises(AcquisitionError):
                        resolve_instagram(SOURCE)
                    self.assertEqual(len(calls), 1)
                    sleep.assert_not_called()

    def test_successful_http_does_not_retry_gating_or_identity_validation(self):
        wrong = payload()
        wrong['data']['xig_polaris_media']['if_not_gated_logged_out']['code'] = 'another'
        gated = {'data': {'xig_polaris_media': {'if_not_gated_logged_out': None}}}
        for body in (wrong, gated):
            def respond(url, target, *_):
                target.write_text('<script type="application/json">'+json.dumps(body)+'</script>'+TOKEN_PAGE)
                return 200, {}
            with self.subTest(body=body), \
                 patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond) as transfer:
                with self.assertRaises(AcquisitionError):
                    resolve_instagram(SOURCE)
                self.assertEqual(transfer.call_count, 1)

    def test_metadata_deadline_includes_retry_wait_and_query(self):
        now, budgets = [0.0], []
        def respond(url, target, seconds, *_):
            budgets.append(seconds)
            now[0] += seconds
            target.write_text(TOKEN_PAGE if url != QUERY_URL else json.dumps(payload()))
            return (503, {}) if len(budgets) == 1 else (200, {})
        def sleep(seconds):
            now[0] += seconds
        with patch('travel_workflow.instagram_resolver.time.monotonic', side_effect=lambda: now[0]), \
             patch('travel_workflow.instagram_resolver.time.sleep', side_effect=sleep), \
             patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond):
            with self.assertRaises(TransferError) as error:
                resolve_instagram(SOURCE)
        self.assertEqual(len(budgets), 3)
        self.assertAlmostEqual(now[0], 25)
        self.assertAlmostEqual(budgets[-1], 4.7)
        self.assertEqual(error.exception.kind, 'timeout')

    def test_local_certificate_and_size_failures_never_retry(self):
        with patch('travel_workflow.instagram_resolver.curl_transfer',
                   side_effect=TransferError('Transfer failed', 'transfer', curl_code=60)) as transfer:
            with self.assertRaises(AcquisitionError):
                resolve_instagram(SOURCE)
        self.assertEqual(transfer.call_count, 1)


class TransferDiagnosticsTests(unittest.TestCase):
    def test_only_known_transient_curl_errors_are_classified_for_retry(self):
        for code, kind in [(6, 'network'), (7, 'network'), (56, 'network'), (28, 'timeout'),
                           (23, 'transfer'), (60, 'transfer'), (63, 'transfer')]:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory, \
                 patch('travel_workflow.http_transfer.subprocess.run',
                       return_value=subprocess.CompletedProcess([], code, b'', b'secret signed URL')):
                with self.assertRaises(TransferError) as error:
                    curl_transfer('https://example.test/', Path(directory)/'body', 2.5, 1000)
                self.assertEqual((error.exception.kind, error.exception.curl_code), (kind, code))
                self.assertNotIn('secret', str(error.exception))

    def test_subprocess_cannot_outlive_transfer_budget_and_does_not_leak_command(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch('travel_workflow.http_transfer.subprocess.run',
                   side_effect=subprocess.TimeoutExpired(['secret signed URL'], 2.5)) as run:
            with self.assertRaises(TransferError) as error:
                curl_transfer('https://example.test/', Path(directory)/'body', 2.5, 1000)
        self.assertEqual(run.call_args.kwargs['timeout'], 2.5)
        self.assertEqual(error.exception.kind, 'timeout')
        self.assertNotIn('secret', str(error.exception))


if __name__ == '__main__':
    unittest.main()
