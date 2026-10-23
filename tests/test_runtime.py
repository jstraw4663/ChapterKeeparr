"""Exercise real speech dependencies; mocked inference cannot detect decoder drift."""
import hashlib
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import wave


class RuntimeTests(unittest.TestCase):
    def test_speech_dependencies_import_in_fresh_process(self):
        result = subprocess.run(
            [sys.executable, '-c', 'import requests; from faster_whisper import WhisperModel'],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_speech_decoder_reads_and_resamples_generated_audio(self):
        import numpy as np
        from faster_whisper.audio import decode_audio

        # LocalSpeech passes extracted WAV paths to faster-whisper. Exercise its
        # real decoder, including av.open(), without a model or online service.
        for channels, rate in ((1, 16000), (2, 48000)):
            with self.subTest(channels=channels, sample_rate=rate), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'excerpt.wav'
                samples = bytearray()
                for frame in range(rate // 4):
                    value = round(8192 * math.sin(2 * math.pi * 440 * frame / rate))
                    samples.extend(struct.pack('<' + 'h' * channels, *([value] * channels)))
                with wave.open(str(path), 'wb') as output:
                    output.setnchannels(channels)
                    output.setsampwidth(2)
                    output.setframerate(rate)
                    output.writeframes(samples)
                before = hashlib.sha256(path.read_bytes()).digest()

                decoded = decode_audio(str(path), sampling_rate=16000)

                self.assertEqual(decoded.dtype, np.dtype('float32'))
                self.assertEqual(decoded.shape, (4000,))
                self.assertTrue(np.isfinite(decoded).all())
                self.assertGreater(float(np.sqrt(np.mean(decoded ** 2))), .1)
                self.assertLessEqual(float(np.max(np.abs(decoded))), .26)
                self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), before)

    def test_deployed_runtime_smoke_script(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts' / 'check_speech_runtime.py')],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('16000 samples', result.stdout)
