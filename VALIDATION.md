# Build validation — 2026-09-23

- 17 Python tests passed with FastAPI 0.115.12 / Uvicorn 0.34.2 web dependencies.
- Generated MP3 fixture converted and repaired using real FFmpeg/ffprobe; MP3s removed after success and NFO preserved. Metadata/speech decisions mocked in this fixture.
- Live public catalog text search found Dungeon Crawler Carl B08V8B2CGV.
- Headless Chrome: 390 px mobile and 1440 px laptop views; no horizontal overflow at 390 px. Search → select → retain selection across refresh → submit review → queued passed.
- PWA service worker activated; shell loaded offline, mutations disabled, no /api responses cached.
- JavaScript syntax, Unraid XML and shell entrypoint checks passed.

Not yet validated: actual Docker build/start, bundled Linux speech model in the container, physical iPhone/Safari installation, Intel iGPU backend, BookOrbit integration. Test against copied books before allowing writes to the primary library.

## 0.1.1 dependency fix

Unraid build and container startup were confirmed by the user. First speech import failed because faster-whisper 1.1.1 imports requests without declaring it directly. Added requests 2.32.5 and build-time pip check / real speech import. Local dependency checks and all 18 tests passed, including a new fresh-process speech import regression. The corrected Linux image must still be rebuilt and exercised on Unraid.


## 0.2.0 validation

- All 24 Python tests passed, including real FFmpeg conversion/repair, chapter extraction, byte-range playback (206), API authentication, ticket expiration/file-change invalidation, media path confinement, cover extraction without modifying inputs, and selective batch submission.
- Headless Chrome at 320, 390, 430, and 1440 px: Jobs has no page-level horizontal overflow; mobile rows are cards with readable status labels.
- Browser checks: attention sort/filter, match shortcut and search selection with fixture provider results, cover rendering, actual chapter seek/play/switch/stop, playback retained through polling, and folder discovery → clear Select all → choose three → submit only those three paths.
- Screenshots reviewed for mobile Jobs, chapter details, and audiobook selection. Test audio was generated locally; no user audiobooks were changed.
- Physical iPhone/Safari and the updated Docker image have not been tested locally. The user confirmed the preceding 0.1.1 container processed a book successfully on Unraid. The 0.2.0 image still needs rebuilding there.

## 0.2.1 validation

JavaScript syntax and focused headless Chrome checks passed for all four dashboard routes/filters, completed-only results, phone-width layout, and filename autofill without an automatic search. No processing-engine changes.

## 0.3.0 initial alignment recovery — 2026-09-24

- 37 Python tests pass, including real FFmpeg conversion/audio preservation, cache invalidation, failed-candidate deduplication, timeline aliases, search 404 fallback, current-file duration and authenticated report downloads.
- New recovery fixtures cover rounded timestamps, small drift/internal edits and chapterless rejection, repeated/conflicting/low-confidence headings, explicit nonsequential numbering, named headings, unique versus duplicate EPUB openings, partial checkpoints on interruption, and the worker's draft-only branch.
- Existing cancellation, restart/lease, path confinement, authentication and media mutation guards pass.
- Headless Chrome at 390 and 1440 px: runtime display, difference plot including unmatched anchors, real 107-marker draft, authenticated report download, edition selection and local-marker recovery queue request. No JavaScript errors or horizontal overflow.
- Read-only real-book comparison reproduces Parade's 58/106 failure and shows Bedlam Bride passing 77/77 timing anchors. The exact formerly failing catalog URL returned HTTP 200 during this investigation; the historical provider cause remains unknown.
- Real MLX small.en scan at all 107 existing Parade markers: 149 seconds, peak RSS 855,261,184 bytes; identical source SHA-256 before/after. Re-evaluated saved transcripts with unique named/EPUB evidence: 102 supported markers, 5 unresolved markers, 6 unresolved reference sections. All remain a draft; nothing published.
- JavaScript syntax passes. Dependencies and container base/model are unchanged.

Not validated here: Linux/amd64 Docker build, Unraid CPU speech performance, the full roadmap's deeper scanning/drift fitting/edit-and-publish UI. A Mac MLX benchmark cannot establish the container's 4 GB memory behavior. Recovery drafts intentionally cannot authorize publication.
