import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import unittest
from unittest.mock import patch

from service.contracts import ProcessingError
from service.pipeline import process
from travel_workflow.http_transfer import TransferError
from travel_workflow.video_acquisition import AcquisitionError


class AcquisitionDiagnosticsTests(unittest.TestCase):
    def test_transport_failure_logs_safe_metadata_but_keeps_public_error_generic(self):
        error = TransferError('SECRET body https://private.example/key', 'http', status=502,
                              curl_code=0, stage='Instagram public query')
        output = io.StringIO()
        with redirect_stdout(output), patch('service.pipeline.acquire_media', side_effect=error), self.assertRaises(ProcessingError) as caught:
            process('https://www.instagram.com/p/DUS2TMzkbQn/', Path('.'))
        self.assertEqual(caught.exception.code, 'source_unavailable')
        self.assertEqual(json.loads(output.getvalue()), {'event': 'acquisition_failed', 'kind': 'http',
                         'status': 502, 'curl_code': 0, 'stage': 'Instagram public query'})
        self.assertNotIn('SECRET', str(caught.exception) + output.getvalue())
        self.assertNotIn('https://', output.getvalue())

    def test_unknown_metadata_and_plain_acquisition_errors_do_not_leak(self):
        for error in [TransferError('SECRET', 'SECRET', status='SECRET', curl_code=True,
                                    stage='https://private.example/key'), AcquisitionError('SECRET')]:
            output = io.StringIO()
            with redirect_stdout(output), patch('service.pipeline.acquire_media', side_effect=error), self.assertRaises(ProcessingError):
                process('https://www.instagram.com/p/DUS2TMzkbQn/', Path('.'))
            self.assertNotIn('SECRET', output.getvalue())
            self.assertNotIn('https://', output.getvalue())
            if isinstance(error, TransferError):
                self.assertEqual(json.loads(output.getvalue()), {'event': 'acquisition_failed', 'kind': 'unknown',
                                 'status': None, 'curl_code': None, 'stage': None})
            else:
                self.assertEqual(output.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
