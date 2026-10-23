# Backend optimization and validation plan

Status: agreed direction; implementation deferred until the UI/UX optimization work.
Recorded: 2026-10-19.
Source reviewed: main at c94c05298ec90ffa45d1d432eb6541bb4045b6a3.
This document records the review and subsequent hardware decisions. It does not claim that any proposed backend, resource limit, benchmark, or integration is implemented.

## Executive recommendation

Retain FFmpeg, faster-whisper, SQLite, isolated worker processes, the publication gates, source fingerprints, backups, and atomic replacement. Improve edition ranking, metadata preservation, storage I/O, and bounded concurrency through small, independently validated changes. Evaluate Intel iGPU speech recognition behind a backend interface. Optimize verified throughput within a shared resource budget rather than increasing every worker/thread setting.

The deployment host is an Intel Core i9-12900K with Intel UHD Graphics 770 and 32 GB RAM. The owner wants low CPU/RAM use alongside other services. A local SSD can hold scratch audio, models, and caches; finished audiobooks belong on the array.

## Current evidence and limitations

- Libex supplies catalog search; Audnexus supplies ASIN metadata and chapter timelines. Audnexus obtains its timelines from Audible. These are not two independent timestamp sources.
- Recording identity, timing compatibility, speech verification, and content completeness are distinct claims.
- The engine checks up to ten candidate editions and returns the first metadata/timing pass; it does not rank all viable editions.
- Existing timing checks fit a single offset and preserve conservative limits. Named/chapterless and edited recordings remain harder cases.
- The worker holds a global media lock around the full workflow. Raising WORKERS does not currently enable heavy workflows to process concurrently.
- MP3 conversion creates full-book 44.1 kHz PCM scratch beside the source. A 20-hour file requires about 6.35 GB mono or 12.7 GB stereo PCM before other artifacts.
- Chapter-only repairs use stream copying and check chapter metadata, artwork presence, decoded output, and encoded audio hashes. Preservation of every unrelated/custom tag is not established.
- Compose defaults to one worker, four speech threads, a 4 GB memory ceiling, and a 10 GB reconstructible-cache budget. It does not specify a CPU quota.
- Recorded Mac MLX measurements do not establish Linux/Unraid performance. No new performance measurements on the owner's host have been made.

## Chapter sources, matching, and compatibility

Keep Audnexus as the default. Add a versioned provider interface and normalized reference model including provider, recording ID, region, exact times, runtime, original response, accuracy flags, and timeline hash. Retain brand intro/outro and source-quality provenance. The provider accuracy flag is not proof of a local-file match.

Candidate ranking should explain title/author/narrator compatibility, precise runtime differences, matched and unmatched boundaries, residuals, and discontinuities. Deduplicate aliases by timeline hash before repeating expensive analysis. Results must be stable when provider ordering changes. Recommend one edition only when evidence distinguishes it; ambiguous candidates remain a shortlist for review. Do not invent probability percentages.

Add explicit sidecar import before an authenticated Audible integration. Direct Audible access provides another access path to the same upstream data, not independent confirmation. MusicBrainz release tracklists are optional inputs requiring release/recording verification. Ordinary EPUB navigation provides titles and text, not arbitrary audiobook timestamps.

Use pooled provider access, shared rate limits, bounded retries, Retry-After, response caching, and explicit refresh. Keep outages separate from edition rejection. Regional fallback must be bounded and visible.

M4B/M4A/MP4 can contain QuickTime chapter tracks and Nero chpl markers; MP3 uses ID3 CHAP/CTOC; Ogg/Opus/FLAC use Vorbis-comment chapter conventions. Propose QuickTime-only M4B output for the initial Audiobookshelf/Apple Books compatibility target, subject to player tests, with a tested dual-output option when required. Do not change the default solely from the discussion post.

## Storage and publication

For conversion and expensive repeated analysis:

1. Capture the source inventory and create a verified SSD working copy.
2. Convert, transcribe, and validate on SSD. Prototype streaming PCM into one encoder while retaining measured sample counts for boundaries.
3. Recheck the source inventory before publication.
4. Copy the validated output into a temporary file on the destination filesystem, beside its final array path.
5. Verify the destination copy, retain required original backups, and publish using the existing atomic/no-clobber discipline.

A cross-filesystem SSD-to-array move is not an atomic replacement. Keep originals until the verified destination is committed. Test network-share interruption semantics on the actual host. Compare direct processing against SSD staging for an existing M4B needing only a few short excerpts; copying the entire book may not help.

Estimate and reserve scratch space per job before admitting it. Coordinate cache eviction, pin active and approval-bound artifacts, and do not treat the reconstructible-cache budget as a cap on reports, backups, or temporary PCM. Report retention must be explicit.

## Proposed operating profile

These settings are initial benchmark inputs, not measured requirements or implemented defaults:

| Resource | Low impact starting point |
| --- | --- |
| CPU budget | Two CPU equivalents shared across background work |
| CPU speech threads | Two; compare with four |
| Heavy work | One active stage initially |
| Speech model | At most one loaded model / active speech task |
| Metadata requests | Two concurrent, with shared provider rate limits |
| Memory ceiling | Keep 4 GB initially; measure total usage and headroom |
| Database, model, caches, scratch | Persistent local SSD |
| Final files | Array |
| Deeper reconstruction | On demand |
| Expanded concurrency | Test one GPU speech task alongside one CPU conversion after individual baselines |

