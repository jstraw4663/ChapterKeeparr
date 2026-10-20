# Bedlam section identity and review workflow — 2026-10-20

## Finding and scope

The supplied screenshots and the US Audnexus timeline for `B0CDXWSS5D` exposed an identity collision, rather than evidence that the displayed timestamps need moving. The catalog places `1. Prologue` at 581.333 seconds and `I. Havana - Chapter 1` at 1918.059 seconds. The old parser treated the first label as chapter number 1 and failed to find the explicit number in the second. A synthetic “Chapter one” transcript therefore selected the Prologue at the Chapter 1 boundary. That bad anchor reserved Prologue, blocked its true marker and made Chapter 1 appear unlocated. A catalog-shaped synthetic replay reproduced 68/78 supported, 11 review decisions and 9 timing suggestions. Those counts do not constitute analysis of the actual recording's unseen evidence.

The evidence archive received on October 20 was a valid 45-byte gzip containing an empty tar. No report, transcript or recording was present. Actual audio/word-timing and full-file comparison remain pending. The earlier export command incorrectly assumed reports lived directly under the job folder; workers use attempt folders and the actual clips can live beside the library-side report. No real book or deployed job was changed during this implementation.

## Actual v2 evidence — October 20

The replacement archive was verified: 21 regular files, one report plus ten WAVs and ten transcript JSONs. SHA-256: `092844df9c506a422d014e3927c433ea1826d82e14c8c006b092b43ec82d613b`. It contains the first five boundaries with initial/retry clips, not the complete audiobook. Its saved draft used `alignment-recovery-4` and reported 68/78 supported markers. These private excerpts/report remain outside the repository.

All 78 saved local marker times pair with the published timeline within 0.037 seconds; the report's recording duration is 96431.063356 seconds versus the catalog's 96431.088 seconds. This supports retaining this file's boundaries, but does not prove complete audio or independently verify all chapters.

| File marker | Saved transcript evidence | Current parser result |
| --- | --- | --- |
| 0:00.000 | Audible identification | Opening Credits remains a review suggestion |
| 0:31.904 | Author acknowledgments; no section heading | OMG. What a floor! remains a review suggestion |
| 9:41.335 | Isolated Prolog segment at retry offset 8.56 s | 1. Prologue, spoken named heading |
| 31:58.061 | Part 1 / Havana, then Chapter 1 at offset 10.32 s | I. Havana - Chapter 1, spoken heading |
| 51:47.852 | Chapter Two at offset 9.04 s | Chapter 2, spoken heading |

Replaying the first-five saved transcripts with the current parser gives 69/78 supported after retaining the other saved evidence and running consistency checks. This is a partial replay, not a fresh full-book scan. Correcting the false match preserves Chapter 1's support and adds the true Prologue. The old preview alone demotes the bad assignment; explicitly redraft to generate corrected matches.

Both problem WAVs were also independently decoded and transcribed with the app's current Faster-Whisper `small.en` CPU/int8 path, four threads and one worker. Both new transcripts matched the correct sections. The two 36-second excerpts took approximately 10.5 and 11.1 seconds of inference; the process peaked at approximately 1.0 GiB RSS in this cloud workspace. This is an excerpt smoke test, not an Unraid or full-library performance benchmark. Fresh word evidence is retained locally; no larger model or wider window was necessary.

The remaining saved unresolved evidence includes part-prefixed Chapters 38/52, embedded Chapters 55/61 and Epilogue, plus Opening Credits/acknowledgments/Ending Skit/End Credits. Only the first-five WAVs were exported, so later candidates need a deployed redraft or separate excerpts. Do not infer unheard titles from timing or raise the audio score for manual decisions.

## Implemented

- Shared, bounded-cache section semantics keep the raw label and separate kind, explicit chapter number and optional part context. Decorated Prologue/Epilogue labels are not chapter ordinals; the Bedlam part-prefixed Chapters 1/38/52 are recognized. Decimal chapters, arbitrary narrative references and repeated ambiguous chapter identities are not forced into numbered matches. Ordinary verification and EPUB number matching use the same parser as recovery.
- Prolog/Prologue and Epilog/Epilogue aliases can match a clean heading. Embedded named headings require confident word alignment, a preceding pause, the existing boundary window and no nearby narrative-reference cue. Mixed named/numbered headings and repeated catalog identities stay unresolved. No expected title is supplied to speech recognition.
- A derived review of old evidence demotes impossible numeric-to-named assignments, duplicate identities, inverted recognition pairs and extreme residual outliers when at least six otherwise consistent anchors exist. Raw saved evidence is preserved; the conflicting assignment is retained as `prior_match` in normalized publication provenance. No title is replaced merely by choosing a nearby timestamp, and no timestamp is moved.
- Preview, acceptance and final navigation plans use the same normalized markers. Algorithm/semantic versions enter the draft token so old consent cannot authorize new evidence interpretation. `alignment-recovery-6` versions recognition/timing results; the existing model/PCM/word-timestamp transcript cache remains reusable. Normal redrafts still decode bounded excerpts and reuse identical cached speech results; they do not run a new full-book PCM decode or add per-chapter models/threads.
- Any automatic match can be opened with Change. Replacing it releases the former published section for another marker or explicit optional-section consent. Navigation removal also requires acknowledgement of a newly unassigned published section. The first marker stays protected, duplicate/order safeguards remain, and manual decisions cannot increase the original speech percentage. Progress bars do not count edited automatic matches twice.
- Chapter checks now show chronological Existing/Planned title pairs, evidence, Listen and Change, with All/Needs attention/Changed filters. The current recovery draft takes precedence over old checks; browser-local decisions appear immediately. Lists reveal in batches of 50, ordered decision cards in batches of 30. Matched-row edits have a way to restore the original audio match.
- Unknown section coverage is labelled “Published section not matched to a marker”; skipping is an explicit choice and is never tagged Suggested. A nearby blocked assignment links to its match. Counts describe decisions rather than pretending every unmatched published section is a local marker.
- Dense timeline marks remain visible, while nearby interactive targets are grouped to avoid overlapping 44px hit areas. Every chapter remains individually accessible through the list. The dependency-free component/token system and mobile gap-consent behavior remain.

