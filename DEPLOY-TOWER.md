> Historical instructions preserved from the uploaded container source. For this merged build, use [the versioned Unraid installation guide](deploy/UNRAID-INSTALL.md); old build labels/cache numbers below describe that earlier snapshot.

# Tower deployment — manual published assignments

Source archive including current UI, manual section assignments, nearest unassigned suggestions, selection/removal controls, browser autosave, stable progress and embedded heading recognition.

1. Wait for active jobs to finish, then stop the container.
2. Copy chapterkeeparr/ contents into your existing source directory. Preserve config, database, .env, API token and volume mappings. Back up your existing deployment configuration first.
3. Rebuild from the updated source directory:

   docker build -t chapterkeeparr:latest .

4. Recreate the container using the rebuilt image and existing settings. In Unraid edit the existing container, set CHAPTERKEEPER_BUILD to 2026-10-02-review-decisions and Apply. For an existing Compose build setup, use docker compose up -d --build. Restart alone does not replace an old image.
5. Reload the browser/PWA to load cache v25. Keep the same app address/browser to retain browser-local drafts; do not clear site storage. Drafts only restore for the same server evidence token.

Testing the changes:
- Open an existing review draft. Choose Use published section at a marker or Assign to timestamp from an outstanding section.
- Picker shows unassigned choices grouped by recommendation/availability/order, sorted by published-time distance. These are suggestions, not speech confirmation.
- Change published section shows the current title and Remove assignment. Removal restores the original name, retaining timestamp/audio, and returns the published section to available choices.
- Edits save locally in this browser; only Accept and save queues file publication. Manual assignments do not increase the speech-supported percentage.
- Choose Draft the chapters again only if you want the new word-timed recognition pass. This changes the draft evidence and old local edits will not automatically apply to it.

Validation: 16 acceptance tests, 7 frontend tests, 4 database tests and 8 worker tests passed in their relevant runs. Desktop/mobile browser checks cover both assignment directions, removal/reassignment, sorting, persistence and intercepted save payloads. Generated-media publication verifies backups, timestamps and unchanged audio. No live Tower deployment or complex-book validation performed.

Outstanding limitation: the prior full suite passed 85/86 tests; speech dependency startup timed out at 60 seconds, including a standalone retry. This remains documented in VALIDATION.md. Docker retains its real speech-decoder smoke check. Actual Tower inference performance remains unvalidated.

No real media, private config, .claude files or .git history are included. This is source, not a prebuilt Docker image.

Latest UI changes: Select Unmatched Section is the main row action beside Other options. Selected titles are explicit; the picker supports removing assignments, nearest-first grouped choices, and custom-name/navigation-removal alternatives when nothing fits. Originally unconfirmed rows stay in that filter after assignment; unresolved-navigation buttons were removed. Removal still needs explicit confirmation and the first marker remains protected. Desktop/mobile checks passed.

Apply Recommended Matches now applies only unique, in-order choices within 5 seconds, separated from competing sections/local markers by at least 10 seconds. Explicit edits are preserved; red Unconfirmed and yellow Manually assigned states remain distinct. Bulk assignment is a browser draft operation, never file publication.

The optional tests/fixtures/complex_review.py script expands a ui_seed synthetic Frankenstein fixture only. It is NOT run on startup or deployed library data. Local preview scenarios use generated tones and illustrative text and cannot finalize because their publication fingerprints are intentionally invalid. Test actual save behavior on appropriate backed-up media through the normal app workflow.

Latest changes: compact scoped search, explicit out-of-order assignment confirmation, restored recommendation counts after unmatching, manual rename/removal decision badges, and faster theme fades.
