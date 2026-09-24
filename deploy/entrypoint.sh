#!/bin/sh
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"
case "$PUID" in
    ''|*[!0-9]*) echo "PUID must be a nonempty number" >&2; exit 64 ;;
esac
case "$PGID" in
    ''|*[!0-9]*) echo "PGID must be a nonempty number" >&2; exit 64 ;;
esac
if [ "$PUID" -eq 0 ]; then
    echo "PUID=0 is not supported; ChapterKeeparr runs as a non-root user" >&2
    exit 64
fi

# Give only the writable application data directories to the container user.
# Library and download mounts are intentionally left with their host ownership.
if getent group chapterkeeper >/dev/null 2>&1; then
    groupmod --gid "$PGID" --non-unique chapterkeeper
else
    groupadd --gid "$PGID" --non-unique chapterkeeper
fi
if id chapterkeeper >/dev/null 2>&1; then
    usermod --uid "$PUID" --gid "$PGID" --non-unique chapterkeeper
else
    useradd --uid "$PUID" --gid "$PGID" --non-unique --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin chapterkeeper
fi
install -d -o "$PUID" -g "$PGID" /config /work /models

exec gosu "$PUID:$PGID" "$@"
