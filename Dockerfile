FROM --platform=linux/amd64 python:3.12-slim-bookworm

ARG MODEL_REVISION=d1d751a5f8271d482d14ca55d9e2deeebbae577f
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL=/opt/models/small.en \
    MODEL_CACHE=/models \
    CONFIG_DIR=/config \
    WORK_DIR=/work \
    LIBRARY_ROOTS=/library \
    WORKERS=1 \
    ENABLE_WORKERS=1 \
    CPU_THREADS=4

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN python -m pip install -r requirements.txt \
    && python -m pip check \
    && python -c "import requests; from faster_whisper import WhisperModel"

# Resolve the model revision at build time. Override MODEL_REVISION with a
# Hugging Face commit ID for a reproducible model snapshot. The default is
# the verified repository commit below; "main" tracks the repository's
# current revision when this image is built.
RUN mkdir -p /opt/models/small.en /models \
    && MODEL_REVISION="$MODEL_REVISION" python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-small.en', revision=os.environ['MODEL_REVISION'], local_dir='/opt/models/small.en')"

COPY app ./app
COPY main.py ./main.py
COPY deploy/entrypoint.sh /usr/local/bin/chapterkeeper-entrypoint
RUN chmod 0755 /usr/local/bin/chapterkeeper-entrypoint \
    && mkdir -p /config /work /library /downloads /models \
    && chown root:root /opt/models /opt/models/small.en

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/chapterkeeper-entrypoint"]
CMD ["uvicorn", "app.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
