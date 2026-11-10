import { useEffect, useRef, useState, type ReactNode } from "react";

// A step-by-step guide to saving a download to the Files app on iPad, drawn
// as simplified screens with the thing to tap highlighted.

interface Step { title: string; text: ReactNode; screen: ReactNode }

const Hi = ({ children, label }: { children: ReactNode; label?: string }) => (
  <span className="tut-hi">{children}{label && <span className="tut-tip">{label}</span>}</span>
);

function Safari({ children, toolbarHi }: { children: ReactNode; toolbarHi?: boolean }) {
  return (
    <div className="tut-device">
      <div className="tut-safari-bar">
        <span className="tut-dots" aria-hidden="true">● ● ●</span>
        <span className="tut-address">vortex-engine.here.now</span>
        {toolbarHi
          ? <Hi label="Downloads"><span className="tut-icon" aria-hidden="true">⬇</span></Hi>
          : <span className="tut-icon" aria-hidden="true">⬇</span>}
        <span className="tut-icon" aria-hidden="true">⇪</span>
      </div>
      <div className="tut-screen">{children}</div>
    </div>
  );
}

const STEPS: Step[] = [
  {
    title: "Paste the link",
    text: <>Copy the video's link (in YouTube: <b>Share → Copy link</b>, or a Google result). Tap <b>Paste</b>, then <b>Get formats</b>.</>,
    screen: (
      <Safari>
        <div className="tut-h">Downloader</div>
        <div className="tut-row">
          <span className="tut-input">https://youtu.be/…</span>
          <Hi label="1"><span className="tut-btn tut-ghost">Paste</span></Hi>
          <Hi label="2"><span className="tut-btn">Get formats</span></Hi>
        </div>
      </Safari>
    ),
  },
  {
    title: "Choose a quality",
    text: <>Tap a row. <b>720p</b> or <b>1080p</b> look best; <b>360p</b> is quickest. Wait while it downloads and combines the picture and sound. The row shows the progress.</>,
    screen: (
      <Safari>
        <div className="tut-video"><span className="tut-thumb" /><span className="tut-lines"><i /><i /></span></div>
        <div className="tut-label">Video with sound</div>
        <Hi label="Tap"><span className="tut-preset"><b>Video 720p</b><em>Combining 96%</em></span></Hi>
        <span className="tut-preset tut-dim"><b>Video 360p</b><em>119 MB</em></span>
      </Safari>
    ),
  },
  {
    title: "Allow the download",
    text: <>Safari asks whether to download the file. Tap <b>Download</b>. The file already has the video's name.</>,
    screen: (
      <Safari>
        <div className="tut-dialog">
          <p>Do you want to download “My video.mp4”?</p>
          <div className="tut-dialog-btns">
            <span>View</span>
            <Hi label="Tap"><span className="tut-dialog-main">Download</span></Hi>
          </div>
        </div>
      </Safari>
    ),
  },
  {
    title: "Check it finished",
    text: <>Tap the <b>download arrow</b> at the top of Safari to see your downloads. When it's done, tap the file's <b>magnifying glass</b> to show it in Files.</>,
    screen: (
      <Safari toolbarHi>
        <div className="tut-pop">
          <div className="tut-pop-row"><span className="tut-file">🎬</span><span><b>My video.mp4</b><em>120 MB</em></span><span className="tut-mag">🔍</span></div>
        </div>
      </Safari>
    ),
  },
  {
    title: "Find it in Files",
    text: <>Open the <b>Files</b> app and choose <b>Downloads</b> (under <b>On My iPad</b> or <b>iCloud Drive</b>). Your video is there.</>,
    screen: (
      <div className="tut-device tut-files">
        <div className="tut-side">
          <div className="tut-side-h">Locations</div>
          <span>iCloud Drive</span>
          <span>On My iPad</span>
          <Hi label="Open"><span className="tut-side-on">Downloads</span></Hi>
        </div>
        <div className="tut-grid">
          <span className="tut-doc"><span className="tut-file">🎬</span>My video.mp4</span>
          <span className="tut-doc tut-dim"><span className="tut-file">🎵</span>Song.m4a</span>
        </div>
      </div>
    ),
  },
  {
    title: "Optional: put it in Photos",
    text: <>In Files, <b>press and hold</b> the video, tap <b>Share</b>, then <b>Save Video</b>. It appears in the Photos app.</>,
    screen: (
      <div className="tut-device tut-files">
        <div className="tut-grid">
          <span className="tut-doc"><span className="tut-file">🎬</span>My video.mp4</span>
        </div>
        <div className="tut-menu">
          <span>Share</span>
          <Hi label="Tap"><span className="tut-menu-on">Save Video</span></Hi>
          <span>Copy</span>
        </div>
      </div>
    ),
  },
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = ""; prev?.focus(); };
  }, [onClose]);

  return (
    <div className="tut-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tut" role="dialog" aria-modal="true" aria-labelledby="tut-title" tabIndex={-1} ref={dialog}>
        <div className="tut-head">
          <span className="vx-eyebrow">How to save to Files · {i + 1} of {STEPS.length}</span>
          <button className="tut-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="tut-stage" key={i}>{step.screen}</div>
        <h2 id="tut-title">{step.title}</h2>
        <p className="tut-text">{step.text}</p>
        <div className="tut-foot">
          <div className="tut-pips" aria-hidden="true">
            {STEPS.map((_, n) => <button key={n} tabIndex={-1} className={n === i ? "on" : ""} onClick={() => setI(n)} />)}
          </div>
          <div className="vx-row">
            <button className="vx-btn vx-btn-ghost vx-btn-sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
            <button className="vx-btn vx-btn-primary vx-btn-sm" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? "Done" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
