# ChapterKeeparr: public-image installation and migration

Use the **test template first**, on your existing port **8787**, with a fresh
config folder and your dedicated test files. Stop the existing container before
starting this one, since both use the same host port. Keep the old container and
image for rollback. Neither installation builds source on Unraid.

## 1. Publish the first image (repository owner, once)

**Preparation status:** these files do not establish that a public image exists.
No image publication or Unraid deployment was performed while preparing this kit.
Complete this section before trying to pull an image. A Git tag or an open PR
alone does not mean a corresponding container image is available.

1. Review PR #3 and its checks. In GitHub, open **Actions → CI and release → Run
   workflow**, select `feat/responsive-review-workspace`, and run it. This is an
   owner action; the repository rules reserve release actions for Jeremy. The
   workflow tests first, then builds a Linux/amd64 image including the speech
   model. An initial build can take several minutes.
2. Wait for **both `test` and `image` jobs to succeed**. Copy the exact image tag
   and manifest digest from the image job output. The expected preview tag for
   this branch is `ghcr.io/jstraw4663/chapterkeeparr:feat-responsive-review-workspace`;
   use the actual output if it differs. A branch build does not move `:latest`.
3. Open your GitHub profile's **Packages → chapterkeeparr → Package settings**
   and change the container package visibility to **Public**, if needed. The
   source repository can remain private. Public pulls do not need a GitHub token
   or Docker login on Unraid. Do not copy registry credential files to the flash
   drive for this installation.
4. Verify anonymous access from a shell with an empty, temporary Docker config:

   ```sh
   CK_PULL_CONFIG="$(mktemp -d)"
   docker --config "$CK_PULL_CONFIG" pull ghcr.io/jstraw4663/chapterkeeparr:feat-responsive-review-workspace
   rmdir "$CK_PULL_CONFIG"
   ```

   This downloads the image without using a saved registry login. If it fails,
   check the successful workflow's exact tag and the package visibility. Do not
   replace the existing container to troubleshoot a pull failure. Docker might
   leave files in that temporary folder; if `rmdir` reports it is nonempty, remove
   only that disposable folder after inspecting it.

For a repeatable test, prefer
`ghcr.io/jstraw4663/chapterkeeparr@sha256:THE_MANIFEST_DIGEST_FROM_THE_BUILD`
over a moving branch tag. This is a format example, not a published digest.
Re-running the workflow changes the branch tag; it does not change an existing
digest. A stable `:latest` appears only after a successful stable version-tag
build. No release version in these instructions is a promise that it exists.

## 2. Install through Unraid's Add Container screen

The kit contains two Docker Manager templates. They do not require a Community
Applications listing. Because the source repository is private, download the XML
files from the supplied kit or authenticated GitHub; anonymous raw GitHub links
are not a reliable installation method.

| Setting | Test template | Production template |
| --- | --- | --- |
| XML file | `unraid-test-template.xml` | `unraid-template.xml` |
| Container name | `ChapterKeeparr-Test` | `ChapterKeeparr` |
| Host → container port | `8787 → 8000` | `8787 → 8000` |
| Host config directory | `/mnt/user/appdata/chapterkeeparr-test/config` | `/mnt/user/appdata/chapterkeeparr/config`* |
| Host library directory | `/mnt/user/media/chapterkeeparr-test` | `/mnt/user/media/audiobooks`* |
| Background workers on first start | Paused (`ENABLE_WORKERS=0`) | Paused (`ENABLE_WORKERS=0`) |

\* Production paths are examples. Preserve the **actual existing mappings** when
migrating; do not assume the examples match the manually deployed container.

1. Copy the test XML to the Unraid flash drive as
   `/boot/config/plugins/dockerMan/templates-user/my-ChapterKeeparr-Test.xml`.
   Create `templates-user` if it is absent. Use your usual file transfer method
   or the Unraid terminal. Later, copy the production XML as
   `my-ChapterKeeparr.xml`. These are template files, not Docker images.
2. In **Docker → Add Container → Template**, select **ChapterKeeparr-Test**.
3. Replace **Repository** with the published preview tag or digest from section
   1. The test XML suggests the expected branch tag; verify that it was actually
   published. The production XML's `:latest` placeholder will not contain this
   preview unless a stable release is subsequently published.
4. Create the test directories, or change the host library path to your existing
   dedicated test set. Use copies if you want to preserve those test originals.
   Use a fresh config directory initially. Never give two running containers the
   same config folder, and never give the test instance your live writable
   audiobook library. Worker-disabled mode is not a filesystem sandbox: manual
   actions can still write.
5. Set PUID/PGID to an account that can write the mapped folders (Unraid defaults
   are `99:100`). Check permissions on the test directories. The entrypoint
   creates its application directories; it does not recursively fix existing
   library/config ownership. Avoid recursive ownership changes to the live share.
