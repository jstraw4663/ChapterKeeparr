# ChapterKeeparr 0.4.1 (alpha)

This release starts the alignment-recovery plan: persisted timing diagnostics, bounded search recovery, file minutes during matching, and an on-demand local-marker audio/EPUB draft. Use **Review markers from audio** after selecting an ASIN. Drafts do not publish or change your audiobook; unresolved sections remain visible. See `PROJECT-CONTEXT.md` for implementation status and real-book findings.

ChapterKeeparr is a local audiobook chapter-repair workbench. Its current workflow is a persistent job queue: verified results publish automatically, while uncertain matches pause for human review. It runs as one Linux/amd64 container, serves the web UI and API on port 8000, stores SQLite state under `/config`, and uses CPU-only faster-whisper with the bundled `small.en` model and FFmpeg.

This alpha has no BookOrbit adapter. It does not watch download folders, consume torrent payloads, or import completed books into another library manager. You can submit a finished audio file from the mounted library to `/api/jobs`; the job is queued for automatic verification in ChapterKeeparr. Confirm BookOrbit's installed API and which application owns importing before building an adapter. The `/downloads` mount is read-only and is not a job source.

## Build and run

Install Docker Engine or Docker Desktop with Compose, then from this directory run:

```sh
mkdir -p config
docker compose up -d --build
```

For a first run without an env file, `docker compose up -d --build` uses the compose defaults. Set `LIBRARY_HOST_PATH`, `DOWNLOADS_HOST_PATH`, and `CONFIG_HOST_PATH` in `.env` to paths on the Docker host. The library path is writable so a verified job can update tags; the downloads path is mounted read-only. Make sure the container user can access the library files and folders.

Example `.env`:

```dotenv
PUID=99
PGID=100
CHAPTERKEEPER_BIND=127.0.0.1
CHAPTERKEEPER_PORT=8000
LIBRARY_HOST_PATH=/mnt/user/media/audiobooks
DOWNLOADS_HOST_PATH=/mnt/user/usenet/downloads
CONFIG_HOST_PATH=/mnt/user/appdata/chapterkeeparr/config
CHAPTERKEEPER_API_TOKEN=replace-with-a-long-random-secret
WORKERS=1
ENABLE_WORKERS=1
CPU_THREADS=4
```

The CPU-only setup starts one web/API process and one background book worker, using four speech-recognition threads per job. Keep this baseline for a light memory footprint, then benchmark before increasing `WORKERS` (supported range 1–8) or `CPU_THREADS`. Compose publishes the API on localhost by default. For direct LAN/VPN access, explicitly set `CHAPTERKEEPER_BIND=0.0.0.0` or bind to that interface’s address, then set a strong API token. Keep the default loopback binding when an existing reverse proxy on the host will provide HTTPS. Compose defaults to a 4 GB memory limit and the same 4 GB total memory-plus-swap limit; adjust `MEM_LIMIT` and `MEMSWAP_LIMIT` together if your host needs a different cap. The transcript JSON cache defaults to a 10 GB budget under `/config`. That budget does not cap the database, job reports, or host backups, which also use space under `/config`. Audio processing scratch files are created beside the source in the library share, so allow room there too. GPU/iGPU acceleration is not included in this alpha; an iGPU backend is a later phase. Set `CHAPTERKEEPER_API_TOKEN` to a long random value before exposing the port beyond a trusted host. Leave it empty only for isolated local use. Authenticated API requests use `Authorization: Bearer <token>`. The helper at [`scripts/submit-job.py`](scripts/submit-job.py) submits a file path as JSON to `POST /api/jobs`; it never uploads the audio bytes. Run it on the Docker host with the path as it appears inside the container (for example `/library/Author/Book title.m4b`):

```sh
CHAPTERKEEPER_API_TOKEN='your-token' python3 scripts/submit-job.py \
  '/library/Author/Book title.m4b'
```

The helper prints the API response. The submitted path must be inside the configured library root and visible at that same path in the container. You can also set `CHAPTERKEEPER_URL` to the API base URL, or pass `--url`.

## iPhone access

The responsive web UI includes an installable PWA shell. To add it on iPhone, first reach the server over HTTPS using a trusted hostname and certificate. If access is private, connect through your VPN; an existing reverse proxy can provide HTTPS. For direct access over VPN, set `CHAPTERKEEPER_BIND` to the server’s VPN interface address (or use your proxy’s supported upstream path). In Safari, open the HTTPS address, use Share, then choose **Add to Home Screen**. Enter the API token in Settings if the server requires one. The shell can be installed, but job submission, browsing, and review still require a live connection to ChapterKeeparr; it does not cache private job data or queue offline changes. The iPhone install flow has not yet been checked on a physical device. The Unraid template publishes its port on the host, so configure a strong API token and restrict network access before starting it.

Do not expose an unauthenticated ChapterKeeparr port to the public internet. Keep token protection enabled and use your existing VPN or authenticated HTTPS reverse proxy for remote access.

## Unraid

Build the image on a Docker-capable machine with `docker compose build`, then transfer it to Unraid or publish it to a private registry and set the template's Repository field to that image. The included [`deploy/unraid-template.xml`](deploy/unraid-template.xml) is a starting template: update the image repository and host share paths for your installation. Map `/config` to a persistent appdata directory, `/library` to the audiobook library with read/write access, and `/downloads` to the downloads share with read-only access. Set the PUID and PGID to the IDs that own the host media files. Do not grant the container privileged mode or Docker socket access.

## Model revision and rebuilds

