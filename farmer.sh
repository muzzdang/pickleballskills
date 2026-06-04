#!/usr/bin/env bash
# Pickleball YouTube Farmer - 24-hour window mode
# Uses yt-dlp --print-json + node.js for reliable metadata parsing

YTDLP="/c/Users/Admin/AppData/Local/Microsoft/WinGet/Packages/yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe/yt-dlp.exe"
NODE="/c/Program Files/nodejs/node.exe"
RAW_DIR="/c/Users/Admin/pickleball-wiki/raw"
TODAY="2026-05-23"
CUTOFF_RAW="20260514"  # catch-up run: last ~9 days

mkdir -p "$RAW_DIR"

CHANNELS=(
  "https://www.youtube.com/@CrackedPickleball"
  "https://www.youtube.com/@universalrackets"
  "https://www.youtube.com/@ThirdShotSports"
  "https://www.youtube.com/@TheKitchenPickleball"
  "https://www.youtube.com/@PickleballStudio"
  "https://www.youtube.com/@BrionesPickleball"
  "https://www.youtube.com/@pickleballplaybook"
  "https://www.youtube.com/@marihumberg"
  "https://www.youtube.com/@athena.pickleball"
  "https://www.youtube.com/@corielliottpb"
  "https://www.youtube.com/@thatpickleballguy"
  "https://www.youtube.com/@Richard_pickleball"
)

CHANNELS_CHECKED=0
VIDEOS_PROCESSED=0
NEW_FILES=0
SKIPPED=0
NO_TRANSCRIPT=0

# Node.js script for JSON parsing
NODE_PARSER=$(cat << 'NODESCRIPT'
const fs = require('fs');
const data = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(data);
const desc = (d.description || '').substring(0, 500);
const chaptersMd = (d.chapters || []).map(ch => {
  const t = Math.floor(ch.start_time || 0);
  const h = Math.floor(t/3600).toString().padStart(2,'0');
  const m = Math.floor((t%3600)/60).toString().padStart(2,'0');
  const s = (t%60).toString().padStart(2,'0');
  return `- ${h}:${m}:${s} ${ch.title}`;
}).join('\n');
const secs = Math.floor(d.duration || 0);
const dh = Math.floor(secs/3600).toString().padStart(2,'0');
const dm = Math.floor((secs%3600)/60).toString().padStart(2,'0');
const ds = (secs%60).toString().padStart(2,'0');
const dur = `${dh}:${dm}:${ds}`;
process.stdout.write([
  d.upload_date || 'NA',
  d.title || 'NA',
  dur,
  d.channel || 'NA',
  chaptersMd,
  desc
].join('\x00'));
NODESCRIPT
)

# Clean VTT content to plain text using node.js
clean_vtt_node() {
  local vtt_file="$1"
  "$NODE" -e "
const fs = require('fs');
let content = fs.readFileSync('$vtt_file', 'utf8');
// Remove WEBVTT header
content = content.replace(/^WEBVTT.*\\n/gm, '');
// Remove NOTE blocks
content = content.replace(/NOTE\\s[^\\n]*\\n/gm, '');
// Split lines
const lines = content.split('\\n');
const result = [];
const seenWindow = [];
for (let line of lines) {
  line = line.trim();
  // Skip timing lines
  if (/^\\d{2}:\\d{2}:\\d{2}[\\.,]\\d{3}\\s+-->/.test(line)) continue;
  // Skip sequence numbers
  if (/^\\d+$/.test(line)) continue;
  if (!line) continue;
  // Remove inline timing tags
  line = line.replace(/<\\d{2}:\\d{2}:\\d{2}[\\.,]\\d{3}>/g, '');
  // Remove VTT tags
  line = line.replace(/<[^>]+>/g, '').trim();
  if (!line) continue;
  // Dedup consecutive
  if (result.length && result[result.length-1] === line) continue;
  // Dedup sliding window (karaoke mode)
  if (seenWindow.includes(line)) continue;
  seenWindow.push(line);
  if (seenWindow.length > 30) seenWindow.shift();
  result.push(line);
}
process.stdout.write(result.join(' '));
" 2>/dev/null
}