6. Set an API token for LAN use and keep access on your trusted LAN/VPN. The XML
   publishes the port on the host. Leave **Privileged off**, bridge networking,
   and `ENABLE_WORKERS=0`. Stop the old container and disable its autostart
   before clicking **Apply**: only one instance can bind host port 8787.
7. Open `http://192.168.4.51:8787`. Enter the token in Settings if configured.
   Confirm **Settings → build information** shows the expected commit and matching
   frontend identity. The preview is a development build, so it need not show a
   stable release version. The placeholder app logo remains the document/book icon;
   Unraid may show its generic container icon until a public icon asset is added.

If the template does not appear, confirm the XML is in `templates-user`, has an
`.xml` extension, and refresh Add Container. You can also enter the same table's
fields manually. The container's internal port remains **8000**, regardless of
the host port.

## 3. Test the build before migration

First check `/api/health` returns `{"status":"ok"}`, then check Settings, Library,
Suggestions, Queue, New job and Needs review. An empty fresh test queue is
expected. To create review cases, enable the test worker and submit copied books.

In the test container's settings, set `ENABLE_WORKERS=1` and Apply. Keep
`WORKERS=1` and `CPU_THREADS=4` for the first run. Submit one copied MP3 folder and
one copied M4B, including a book that normally needs review. Check these outcomes:

| Check | Expected behavior |
| --- | --- |
| Review at 1024×768, 1280×800 and 1440×900; resize without reloading | Readable title/details; compact cover rail; no horizontal page scrolling or squeezed vertical title |
| Phone widths 320, 390 and 430 CSS pixels; tablet 768 and 820 | Reachable controls, no overlapping footer/navigation, readable decisions in both themes |
| Select a book; expand/collapse rail; keyboard Tab and Escape | Selected book remains clear; titles can be revealed; visible focus returns sensibly |
| Consent checkbox off → on → off on mobile | Save action hides → appears white → hides; other approval requirements still block saving |
| Change draft/book; retry a failed request | Prior consent does not approve a different draft; valid edits survive a failed request |
| Queue, cancel, restart the test container | No duplicate processing; persisted job state remains usable; canceled work stops |
| Explicitly accept a draft on a copied file | Only after every required approval; inspect the resulting chapters and source/output backups |
| Refresh or update the PWA after finishing a review | Settings frontend/server identity agrees; update reload does not interrupt unsaved review work |

Acceptance changes only copied test media. Metadata/speech results still depend
on providers and the recording; matching chapter names does not prove audio
completeness. Existing publication checks remain in force.

Run a representative longer copied book while using the rest of Unraid. Watch
Docker CPU/RAM and disk space, UI responsiveness, processing time, cancellation
delay, and container restarts. Record the image digest/commit and those results.
Start with one book, then queue several to check stability. This backend currently
serializes heavy processing even when multiple book workers are configured;
raising `WORKERS` is not yet a proven throughput improvement.

If you stop testing here, stop the new container before restarting the old one
on port 8787. Its separate config remains untouched.

The defaults cap CPU time at four CPUs' worth and container memory at 4 GB
(`--cpus=4 --memory=4g --memory-swap=4g`). They are limits, not reservations or a
claim that every book fits within 4 GB. An out-of-memory restart means this budget
needs investigation before rollout. `CPU_THREADS=4` controls speech threads;
the CPU quota also constrains conversion and other container work. `CACHE_MAX_GB=10`
is a retained **disk** cache budget, not RAM or a total working-space limit.

No `/dev/dri` mapping is required: the current speech/conversion pipeline does
not use the Intel iGPU. Automatic SSD-to-array conversion staging belongs to the
separate backend plan and is not implemented here. Audio temporary files still
use the source library filesystem. To test SSD behavior, put the **copied test
library** on a suitable SSD-backed share, with enough room for outputs and backups.

## 4. Migrate the manually built container

Do this only after the copied-library test passes. The deployed source commit is
unknown; keep its image, configuration and any manually copied source checkout.

1. Record the current container's name, image ID, port mappings, all host/container
   paths, PUID/PGID and relevant environment settings. Docker Manager's Edit view
   or its existing saved template is useful. Keep tokens private. Read-only
   commands to identify the old image and mounts, replacing the name as needed:

   ```sh
   CK_OLD_CONTAINER=ChapterKeeparr
   docker inspect --format '{{.Image}}' "$CK_OLD_CONTAINER"
   docker inspect --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' "$CK_OLD_CONTAINER"
   ```

2. Preserve the old image before replacing its container. Tag the image ID printed
   above with a local rollback name:

   ```sh
   docker image tag THE_OLD_IMAGE_ID chapterkeeparr-local:pre-migration
   ```

   Do not prune this image or delete the old source/appdata during testing.
