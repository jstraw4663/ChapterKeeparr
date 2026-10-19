"""Decode generated audio through the real speech dependency, without a model download."""
import io
import wave


def main():
    import av
    import requests  # Required by the metadata provider.
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio

    audio = io.BytesIO()
    with wave.open(audio, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b'\x00\x00' * 16000)
    audio.seek(0)
    samples = decode_audio(audio, sampling_rate=16000)
    if samples.shape != (16000,):
        raise RuntimeError(f'Speech decoder returned unexpected shape: {samples.shape}')
    print(f'Speech audio decoding passed (PyAV {av.__version__}, 16000 samples)')


if __name__ == '__main__':
    main()