The Docker build downloads the CTranslate2 `small.en` model into `/opt/models/small.en`, so the runtime does not need model downloads. The default Hugging Face revision is the full commit `d1d751a5f8271d482d14ca55d9e2deeebbae577f`. You can override it at build time with `MODEL_REVISION=<commit-id> docker compose build`; avoid `main` when you need the exact same model snapshot on later rebuilds. Model files and all Python dependencies are part of the image. The model is licensed under MIT; see the [upstream model card](https://huggingface.co/Systran/faster-whisper-small.en).

`ENABLE_WORKERS` turns the background job worker on (default 1). `WORKERS` sets the concurrent book job slots (default 1, supported range 1–8); `CPU_THREADS` controls speech recognition threads per job (default 4). Leave headroom for the operating system and any other containers. Audio processing uses the source library filesystem, so account for its available space when planning jobs.

## Matching and review

Submit any library level to discover individual books. Multiple MP3s convert to an M4B; existing M4Bs enter chapter verification. Matching successful receipts skip unchanged books. In an awaiting-review job, search by free text or ASIN, compare narrator/runtime/publisher, select a candidate, then submit to resume. Selection does not bypass edition, timeline, or speech checks. Text searches use Libex; ASIN and chapter metadata use Audnexus. Provider outages remain reviewable errors. Metadata search is online; speech recognition runs locally.

## Validation and current limits

The included Python tests exercise SQLite leases, duplicate submission, cancellation, review persistence, API restrictions, provider failures, and a real FFmpeg conversion/repair fixture (online metadata and speech decisions are mocked in that fixture). Run `python -m unittest discover -s tests -v` after installing requirements plus `httpx`. Browser smoke checks cover desktop and a 390-pixel mobile viewport, live search/selection, and the PWA shell. Docker image execution and physical iPhone installation still require validation on your hardware.

A stopped worker is marked failed after its lease expires and requires an explicit retry. Cancellation takes effect at a safe checkpoint; it does not interrupt publication. Configure one worker initially. Additional slots can perform speech checks concurrently, while encoding/remuxing is serialized. Reports and backups are retained for diagnosis and have no automatic retention policy yet. Monitor appdata and share capacity. This build supports the inherited English AAC verification workflow; alternate audio formats and automatic alignment of chapterless books are not yet supported.

CLI compatibility: `python3 main.py "/path/to/book"` invokes the existing engine. For server integrations use the submission helper so the durable queue owns execution.


## 0.2.0 UI update

- New job: choose a folder, click **Find audiobooks**, then select the books to queue. **Select all** is at the top; clear it to choose a subset. Selecting a folder in Browse scans it automatically. A scan does not queue or modify files. The server rechecks the selection when you submit it.
- Jobs become stacked cards on phones. Status text stays visible; jobs needing attention appear first in Jobs and Overview. The attention metric opens the filtered queue.
- Overview shows running books, the latest worker message, and estimated workflow progress (not an elapsed-time estimate). Match-search buttons open the review form at the top of Job Details.
- Cover images use provider artwork when available, otherwise common local cover files or embedded artwork. Older completed jobs can use local artwork without reprocessing.
- Completed/skipped M4B jobs show the actual embedded chapters under **Chapter Details**. Tap a chapter to play from its start, another to switch, or the active chapter to stop. Playback stops at that chapter's end and when leaving the page. The server streams byte ranges rather than fetching the entire audiobook into browser memory.
- Chapter/audio previews are read-only. If API authentication is enabled, audio uses short-lived, file-scoped playback tickets; the server token is not put into audio URLs. Artwork thumbnails are cached under `/config/media-cache`.

### Upgrade on Unraid

Wait for active processing to finish, then stop the container. Extract this release and copy the contents of its `chapterkeeparr/` directory into `/mnt/user/appdata/chapterkeeparr/source/`, replacing the source files. Keep the existing `/config` mapping and its files.

```sh
cd /mnt/user/appdata/chapterkeeparr/source
docker build -t chapterkeeparr:latest .
```

In Unraid, edit the existing container, set or update an environment variable `CHAPTERKEEPER_BUILD` to `0.2.1`, and Apply to recreate the container with the rebuilt image and existing mappings. A plain restart keeps the old image. For Compose deployments, use `docker compose up -d --build` instead. Reload the browser/PWA after the container starts.

No new runtime dependencies are needed. This release does not add BookOrbit integration or GPU processing.

## 0.2.1 UI update

All four dashboard count cards open the corresponding Jobs filter and clear any old text search. Completed shows successful completions only; Finished remains available for all terminal states. Review search has a **Use filename** button that removes the audio extension and lets you edit before searching. Chapter-alignment recovery is proposed in `ALIGNMENT-RECOVERY-PLAN.md`; the processing thresholds and recovery engine are unchanged in this release.

## Gated workflow (0.4.0)

Each book now shows Inspect → Match → Align → Verify → Save, evidence grades, and a targeted review action. See [WORKFLOW-GUIDE.md](WORKFLOW-GUIDE.md) for the process and decision tree. MP3 track/disc gaps block early; content warnings and recovery drafts cannot publish. Timing failure can trigger automatic local-marker review for one unambiguous compatible timeline. Fingerprinted conversions are retained for retries within the cache budget; all publication checks still run.

The coverage heuristics are conservative and can flag harmless edits; no grade proves every passage is present. Editable/reconstructed draft publication remains unimplemented. CACHE_MAX_GB bounds retained conversions plus transcript cache; diagnostic reports/excerpts are retained separately. The worker serializes heavy processing across jobs.