3. Wait until processing is idle, disable the old container's autostart, then
   **stop it**. Back up the **complete host directory mounted at `/config`** to a
   separate location while stopped, including SQLite databases, any WAL/SHM
   files, reports and retained data. Also preserve other persistent mounts and
   the old template/settings. Copying only `jobs.sqlite` from a running container
   is not a reliable backup. Keep this pre-upgrade snapshot unchanged.
4. Install/edit the production container using `unraid-template.xml`, the tested
   image reference, and the old installation's exact mappings. If the old name
   conflicts, rename the stopped old container or give the new one a distinct
   name. Only the new container may use port **8787** or that config folder. Stop the
   test container too if it is still using 8787.
   Start with `ENABLE_WORKERS=0`.
5. Keep the same **container-side** library paths and `LIBRARY_ROOTS` as before:
   saved jobs contain absolute paths. If the old installation used a different
   target than `/library`, change the new mount target and roots to match. Keep
   the same token and ownership settings if already configured. Do not run an
   old and new instance against a shared config, even with workers paused.
6. Start the new container. Check logs, health, Settings version/commit, library,
   saved history and pending reviews. Startup can migrate the database even with
   workers paused; the stopped-state backup is therefore required. Finish any
   browser/PWA update before resuming a review. The screenshot's deployed sticky
   editor could represent source not in GitHub: compare it before discarding the
   old installation.
7. Once those checks pass, set `ENABLE_WORKERS=1`, Apply, and process a small
   intended job. Keep the old container stopped. Enable autostart on the new
   container once satisfied. Your normal URL remains `http://192.168.4.51:8787`.

**Rollback:** stop the new container first. Preserve a separate copy of its config
if you need to investigate or retain new history. Restore the complete
pre-upgrade config snapshot and the old image, mappings and settings, then start
only the old instance. Image rollback alone may not work with a migrated
database. Restoring config does not undo library writes made after cutover; use
the app's source/output backups for those files as appropriate.

## 5. Docker Compose alternative (no source build)

Use this instead of Docker Manager, not alongside it for the same instance.
Copy `compose.registry.yaml` and `.env.registry.example` to a working directory
on the Docker host, then:

```sh
cp .env.registry.example .env.registry
```

Edit `.env.registry`: set `CHAPTERKEEPARR_IMAGE` to the published tag/digest and
verify separate test paths. For access from your MacBook, change
`CHAPTERKEEPER_BIND` to the Unraid LAN IP (`192.168.4.51`) and set a token.
The default `127.0.0.1` binding is reachable only on the Docker host. Create the
host folders with permissions for PUID/PGID first. With Docker Compose v2:

```sh
docker compose --project-name chapterkeeparr-test --env-file .env.registry -f compose.registry.yaml config --quiet
docker compose --project-name chapterkeeparr-test --env-file .env.registry -f compose.registry.yaml pull
docker compose --project-name chapterkeeparr-test --env-file .env.registry -f compose.registry.yaml up -d
docker compose --project-name chapterkeeparr-test --env-file .env.registry -f compose.registry.yaml logs --tail=100
```

Review logs locally; redact private paths/tokens before sharing. Change
`ENABLE_WORKERS=1` in the env file and repeat `up -d` to enable the test worker.
The required image variable intentionally fails configuration when empty.

For production, use a separate working directory/env file and
`--project-name chapterkeeparr`, set `CONTAINER_NAME=chapterkeeparr`, port `8787`,
and the verified production host paths. Follow the stopped-container backup and
migration steps above. Never use `down --volumes` as a migration step.

## Updates and troubleshooting

- **Immutable digest/version:** edit Repository (or `CHAPTERKEEPARR_IMAGE`) to
  the tested next reference. A pinned digest does not follow newer builds.
- **Stable `:latest`:** after stable releases are published, Unraid Update/Force
  update pulls the newer image. Review release notes, wait for idle, and make a
  stopped-state config backup before each upgrade. Compose users run `pull` then
  `up -d` with the same project/env/file arguments. Keep a rollback reference.
- **`denied`/`manifest unknown`:** publishing has not finished, the tag is wrong,
  or the GHCR package is not public. Check section 1 before changing host setup.
- **UI loads but jobs stay queued:** first-start worker pause is intentional.
  Verify mappings, then enable `ENABLE_WORKERS=1`.
- **Wrong version/UI:** compare Settings server and frontend identities, the image
  job's source commit and the selected image digest. Reload a waiting PWA update
  when review work is finished. A Docker image ID differs from a registry
  manifest digest; keep both with their labels for troubleshooting.
- **Settings cannot check releases:** its current checker uses GitHub Releases.
  A private source repository or absence of GitHub Release entries can make that
  result unavailable even when the public image pulls successfully. It does not
  establish whether the installed container is current; use Actions/Settings
  commit information and the registry reference.
- **Permission errors:** check mapped directory ownership against PUID/PGID;
  do not enable privileged mode to fix them.

Keep a deployment record: date, image tag and digest, Settings commit/version,
config-backup location, old image ID, and the copied-library test results.