for CHANNEL_URL in "${CHANNELS[@]}"; do
  CHANNEL_HANDLE=$(echo "$CHANNEL_URL" | sed 's|https://www.youtube.com/@||')
  echo ""
  echo "=== Channel: $CHANNEL_HANDLE ==="
  CHANNELS_CHECKED=$((CHANNELS_CHECKED + 1))

  # Get 5 most recent video IDs
  VIDEO_IDS=$("$YTDLP" \
    --flat-playlist \
    --playlist-end 10 \
    --print "%(id)s" \
    --no-warnings \
    "${CHANNEL_URL}/videos" 2>/dev/null)

  if [ -z "$VIDEO_IDS" ]; then
    echo "  No videos found (may be private or unavailable)"
    continue
  fi

  while read -r video_id; do
    [ -z "$video_id" ] && continue

    video_url="https://www.youtube.com/watch?v=${video_id}"

    # Fetch full JSON metadata
    META_JSON=$("$YTDLP" \
      --print-json \
      --skip-download \
      --no-warnings \
      "$video_url" 2>/dev/null)

    if [ -z "$META_JSON" ]; then
      echo "  Could not fetch metadata for $video_id"
      continue
    fi

    # Parse via node.js — fields separated by NUL bytes
    PARSED=$(echo "$META_JSON" | "$NODE" -e "$NODE_PARSER" 2>/dev/null)

    # Extract NUL-delimited fields
    upload_date_raw=$(echo "$PARSED" | cut -d$'\x00' -f1)
    title=$(echo "$PARSED" | cut -d$'\x00' -f2)
    duration_fmt=$(echo "$PARSED" | cut -d$'\x00' -f3)
    channel_name=$(echo "$PARSED" | cut -d$'\x00' -f4)
    chapters_md=$(echo "$PARSED" | cut -d$'\x00' -f5)
    description=$(echo "$PARSED" | cut -d$'\x00' -f6)

    # Normalize upload_date
    if [ ${#upload_date_raw} -eq 8 ] && [[ "$upload_date_raw" =~ ^[0-9]+$ ]]; then
      upload_date_fmt="${upload_date_raw:0:4}-${upload_date_raw:4:2}-${upload_date_raw:6:2}"
    else
      echo "  Skipping $video_id (bad upload_date: ${upload_date_raw:0:20})"
      continue
    fi

    # Filter: 24-hour window
    if [[ "$upload_date_raw" -lt "$CUTOFF_RAW" ]]; then
      echo "  Too old ($upload_date_fmt): $title"
      continue
    fi

    echo "  Found recent ($upload_date_fmt): $title"

    # Use channel from metadata, fallback to handle
    if [ -z "$channel_name" ] || [ "$channel_name" = "NA" ] || [ "$channel_name" = "null" ]; then
      channel_name="$CHANNEL_HANDLE"
    fi

    # Dedup check
    OUT_FILE="$RAW_DIR/${upload_date_fmt}-${video_id}-transcript.md"
    if [ -f "$OUT_FILE" ]; then
      echo "  Skipping (already exists)"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    VIDEOS_PROCESSED=$((VIDEOS_PROCESSED + 1))

    # Download subtitles
    "$YTDLP" \
      --write-auto-sub \
      --sub-lang en \
      --skip-download \
      --convert-subs vtt \
      --no-warnings \
      -o "/tmp/yt-%(id)s.%(ext)s" \
      "$video_url" 2>/dev/null

    # Find VTT file
    VTT_FILE=""
    for f in "/tmp/yt-${video_id}.en.vtt" "/tmp/yt-${video_id}.en-US.vtt"; do
      if [ -f "$f" ]; then
        VTT_FILE="$f"
        break
      fi
    done
    # Glob fallback
    if [ -z "$VTT_FILE" ]; then
      for f in /tmp/yt-${video_id}*.vtt; do
        if [ -f "$f" ]; then
          VTT_FILE="$f"
          break
        fi
      done
    fi

    TRANSCRIPT_TEXT=""
    if [ -n "$VTT_FILE" ] && [ -f "$VTT_FILE" ]; then
      TRANSCRIPT_TEXT=$(clean_vtt_node "$VTT_FILE")
      rm -f /tmp/yt-${video_id}*.vtt 2>/dev/null
    fi

    if [ -z "$TRANSCRIPT_TEXT" ]; then
      NO_TRANSCRIPT=$((NO_TRANSCRIPT + 1))
    fi

    # Build sections
    if [ -n "$chapters_md" ]; then
      CHAPTERS_SECTION="## Chapters

${chapters_md}"
    else
      CHAPTERS_SECTION="## Chapters

_No chapter markers available._"
    fi

    if [ -n "$TRANSCRIPT_TEXT" ]; then
      TRANSCRIPT_SECTION="## Transcript

${TRANSCRIPT_TEXT}"
    else
      TRANSCRIPT_SECTION="_No transcript available — metadata only._"
    fi

    # Write markdown file
    {
      echo "---"
      echo "source: youtube"
      echo "channel: ${channel_name}"
      echo "video_id: ${video_id}"
      echo "title: ${title}"
      echo "url: ${video_url}"
      echo "upload_date: ${upload_date_fmt}"
      echo "duration: ${duration_fmt}"
      echo "fetched_date: ${TODAY}"
      echo "---"
      echo ""
      echo "# ${title}"
      echo ""
      echo "**Channel:** ${channel_name}"
      echo "**URL:** ${video_url}"
      echo "**Duration:** ${duration_fmt}"
      echo "**Uploaded:** ${upload_date_fmt}"
      echo ""
      echo "## Description"
      echo ""
      echo "${description}"
      echo ""
      echo "${CHAPTERS_SECTION}"
      echo ""
      echo "${TRANSCRIPT_SECTION}"
    } > "$OUT_FILE"

    echo "  Wrote: $(basename "$OUT_FILE")"
    NEW_FILES=$((NEW_FILES + 1))

  done <<< "$VIDEO_IDS"

done

echo ""
echo "=========================================="
echo "YouTube farmer complete."
echo "Channels checked:         $CHANNELS_CHECKED"
echo "Videos processed:         $VIDEOS_PROCESSED"
echo "New files in raw/:        $NEW_FILES"
echo "Skipped (already exists): $SKIPPED"
echo "No transcript available:  $NO_TRANSCRIPT"
echo "=========================================="
