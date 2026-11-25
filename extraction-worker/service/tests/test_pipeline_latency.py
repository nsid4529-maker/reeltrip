from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch

from service.contracts import ProcessingError
from service.pipeline import process_record


class PipelineLatencyTests(unittest.TestCase):
    def test_sampling_and_audio_overlap_without_dropping_evidence(self):
        sampling, audio = threading.Event(), threading.Event()
        frames = [(0, Path('frame-00.jpg')), (29, Path('frame-01.jpg'))]
        transcript = {'text': 'Full speech', 'segments': [{'start': 0, 'end': 30, 'text': 'Full speech'}]}
        def sample(*args):
            sampling.set()
            self.assertTrue(audio.wait(1), 'Audio must start before sampling finishes')
            time.sleep(.02)
            return frames
        def transcribe(*args):
            audio.set()
            self.assertTrue(sampling.wait(1))
            time.sleep(.03)
            return transcript
        record = {'file': 'video.mp4', 'duration_seconds': 30, 'audio_present': True}
        with patch('service.pipeline.extract_frames', side_effect=sample), patch('service.pipeline.transcribe', side_effect=transcribe), patch('service.pipeline.analyse', return_value=({'source': {}}, {'attempts': [{}]})) as analyse:
            result = process_record(record, Path('.'))
        analyse.assert_called_once_with(record, frames, transcript)
        timings = result['usage']['phase_seconds']
        self.assertEqual(set(timings), {'sampling', 'transcription', 'preparation', 'analysis'})
        self.assertLess(timings['preparation'], timings['sampling'] + timings['transcription'])
        self.assertEqual(result['usage']['attempts'], [{}])

    def test_failure_in_either_preparation_stage_never_analyses_partial_evidence(self):
        record = {'file': 'video.mp4', 'duration_seconds': 30, 'audio_present': True}
        for failing in ('extract_frames', 'transcribe'):
            with self.subTest(failing=failing), patch('service.pipeline.extract_frames', return_value=[]) as frames, patch('service.pipeline.transcribe', return_value={}) as audio, patch('service.pipeline.analyse') as analyse:
                (frames if failing == 'extract_frames' else audio).side_effect = ProcessingError('media_invalid', 'Bad media')
                with self.assertRaises(ProcessingError):
                    process_record(record, Path('.'))
                analyse.assert_not_called()


if __name__ == '__main__':
    unittest.main()
