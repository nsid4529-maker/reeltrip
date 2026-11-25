import json
import unittest
from unittest.mock import patch

from travel_workflow.instagram_resolver import parse_resolution, resolve_instagram
from travel_workflow.video_acquisition import AcquisitionError


SOURCE = 'https://www.instagram.com/reel/DWlHTMUE2tW/'
PICTURE_PATH = ['xig_polaris_media', 'if_not_gated_logged_out', 'location', 'profile_pic_url']


def payload():
    return {
        'data': {'xig_polaris_media': {'if_not_gated_logged_out': {
            'code': 'DWlHTMUE2tW', 'pk': '3865527960384793430', 'media_type': 2,
            'video_versions': [{'url': 'https://scontent.example.cdninstagram.com/video.mp4'}],
            'has_audio': True, 'caption': {'text': 'Example travel caption'},
            'location': {'profile_pic_url': None},
        }}},
        'errors': [{'path': PICTURE_PATH, 'message': 'A server error field_exception occured.'}],
    }


class InstagramPartialResponseTests(unittest.TestCase):
    def test_embedded_related_post_cannot_hide_requested_public_video(self):
        wrong = payload()
        wrong['data']['xig_polaris_media']['if_not_gated_logged_out'].update(code='another', pk='123')
        html = '<script type="application/json">'+json.dumps([payload(), wrong])+'</script>'
        def respond(url, target, *args):
            target.write_text(html)
            return 200, {}
        with patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond) as transfer:
            result = resolve_instagram(SOURCE)
        self.assertEqual(result['metadata']['source_shortcode'], 'DWlHTMUE2tW')
        self.assertEqual(transfer.call_count, 1)

    def test_gated_embedded_post_does_not_trigger_query_fallback(self):
        gated = {'data': {'xig_polaris_media': {'if_not_gated_logged_out': None}}}
        html = '<script type="application/json">'+json.dumps(gated)+'</script>'
        html += '<script>["LSD",[],{"token":"anonymous_test"}]</script>'
        def respond(url, target, *args):
            target.write_text(html)
            return 200, {}
        with patch('travel_workflow.instagram_resolver.curl_transfer', side_effect=respond) as transfer:
            with self.assertRaises(AcquisitionError):
                resolve_instagram(SOURCE)
        self.assertEqual(transfer.call_count, 1)

    def test_location_picture_failure_keeps_valid_video_and_evidence(self):
        result = parse_resolution(SOURCE, payload())
        self.assertEqual(result['metadata']['source_shortcode'], 'DWlHTMUE2tW')
        self.assertEqual(result['metadata']['caption'], 'Example travel caption')
        self.assertTrue(result['metadata']['reported_has_audio'])
        self.assertTrue(result['metadata']['source_identity_checked'])

    def test_other_errors_and_malformed_error_paths_are_rejected(self):
        base = ['xig_polaris_media', 'if_not_gated_logged_out']
        paths = [None, [], 'location.profile_pic_url', base, ['xig_polaris_media', 'gating_ruling'],
                 *[base + [field] for field in ('code', 'pk', 'video_versions', 'has_audio', 'caption')],
                 PICTURE_PATH + ['unexpected']]
        for path in paths:
            with self.subTest(path=path):
                body = payload()
                body['errors'].append({'path': path})
                with self.assertRaises(AcquisitionError):
                    parse_resolution(SOURCE, body)
        for errors in ('error', {}, [None], [{'message': 'unknown error'}]):
            with self.subTest(errors=errors):
                body = payload()
                body['errors'] = errors
                with self.assertRaises(AcquisitionError):
                    parse_resolution(SOURCE, body)

    def test_picture_exception_never_waives_access_identity_or_media_checks(self):
        for field, value in [('code', 'another'), ('pk', '123'), ('media_type', 1),
                             ('video_versions', []), ('carousel_media', [{}]),
                             ('video_versions', [{'url': 'https://evil.example/video.mp4'}])]:
            with self.subTest(field=field, value=value):
                body = payload()
                body['data']['xig_polaris_media']['if_not_gated_logged_out'][field] = value
                with self.assertRaises(AcquisitionError):
                    parse_resolution(SOURCE, body)
        body = payload()
        body['data']['xig_polaris_media']['if_not_gated_logged_out'] = None
        with self.assertRaises(AcquisitionError):
            parse_resolution(SOURCE, body)
