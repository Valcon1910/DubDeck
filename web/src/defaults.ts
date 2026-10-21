import type { PresetOptions, Settings } from "./types";

export const baseOptions: PresetOptions = {
  kind: "video",
  quality: "best",
  container: "mp4",
  mp4Compat: "strict",
  audioFormat: "mp3",
  audioBitrate: 320,
  embedCover: true,
  subtitles: null,
  autoSubs: false,
  filenameTemplate: "{title}",
};

// Mirrors server/app/models.py so the UI works before the first sync.
export const defaultSettings: Settings = {
  appearance: { theme: "system", accent: "#e4572e", density: "comfortable", fontSize: 15, reducedMotion: "system" },
  defaults: {
    presetId: "video-best-mp4",
    audioFormat: "mp3",
    audioBitrate: 320,
    filenameTemplate: "{title}",
    concurrentDownloads: 2,
    mp4Compat: "strict",
    embedCover: true,
    subtitleLang: null,
  },
  storage: { quotaGB: 50, autoCleanup: false, maxAgeDays: null, deleteOverQuota: false },
  presets: [
    { id: "video-best-mp4", name: "Best video · MP4", options: { ...baseOptions } },
    { id: "video-1080-mp4", name: "1080p · MP4", options: { ...baseOptions, quality: "1080" } },
    { id: "video-720-mp4", name: "720p · MP4 (small)", options: { ...baseOptions, quality: "720" } },
    { id: "video-best-webm", name: "Best video · WebM", options: { ...baseOptions, container: "webm" } },
    { id: "audio-mp3-320", name: "Audio · MP3 320", options: { ...baseOptions, kind: "audio" } },
    { id: "audio-m4a", name: "Audio · M4A/AAC", options: { ...baseOptions, kind: "audio", audioFormat: "m4a" } },
    { id: "audio-opus", name: "Audio · Opus", options: { ...baseOptions, kind: "audio", audioFormat: "opus" } },
  ],
};

export const ACCENTS: { name: string; value: string }[] = [
  { name: "Tape orange", value: "#e4572e" },
  { name: "Record red", value: "#d1344b" },
  { name: "VU amber", value: "#e09f1f" },
  { name: "Signal green", value: "#2f9e6e" },
  { name: "Reel teal", value: "#1d8a99" },
  { name: "Cobalt", value: "#3a6fd8" },
  { name: "Violet", value: "#7c5cff" },
  { name: "Graphite", value: "#5b6170" },
];

export const QUALITIES: { value: PresetOptions["quality"]; label: string }[] = [
  { value: "best", label: "Best available" },
  { value: "2160", label: "2160p (4K)" },
  { value: "1440", label: "1440p" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
  { value: "360", label: "360p" },
];

export const TEMPLATE_TOKENS = ["title", "channel", "artist", "album", "date", "quality", "format", "id", "site"];

export function describeOptions(o: PresetOptions): string {
  if (o.kind === "audio") {
    return o.audioFormat === "mp3" ? `MP3 ${o.audioBitrate} kbps` : { m4a: "M4A/AAC", opus: "Opus", wav: "WAV" }[o.audioFormat] ?? o.audioFormat;
  }
  const q = o.quality === "best" ? "Best" : `${o.quality}p`;
  return `${q} · ${o.container.toUpperCase()}`;
}
