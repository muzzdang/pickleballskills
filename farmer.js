#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ────────────────────────────────────────────────────────────────────

const YTDLP = 'C:/Users/Admin/AppData/Local/Microsoft/WinGet/Packages/yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe/yt-dlp.exe';
const WIKI_DIR = path.join(os.homedir(), 'pickleball-wiki');
const RAW_DIR = path.join(WIKI_DIR, 'raw');
const TMP = os.tmpdir();
const TODAY = new Date().toISOString().slice(0, 10);

// Cutoff: default 24h. Override with --days=N or --cutoff=YYYYMMDD (e.g. catch-up run)
function getCutoff() {
  const days = process.argv.find(a => a.startsWith('--days='));
  const cutoff = process.argv.find(a => a.startsWith('--cutoff='));
  if (cutoff) return cutoff.split('=')[1];
  const n = days ? parseInt(days.split('=')[1], 10) : 1;
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

const CUTOFF = getCutoff();

const CHANNELS = [
  'https://www.youtube.com/@CrackedPickleball',
  'https://www.youtube.com/@universalrackets',
  'https://www.youtube.com/@ThirdShotSports',
  'https://www.youtube.com/@TheKitchenPickleball',
  'https://www.youtube.com/@PickleballStudio',
  'https://www.youtube.com/@BrionesPickleball',
  'https://www.youtube.com/@pickleballplaybook',
  'https://www.youtube.com/@marihumberg',
  'https://www.youtube.com/@athena.pickleball',
  'https://www.youtube.com/@corielliottpb',
  'https://www.youtube.com/@thatpickleballguy',
  'https://www.youtube.com/@Richard_pickleball',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, cwd) {
  return execSync(cmd, {
    encoding: 'utf8',
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
  });
}

function fmtTime(secs) {
  secs = Math.floor(secs || 0);
  return [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}

function cleanVTT(raw) {
  const result = [];
  const seen = [];
  for (let line of raw.split('\n')) {
    line = line.trim();
    if (!line || /^WEBVTT/.test(line) || /^NOTE/.test(line)) continue;
    if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    line = line.replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, '').replace(/<[^>]+>/g, '').trim();
    if (!line) continue;
    if (result.length && result[result.length - 1] === line) continue;
    if (seen.includes(line)) continue;
    seen.push(line);
    if (seen.length > 30) seen.shift();
    result.push(line);
  }
  return result.join(' ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

let channelsChecked = 0, videosProcessed = 0, newFiles = 0, skipped = 0, noTranscript = 0;

fs.mkdirSync(RAW_DIR, { recursive: true });
console.log(`Farmer | cutoff: ${CUTOFF} | today: ${TODAY}\n`);

for (const channelUrl of CHANNELS) {
  const handle = channelUrl.split('@')[1];
  console.log(`=== ${handle} ===`);
  channelsChecked++;

  let ids = [];
  try {
    ids = run(`"${YTDLP}" --flat-playlist --playlist-end 10 --print "%(id)s" --no-warnings "${channelUrl}/videos"`)
      .trim().split('\n').filter(Boolean);
  } catch {
    console.log('  no videos found (private or unavailable)');
    continue;
  }

  for (const videoId of ids) {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Full JSON metadata — title, date, duration, chapters, description
    let meta;
    try {
      meta = JSON.parse(run(`"${YTDLP}" --print-json --skip-download --no-warnings "${videoUrl}"`));
    } catch {
      console.log(`  metadata failed: ${videoId}`);
      continue;
    }

    const rawDate = meta.upload_date || '';
    if (!/^\d{8}$/.test(rawDate)) {
      console.log(`  bad date skipped: ${videoId}`);
      continue;
    }

    const dateFmt = `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`;
    if (rawDate < CUTOFF) {
      console.log(`  old (${dateFmt}): ${meta.title}`);
      continue;
    }

    console.log(`  new (${dateFmt}): ${meta.title}`);

    const outFile = path.join(RAW_DIR, `${dateFmt}-${videoId}-transcript.md`);
    if (fs.existsSync(outFile)) {
      console.log('  already exists, skipping');
      skipped++;
      continue;
    }

    videosProcessed++;

    // Download subtitles
    const tmpBase = path.join(TMP, `yt-${videoId}`);
    try {
      run(`"${YTDLP}" --write-auto-sub --sub-lang en --skip-download --convert-subs vtt --no-warnings -o "${tmpBase}.%(ext)s" "${videoUrl}"`);
    } catch { /* subtitles are optional */ }

    // Find downloaded VTT (try en, en-US, then any match)
    let vttFile = null;
    for (const c of [`${tmpBase}.en.vtt`, `${tmpBase}.en-US.vtt`]) {
      if (fs.existsSync(c)) { vttFile = c; break; }
    }
    if (!vttFile) {
      const hit = fs.readdirSync(TMP).find(f => f.startsWith(`yt-${videoId}`) && f.endsWith('.vtt'));
      if (hit) vttFile = path.join(TMP, hit);
    }

    let transcript = '';
    if (vttFile) {
      try { transcript = cleanVTT(fs.readFileSync(vttFile, 'utf8')); } catch {}
      try {
        fs.readdirSync(TMP)
          .filter(f => f.startsWith(`yt-${videoId}`) && f.endsWith('.vtt'))
          .forEach(f => fs.unlinkSync(path.join(TMP, f)));
      } catch {}
    }
    if (!transcript) noTranscript++;

    const channel = (meta.channel && meta.channel !== 'null') ? meta.channel : handle;
    const title = (meta.title || 'Untitled').replace(/\n/g, ' ');
    const duration = fmtTime(meta.duration);
    const description = (meta.description || '').substring(0, 500);
    const chapters = (meta.chapters || [])
      .map(c => `- ${fmtTime(c.start_time)} ${c.title}`)
      .join('\n') || '_No chapter markers available._';
    const transcriptSection = transcript
      ? `## Transcript\n\n${transcript}`
      : '_No transcript available — metadata only._';

    const markdown = [
      '---',
      `source: youtube`,
      `channel: ${channel}`,
      `video_id: ${videoId}`,
      `title: ${title}`,
      `url: ${videoUrl}`,
      `upload_date: ${dateFmt}`,
      `duration: ${duration}`,
      `fetched_date: ${TODAY}`,
      '---', '',
      `# ${title}`, '',
      `**Channel:** ${channel}`,
      `**URL:** ${videoUrl}`,
      `**Duration:** ${duration}`,
      `**Uploaded:** ${dateFmt}`, '',
      '## Description', '', description, '',
      '## Chapters', '', chapters, '',
      transcriptSection,
    ].join('\n');

    fs.writeFileSync(outFile, markdown, 'utf8');
    console.log(`  wrote: ${path.basename(outFile)}`);
    newFiles++;
  }
}

console.log('\n==========================================');
console.log('YouTube farmer complete.');
console.log(`Channels checked:         ${channelsChecked}`);
console.log(`Videos processed:         ${videosProcessed}`);
console.log(`New files in raw/:        ${newFiles}`);
console.log(`Skipped (already exists): ${skipped}`);
console.log(`No transcript available:  ${noTranscript}`);
console.log('==========================================');

// Commit and push new raw files so the 7am remote routine picks them up
if (newFiles > 0) {
  console.log('\nPushing raw files to GitHub...');
  try {
    run('git add raw/', WIKI_DIR);
    run(`git commit -m "farmer: ${TODAY} — ${newFiles} new video(s)"`, WIKI_DIR);
    run('git push', WIKI_DIR);
    console.log('Pushed.');
  } catch (e) {
    console.error('Git push failed:', e.message.split('\n')[0]);
  }
}
