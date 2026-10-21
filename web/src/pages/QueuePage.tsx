import { useState } from "react";
import { api, ApiError, downloadFromUrl } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmModal } from "../components/Modal";
import { Waveform } from "../components/Waveform";
import { describeOptions } from "../defaults";
import { useLive } from "../live";
import { useRouter } from "../router";
import { useSettings } from "../settings";
import { useToast } from "../toasts";
import type { Job } from "../types";
import { clsx, formatBytes, formatDateTime, formatDuration, safeImg } from "../util";

const ACTIVE = new Set(["running", "queued", "paused"]);

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued", running: "Working", paused: "Paused", completed: "Done", failed: "Failed", canceled: "Canceled",
};

function phaseLabel(j: Job): string {
  if (j.status !== "running") return STATUS_LABEL[j.status];
  switch (j.phase) {
    case "starting": return "Starting…";
    case "downloading":
      return j.streams > 1 ? `Downloading ${j.stream === 0 ? "video" : "audio"} (${j.stream + 1}/${j.streams})` : "Downloading";
    case "processing": return j.options.kind === "audio" ? "Extracting audio" : "Merging streams";
    case "converting": return j.options.container === "webm" ? "Converting to VP9/Opus" : "Converting to H.264/AAC";
    case "tagging": return "Writing tags";
    default: return "Working";
  }
}

export function QueuePage() {
  const { jobs, upsert, remove } = useLive();
  const { settings, update } = useSettings();
  const toast = useToast();
  const { go } = useRouter();
  const [tab, setTab] = useState<"active" | "history">("active");
  const [confirmClear, setConfirmClear] = useState(false);
  const active = jobs.filter((j) => ACTIVE.has(j.status)).sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
  const history = jobs.filter((j) => !ACTIVE.has(j.status));
  const list = tab === "active" ? active : history;

  const act = async (j: Job, action: string) => {
    try {
      const res = await api<{ job: Job }>(`/api/jobs/${j.id}/${action}`, { body: {} });
      upsert(res.job);
      if (action === "redownload") toast.push("Added to the queue again", "success");
    } catch (e) {
      toast.push((e as ApiError).message, "error");
    }
  };
  const del = async (j: Job) => {
    try {
      await api(`/api/jobs/${j.id}`, { method: "DELETE" });
      remove(j.id);
    } catch (e) {
      toast.push((e as ApiError).message, "error");
    }
  };
  const save = async (j: Job) => {
    try {
      const link = await api<{ url: string }>(`/api/library/${j.fileId}/link`, { body: { disposition: "attachment" } });
      downloadFromUrl(link.url);
    } catch (e) {
      toast.push((e as ApiError).message, "error");
    }
  };

  const concurrency = settings.defaults.concurrentDownloads;
  const setConcurrency = (n: number) => update((s) => ({ ...s, defaults: { ...s.defaults, concurrentDownloads: Math.max(1, Math.min(6, n)) } }));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Queue</h1>
          <p className="muted">Progress updates live from your server.</p>
        </div>
        <div className="row head-controls">
          <div className="stepper" role="group" aria-label="Simultaneous downloads">
            <span className="label">At once</span>
            <button className="icon-btn" aria-label="Fewer simultaneous downloads" disabled={concurrency <= 1} onClick={() => setConcurrency(concurrency - 1)}>−</button>
            <span className="mono stepper-value" aria-live="polite">{concurrency}</span>
            <button className="icon-btn" aria-label="More simultaneous downloads" disabled={concurrency >= 6} onClick={() => setConcurrency(concurrency + 1)}>+</button>
          </div>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Queue view">
        <button role="tab" aria-selected={tab === "active"} className={clsx("tab", tab === "active" && "is-on")} onClick={() => setTab("active")}>
          Active <span className="count mono">{active.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "history"} className={clsx("tab", tab === "history" && "is-on")} onClick={() => setTab("history")}>
          History <span className="count mono">{history.length}</span>
        </button>
        {tab === "history" && history.length > 0 && (
          <button className="btn btn-ghost btn-sm tabs-end" onClick={() => setConfirmClear(true)}>Clear history</button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="empty card">
          <p>{tab === "active" ? "Nothing in the queue." : "No finished downloads yet."}</p>
          {tab === "active" && <button className="btn btn-primary" onClick={() => go("download")}><Icon name="download" size={18} /> Start a download</button>}
        </div>
      ) : (
        <ul className="jobs" role="tabpanel">
          {list.map((j) => <JobRow key={j.id} job={j} onAction={(a) => act(j, a)} onDelete={() => del(j)} onSave={() => save(j)} />)}
        </ul>
      )}

      {confirmClear && (
        <ConfirmModal
          title="Clear history?"
          message="Finished, failed and canceled entries are removed from the list. Downloaded files stay in your Library."
          confirmLabel="Clear history"
          onClose={() => setConfirmClear(false)}
          onConfirm={async () => {
            await api("/api/jobs/clear", { body: {} });
            history.forEach((j) => remove(j.id));
          }}
        />
      )}
    </div>
  );
}