Account for all FFmpeg children, speech threads, hashes, decodes, and model allocations. Respect container CPU/memory quotas rather than relying on host CPU count. Leave API work responsive. Keep subprocess isolation; the current worker mutates engine function references, so shared-thread workflows need an explicit refactor first.

Expose Low impact, Balanced, and Custom profiles using existing Settings patterns. Show the actual backend and clear waiting reasons. Do not expose unsupported controls as working.

## Intel iGPU evaluation

The current faster-whisper/CTranslate2 GPU path requires NVIDIA hardware. Evaluate OpenVINO GenAI Whisper GPU inference and, if useful, whisper.cpp/OpenVINO as optional implementations. The latter's documented integration accelerates the encoder. Intel Quick Sync Video does not accelerate the native AAC encoder used here.

Compare the same small.en model family and equivalent recognition options first. Keep model/precision/decoding settings and the backend implementation in transcript-cache identities. Validate segment times and required confidence evidence; missing confidence fields never authorize publication. Confirm GPU visibility and container access without a privileged container. Account for shared host RAM and any other use of the GPU.

Measure cold model load/compilation and warm short-excerpt inference separately. Retain a visible CPU fallback. Do not promise lower memory, power, or end-to-end latency until measured.

## Implementation sequence

1. Baseline telemetry and a reproducible benchmark harness.
2. Correctness fixtures, metadata preservation, format compatibility, and explainable edition ranking.
3. Explicit provider/media/speech/publication interfaces with equivalent existing outcomes.
4. Streaming conversion, SSD staging, and safe reuse of validated intermediates.
5. Resource-aware admission and stage concurrency; evaluate model reuse.
6. Operating profiles, waiting/progress explanations, and staged host validation.

Each change should be a separate reviewable PR. Update PROJECT-CONTEXT.md and VALIDATION.md only when actual milestones or measurements change. No production deployment, merge, or release tag is authorized by this plan.

## Validation and acceptance

### Fast regression suite

Use generated media and captured provider responses for deterministic offline tests. Cover Unicode/long titles, custom tags, series/narrator/ASIN fields, artwork, long books, more than 255 chapters, ordering, aliases, cached results, provider timeouts/429 responses, and all publication gates.

### Labeled audio corpus

Use copied, human-labeled recordings with numbered and named chapters, wrong narration/edition, edited credits, internal edits, missing markers, chapterless audio, split/merged tracks, and encoder padding. A generated tone does not test speech recognition.

### Integration, resource, and endurance tests

Run the Linux container under controlled CPU/RAM budgets, then on the actual Unraid host alongside normal services. Compare CPU two/four threads, OpenVINO cold/warm GPU, optional whisper.cpp/OpenVINO, SSD/direct I/O, then selected overlap. Measure stage and total time, total/cgroup memory, CPU, GPU shared memory, disk traffic/scratch, API p95 latency, cache hits, and power where available.

Faults must include duplicate/same-book submissions, concurrent different books, cancellation, worker death, restart near publication, unavailable network share, full scratch disk, input mutation, GPU failure, and concurrent cache eviction.

Acceptance:
- Zero false automatic acceptance in the deliberate mismatch fixtures.
- Correct expected chapter identities/times within defined tolerances.
- Unchanged encoded audio on chapter-only repair and preserved unrelated metadata.
- Safe originals/backups and recoverable job state on every fault.
- Candidate recommendations invariant to provider result ordering.
- Local queue/status API p95 below a provisional 500 ms on the target workload.
- Total memory below a provisional 80% of the configured limit on supported workloads.
- CPU/scratch remain within configured budgets.
- Better completed audio-hours per wall-clock hour at the same resource budget and verification quality.
- New or moved boundaries receive appropriate independent verification; existing thresholds are not loosened to improve throughput.

## Primary references

- [ChapterKeeparr source](https://github.com/jstraw4663/ChapterKeeparr/tree/c94c05298ec90ffa45d1d432eb6541bb4045b6a3)
- [FFmpeg chapter and format documentation](https://ffmpeg.org/ffmpeg-formats.html)
- [Audnexus chapter source](https://github.com/laxamentumtech/audnexus/blob/main/src/helpers/books/audible/ChapterHelper.ts)
- [CTranslate2 hardware support](https://opennmt.net/CTranslate2/hardware_support.html)
- [OpenVINO Whisper pipeline](https://docs.openvino.ai/2026/api/genai_api/_autosummary/openvino_genai.WhisperPipeline.html)
- [whisper.cpp OpenVINO](https://github.com/ggml-org/whisper.cpp#openvino-support)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Audiobookshelf](https://github.com/advplyr/audiobookshelf)
- [m4b-tool](https://github.com/sandreas/m4b-tool), [auto-m4b](https://github.com/seanap/auto-m4b), [tone](https://github.com/sandreas/tone), [ChapterForge](https://github.com/tillt/ChapterForge)
- [Libation formats](https://getlibation.com/docs/features/audio-file-formats), [AAX Audio Converter](https://github.com/audiamus/AaxAudioConverter), [ABChapterize](https://github.com/Inguiotar/ABChapterize)
- [Original metadata-preservation discussion](https://superuser.com/questions/1877167/how-to-add-chapter-marks-to-mp3-mp4-and-ogg-files-via-the-command-line-withou)
