export type Quality = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";
export type AudioFormat = "mp3" | "m4a" | "opus" | "wav";
export type Bitrate = 320 | 256 | 192 | 128;

export interface PresetOptions {
  kind: "video" | "audio";
  quality: Quality;
  container: "mp4" | "webm";
  mp4Compat: "strict" | "fast";
  audioFormat: AudioFormat;
  audioBitrate: Bitrate;
  embedCover: boolean;
  subtitles: string | null;
  autoSubs: boolean;
  filenameTemplate: string;
}

export interface DownloadOptions extends PresetOptions {
  trimStart: string | null;
  trimEnd: string | null;
  tags: { title?: string | null; artist?: string | null; album?: string | null } | null;
}

export interface Preset {
  id: string;
  name: string;
  options: PresetOptions;
}

export interface Settings {
  appearance: {
    theme: "light" | "dark" | "system";
    accent: string;
    density: "comfortable" | "compact";
    fontSize: number;
    reducedMotion: "system" | "on" | "off";
  };
  defaults: {
    presetId: string;
    audioFormat: AudioFormat;
    audioBitrate: Bitrate;
    filenameTemplate: string;
    concurrentDownloads: number;
    mp4Compat: "strict" | "fast";
    embedCover: boolean;
    subtitleLang: string | null;
  };
  storage: {
    quotaGB: number;
    autoCleanup: boolean;
    maxAgeDays: number | null;
    deleteOverQuota: boolean;
  };
  presets: Preset[];
}

export interface User {
  email: string;
  name: string | null;
  picture: string | null;
}

export interface FormatRow {
  id: string;
  ext: string;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  abr: number | null;
  size: number | null;
  note: string | null;
}

export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  channel: string | null;
  thumbnail: string | null;
}

interface PreviewBase {
  id: string;
  title: string;
  channel: string | null;
  url: string;
  thumbnail: string | null;
  site: string | null;
  requestedUrl: string;
}

export interface VideoPreview extends PreviewBase {
  type: "video";
  duration: number | null;
  uploadDate: string | null;
  isLive: boolean;
  ageLimit: number;
  hasVideo: boolean;
  heights: number[];
  audioBitrates: number[];
  formats: FormatRow[];
  subtitles: string[];
  autoSubtitles: string[];
  artist: string | null;
  album: string | null;
}

export interface PlaylistPreview extends PreviewBase {
  type: "playlist";
  count: number;
  entries: PlaylistEntry[];
  truncated: boolean;
}

export type Preview = VideoPreview | PlaylistPreview;

export type JobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "canceled";

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  title: string | null;
  channel: string | null;
  thumbnail: string | null;
  duration: number | null;
  options: DownloadOptions;
  fileId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  attempts: number;
  error: { code: string; message: string; detail?: string } | null;
  phase: string;
  progress: number | null;
  speed: number | null;
  eta: number | null;
  downloaded: number;
  total: number | null;
  stream: number;
  streams: number;
}

export interface LibraryFile {
  id: string;
  name: string;
  filename: string;
  kind: "video" | "audio";
  ext: string;
  size: number;
  quality: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  vcodec: string | null;
  acodec: string | null;
  title: string | null;
  channel: string | null;
  sourceUrl: string | null;
  createdAt: number;
  thumbUrl: string | null;
  jobId: string | null;
}

export interface LibraryStats {
  usedBytes: number;
  quotaBytes: number;
  byKind: Record<"video" | "audio", { count: number; bytes: number }>;
  count: number;
  largest: LibraryFile[];
  disk: { total: number; free: number } | null;
}