function order(j: Job) {
  return j.status === "running" ? 0 : j.status === "queued" ? 1 : 2;
}

function JobRow({ job: j, onAction, onDelete, onSave }: { job: Job; onAction: (a: string) => void; onDelete: () => void; onSave: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  const thumb = safeImg(j.thumbnail);
  const tone = j.status === "failed" ? "danger" : j.status === "completed" ? "success" : j.status === "running" ? "accent" : "muted";
  const indeterminate = j.status === "running" && (j.progress == null || j.phase === "starting");
  const title = j.title || j.url;
  return (
    <li className={clsx("card job", `is-${j.status}`)}>
      <div className="job-thumb">{thumb ? <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name={j.options.kind === "audio" ? "music" : "film"} />}</div>
      <div className="job-main">
        <div className="job-top">
          <h3 className="truncate" title={title}>{title}</h3>
          <span className={`pill pill-${j.status}`}>{phaseLabel(j)}</span>
        </div>
        <p className="job-sub mono">
          {describeOptions(j.options)}
          {j.options.trimStart || j.options.trimEnd ? ` · trim ${j.options.trimStart ?? "0:00"}–${j.options.trimEnd ?? "end"}` : ""}
          {j.channel ? <span className="job-channel"> · {j.channel}</span> : null}
        </p>
        {(j.status === "running" || j.status === "paused" || j.status === "queued") && (
          <>
            <Waveform seed={j.id} progress={indeterminate ? null : j.status === "queued" ? 0 : j.progress} tone={j.status === "paused" ? "muted" : tone} label={`Progress for ${title}`} />
            <p className="job-stats mono" aria-live="off">
              {j.progress != null && j.status !== "queued" ? `${Math.round(j.progress * 100)}%` : j.status === "queued" ? "Waiting for a free slot" : ""}
              {j.phase === "downloading" && j.total ? ` · ${formatBytes(j.downloaded)} of ${formatBytes(j.total)}` : ""}
              {j.phase === "downloading" && j.speed ? ` · ${formatBytes(j.speed)}/s` : ""}
              {j.phase === "downloading" && j.eta != null ? ` · ETA ${formatDuration(j.eta)}` : ""}
            </p>
          </>
        )}
        {j.status === "failed" && j.error && (
          <div className="job-error">
            <p>{j.error.message}</p>
            {j.error.detail && (
              <>
                <button className="link-btn" aria-expanded={showDetail} onClick={() => setShowDetail((v) => !v)}>{showDetail ? "Hide details" : "Details"}</button>
                {showDetail && <pre className="mono detail">{j.error.detail}</pre>}
              </>
            )}
          </div>
        )}
        {j.finishedAt && j.status !== "failed" && <p className="fine mono">{STATUS_LABEL[j.status]} {formatDateTime(j.finishedAt)}</p>}
      </div>
      <div className="job-actions">
        {j.status === "running" && <button className="icon-btn" aria-label="Pause" title="Pause" onClick={() => onAction("pause")}><Icon name="pause" /></button>}
        {j.status === "queued" && <button className="icon-btn" aria-label="Hold" title="Hold" onClick={() => onAction("pause")}><Icon name="pause" /></button>}
        {j.status === "paused" && <button className="icon-btn" aria-label="Resume" title="Resume" onClick={() => onAction("resume")}><Icon name="play" /></button>}
        {ACTIVE.has(j.status) && <button className="icon-btn" aria-label="Cancel" title="Cancel" onClick={() => onAction("cancel")}><Icon name="x" /></button>}
        {(j.status === "failed" || j.status === "canceled") && <button className="icon-btn" aria-label="Retry" title="Retry" onClick={() => onAction("retry")}><Icon name="retry" /></button>}
        {j.status === "completed" && j.fileId && <button className="icon-btn" aria-label="Save to device" title="Save to device" onClick={onSave}><Icon name="download" /></button>}
        {!ACTIVE.has(j.status) && (
          <button className="icon-btn" aria-label="Download again" title="Download again" onClick={() => onAction("redownload")}><Icon name="queue" /></button>
        )}
        {!ACTIVE.has(j.status) && <button className="icon-btn" aria-label="Remove from history" title="Remove from history" onClick={onDelete}><Icon name="trash" /></button>}
      </div>
    </li>
  );
}
