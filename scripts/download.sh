#!/usr/bin/env bash
# Helper: download MP3 you have rights to, then upload in the app.
# Usage: ./scripts/download.sh "https://www.youtube.com/watch?v=8y7Kednwa-M"
set -eu
URL="${1:-https://www.youtube.com/watch?v=8y7Kednwa-M}"
OUT="${2:-./downloads/%(title)s.%(ext)s}"
echo "Downloading (respect copyright + YouTube ToS — only content you own/have rights to): $URL"
yt-dlp -x --audio-format mp3 --audio-quality 0 -o "$OUT" "$URL"
echo "Done. Upload the MP3 in Piano Player library."
