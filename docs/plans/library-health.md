# Library health redirection

## Goal and deployment

Evolve ChapterKeeparr into a library maintenance tool on the existing FastAPI,
SQLite, plain ES-module UI and Unraid container platform. BookOrbit 3.6 owns
acquisition, catalog organization and chapter editing; BookBridge owns position
alignment. Target one ordinary EPUB and one chaptered M4B per selected edition,
with explicit exemptions and intentional alternate editions supported.

Jeremy has approximately 135 books in one Jereamworks library. Production host
`/mnt/user/Media/books/` is `/books` in BookOrbit and will be `/library` here.
Currently `/library` maps to `/mnt/user/Media/chapterkeeparr-test/`; keep that
mapping during development. `/config` maps to
`/mnt/cache/appdata/chapterkeeparr/config`.

## Phases and acceptance

1. **Inventory foundation (implemented):** authenticated, persistent, read-only folder
   scans independent of repair jobs. Record formats, size, modification time,
   inode/device/link count; identify missing target formats, multiple candidates,
   mismatched pair names, sidecars and empty media. Skip symlinks and special
   files, report incomplete scans, enforce configured root boundaries. Folder
   groups are candidates, not verified work/edition identities. No corruption or
   physical-space claims from inventory alone.
2. **Review workspace and deeper inspection (initial milestone implemented):** reuse Library, Suggestions, Book,
   Queue and Settings patterns in both themes at 390px and desktop. Add scan
   history/listing, paginated findings, background scan jobs with cancellation,
   stable file identities and incremental rescans. Inspect EPUB ZIP/CRC,
   container/OPF/spine references and audio streams/duration/chapters; offer full
   decode separately. Distinguish invalid, unreadable, DRM, unsupported and
   uninspected files. Exact duplicates require hashes; metadata similarity only
   proposes an edition comparison. Persist exemptions and keeper selections.
   Compare configured BookOrbit organization rules before proposing folder moves.
3. **Staged preparation:** read-only BookOrbit capability/path mapping checks;
   metadata proposed from BookOrbit, preserving narrator/language/edition fields.
   Preview embedded metadata changes. Support MP3-to-M4B and DRM-free MOBI/AZW3
   to EPUB. Preserve compatible audio without re-encoding; otherwise default
   AAC 128 kbps without upsampling or increasing channel count. Review track
   order and retain existing chapter provenance; track boundaries do not prove
   narrative chapters. Text PDF conversion requires individual review; scanned
   PDFs and DRM get replacement suggestions. Use isolated staging, disk budget
   checks and cancellation. Validate output before offering publication.
4. **Publication and cleanup:** recheck source fingerprints, target collisions,
   active-book protection and BookOrbit/BookBridge relationships. Publish only
   reviewed plans, with durable operation journal, backups and restart recovery.
   Never open hardlinked source files for content mutation: create independent
   output, then replace only the library entry. Restrict moves/removals to the
   configured library; never traverse download/seeding roots. Quarantine originals
   until manual purge, with restore and explicit destructive confirmation. Report
   physical reclamation conservatively, accounting for external links, backups,
   sparse files and filesystem limitations. Preserve BookOrbit IDs/progress and
   require review/re-alignment for EPUB content or audio timeline changes. Disable
   integrated publication if installed API behavior cannot be verified safely.

## Interfaces and current slice

`POST /api/library/scans` accepts `{ "path": "/library" }`, returns HTTP 202,
and queues one structural inventory scan at a time. `GET /api/library/scans`
returns bounded history/summary records; `GET /api/library/scans/{id}` returns
saved evidence, status, progress and fingerprint-bound review choices. Cancel via
`POST /api/library/scans/{id}/cancel`; record/reopen an intentional exception via
`PUT /api/library/scans/{id}/review` with folder, finding key, fingerprint and
note (null reopens). Restart-interrupted scans fail visibly; queued scans resume.
The inventory worker is independent of ENABLE_WORKERS and the repair queue.

The Library home now presents scan controls/history, summary rows, filters,
search/sort, paged folder lists and responsive file/finding review. Existing
repair jobs remain at `#/repairs`. EPUB structure/CRC and bounded local audio
probing run during scans; unsupported/oversize files remain explicitly uninspected.
Review choices never authorize a file mutation and reopen when evidence changes.
Additive SQLite migrations preserve earlier reports and repair state. No media
writes, conversion, BookOrbit calls, deep audio decoding or edition verification
are included in this review milestone. Exact duplicate hashing, library-wide
edition grouping, incremental scanning and server-side result pagination remain
future phase-2 work; multiple same-format files are only comparison candidates.

## Validation and rollout

Use synthetic/copy-only fixtures initially, including World War Z-like duplicate
EPUBs, mismatched names, hardlinks to an outside seed fixture, symlink escapes,
unreadable paths and empty media. Assert seed bytes/inode/mtime remain unchanged.
Test authentication, root boundaries, persistence/reopen and file limits. Later
add malformed EPUB, generated audio decode, stale plans, cancellation, low disk,
crash recovery, quarantine restore, API incompatibility and active-book tests.
Run relevant Python suites and JS syntax/frontend checks. Validate on the test
mapping before a production read-only audit; enable writes only after publication
and restore tests pass. Jeremy controls image publication, merging and releases.
