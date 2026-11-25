import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest

from service.jobs import Jobs


class JobMetricsTests(unittest.TestCase):
    def test_logs_only_bounded_phase_numbers(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = Jobs(Path(root) / 'jobs.db')
            output = io.StringIO()
            with redirect_stdout(output):
                jobs.finish('test-job', {'result': {'source_url': 'private-source', 'usage': {
                    'api_key': 'secret', 'phase_seconds': {'sampling': 3.14159,
                    'analysis': float('inf'), 'transcription': True,
                    'preparation': -1, 'acquisition': 'secret', 'unknown': 4}}}})
            logged = json.loads(output.getvalue())
            self.assertEqual(logged['phase_seconds'], {'sampling': 3.142})
            self.assertNotIn('private-source', output.getvalue())
            self.assertNotIn('secret', output.getvalue())