## Validation

See the current milestone in `VALIDATION.md` for final commands/results. Added regressions cover decorated/part headings, actual Bedlam catalog times with synthetic transcripts, named word-time/pause/confidence/narrative negatives, conflicting headings, stale impossible matches, consistent global offsets, residual/order conflicts, released automatic identities, unchanged recognition denominators, full title comparisons and export failures.

The browser Bedlam case is explicitly synthetic. It includes an old check alongside an active draft, a false Prologue match, bulk suggestions, automatic-match rename/restore, chronological paired titles, filters, preserved edits, unchanged consent guards and accessibility checks. The full responsive suite and generated-media publication/audio/backup checks remain required. No audio-specific success or hardware benchmark is claimed until a populated export is reviewed.

## Testing after an owner-run image build

1. Run the branch test/image workflow, pull that image and verify its commit in Settings. A PR check alone does not publish an image.
2. Existing incorrect numeric-to-named matches should be shown as conflicts rather than retained as fixed anchors. Review the proposed pairs for the 09:41 and 31:58 markers. No source timestamps/audio should change.
3. To obtain fresh recognition with the new named-heading logic, explicitly use Draft the chapters again. Identical PCM/model evidence can use the persisted speech cache. New tokens require fresh approval; browser-local choices tied to old evidence do not silently carry over.
4. Inspect the entire Chapter checks list, including part-prefixed Chapters 38 and 52, and test Change/restore on an automatically matched row. Confirm a replaced section becomes assignable, with no duplicates, false missing-audio assertion or inflated audio score.
5. Export the report/excerpts with the checked exporter below for actual-recording validation before drawing conclusions about the two spoken boundaries.

## Reliable evidence export

`scripts/export_review_evidence.py` reads the existing SQLite job read-only, selects the job's recorded report/evidence/attempt paths and exports its report plus the first five saved clips and JSON, including initial attempts when available. It validates the required clips, refuses existing output, caps output inputs at 25 MiB and verifies archive contents before publishing the file. It does not copy the M4B or enumerate unrelated files. Tests exercise a library-side report and refuse missing clips/incorrect job IDs without leaving an empty output.

It can run in an older container through Python stdin. On Unraid, download the script from this branch to `/tmp/ck-export-review.py`, then use the actual container name and job ID:

```sh
curl --fail --location https://raw.githubusercontent.com/jstraw4663/ChapterKeeparr/feat/responsive-review-workspace/scripts/export_review_evidence.py --output /tmp/ck-export-review.py
CK_DIAGNOSTIC_CONTAINER=ChapterKeeparr-Test
CK_DIAGNOSTIC_JOB=YOUR_32_CHARACTER_JOB_ID
CK_DIAGNOSTIC_ARCHIVE=/tmp/chapter-review-$(date +%Y%m%d-%H%M%S).tar.gz
if docker exec -i "$CK_DIAGNOSTIC_CONTAINER" python - "$CK_DIAGNOSTIC_JOB" --output "$CK_DIAGNOSTIC_ARCHIVE" < /tmp/ck-export-review.py; then
  docker cp "$CK_DIAGNOSTIC_CONTAINER:$CK_DIAGNOSTIC_ARCHIVE" /mnt/user/Media/chapterkeeparr-test/
fi
```

A successful run prints its verified file list. Attach that archive for audio review. If the container/config/job is wrong or clips have been removed, it reports the concrete failure and does not copy an empty export.

## Sources

- [Audnexus US chapter metadata](https://api.audnex.us/books/B0CDXWSS5D/chapters?region=us).
- [Audnexus US recording metadata](https://api.audnex.us/books/B0CDXWSS5D?region=us).
- Current source and tests in this branch; prior catalog responses/reproductions remain in the development workspace's `chapterkeeparr-bedlam-investigation` folder.
