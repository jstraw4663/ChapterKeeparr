# Chapter alignment recovery — original proposal

Implementation has started in 0.3.0 alpha. This document retains the design scope; see PROJECT-CONTEXT.md for what is implemented and what remains.

## What this failure tells us

The screenshot shows ASIN B0FXY6DVJS failing with 58 matches out of 106 usable anchors. The current `fit_timeline` uses the smaller of the local/reference nonzero boundary counts as that denominator. It requires at least six matches and 80% coverage, residuals within 0.35 seconds of one global offset, anchors spanning the recording, and runtime within 90 seconds of the published chapter timeline. This case fails before speech review. It does not establish that the selected edition is wrong.

Existing EPUB support reads table-of-contents titles and chapter openings, then uses openings as supporting speech-check evidence when numbered chapter sets agree. It does not independently reconstruct timestamps. Current catalog recovery can try alternatives, but timing-rejected candidates are not consistently recorded in the attempted-ASIN set, allowing duplicate attempts.

## Phase 1: diagnosis and edition recovery

1. Persist local chapter starts/titles, reference chapter starts/titles, both runtimes, matched pairs, unmatched ranges, fitted offset, and timing residuals for every attempted edition. Show a difference plot and a plain-language reason in Job Details. Expose authenticated report download links.
2. Deduplicate candidates by ASIN and region; detect identical timeline hashes across regional IDs. Cache each outcome against the audio fingerprint, timeline hash, and algorithm version. A corrected identity, changed file/timeline, or explicit retry can invalidate that outcome.
3. Search other plausible editions automatically, with bounded provider requests and a visible attempt count. Preserve title/author/narrator/language/unabridged checks. Regional duplicates and different narration should be clearly labeled; do not treat search result count as a count of compatible recordings.
4. Separate recording identity confidence from timing confidence. A correct identity can proceed to reconstruction even when imported markers are poor. Do not repeatedly ask the user to select the same book.

## Phase 2: recover from the actual audio

Try progressively more expensive strategies, preserving the existing fast path:

- **Local boundary review:** transcribe around existing markers, confirm spoken chapter numbers or distinctive chapter-opening text, and determine whether current timestamps can be preserved with new titles.
- **Timing model diagnosis:** compare global offset, small linear drift, and separately aligned sections. Use order-preserving one-to-one anchors, independent holdout checks, and explicit uncertainty around discontinuities. A fitted curve alone cannot authorize publication; silence alone cannot establish a chapter boundary. Missing content must remain an unresolved gap, not be hidden by stretching the timeline.
- **EPUB-assisted reconstruction:** use a matching EPUB's spine/TOC, headings, and several distinctive passages per chapter. Match those passages against local audio transcripts, then refine nearby chapter starts. Detect duplicate/short openings and narration/text differences. EPUB timestamps cannot normally be assumed: ordinary TOC entries point to text; optional media overlays provide synchronized audio only for the corresponding included recording.
- **Audio-only reconstruction:** when no matching EPUB exists, use candidate edition titles plus spoken headings detected in audio. Missing or ambiguous headings remain unresolved. If narrow windows cannot locate them, offer a deeper chunked scan.
- **Timestamp refinement:** evaluate a word-alignment backend for short confirmed passages if the current speech model cannot locate starts accurately enough. WhisperX is a possible optional backend, not a dependency to add without a CPU-memory benchmark. Forced alignment requires corresponding text/audio and is not itself proof of a correct edition.

Always distinguish Opening credits, Prologue, numbered chapters, Epilogue, and Closing credits. Preserve explicit book numbering, including intentional nonsequential numbering. Do not manufacture one chapter for each input track or assign EPUB titles by list position. Allow one book chapter to span several existing tracks and several chapters to occur inside one track.

## Review UI and publication

Show actions appropriate to the reason: **Try other editions**, **Rebuild from audio**, **Use EPUB**, and **Review markers**. Label the selected recording separately from the proposed chapter plan. For each proposed marker show title, old/new timestamp, supporting transcript or text, source, and confidence; allow auditioning paused-job source audio through the same confined streaming service. Add edit-time/title controls, rescan-this-section, save draft, and resume.

A reconstructed plan should receive checks at every newly created or moved boundary. Calibrate acceptance on representative books and known bad cases; do not turn 58/106 into an automatic pass by lowering the existing threshold. Auto-publish only fully verified results under the user's existing preference. Ambiguous or missing sections stay in review. Any manual acceptance must be explicitly labeled as such in the report and completion receipt.

Before publication, validate finite ordered times, range/coverage and source fingerprint; remux without changing audio, verify audio payload, retain original backup, and commit atomically. Failed or cancelled recovery leaves the original unchanged. Fingerprinted receipts include the recovery/algorithm version so unchanged successful files skip correctly.

## Resource limits

Reuse the installed local speech model first. Run deeper scans on demand, one heavy recovery job at a time by default. Stream/decode bounded mono clips rather than a full-book PCM file. Cache transcripts by audio fingerprint, time range, and model version; checkpoint progress and honor cancellation. Keep the current 4 GB container target and 10 GB cache budget, benchmark actual RSS, and stop cleanly at configured disk/memory limits. Do not promise an iGPU speedup until a compatible backend has been measured.

## Implementation order and validation

Deliver diagnostics/deduplication first and inspect this book's report plus local and published chapter data. Next implement nearby audio/EPUB recovery with a reviewable draft; add full-book scans only after those methods are tested.

Fixtures should cover rounded timestamps, small drift, inserted or missing credits, an internal edit, split/merged tracks, chapterless audio, repeated/ambiguous headings, incorrect EPUB/ASIN, different narration, cancellation, and restart. Success means exact expected chapter identities/times within defined tolerance, unchanged audio, and no false automatic acceptance of deliberately mismatched sources. Validate the review flow at phone and laptop widths.

## References

- EPUB 3.3: https://www.w3.org/TR/epub-33/ (navigation and optional synchronized media overlays).
- WhisperX: https://github.com/m-bain/whisperX (word-level timestamp alignment; optional candidate backend).
