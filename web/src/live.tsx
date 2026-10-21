import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { api, openEventStream } from "./api";
import { useRemoteSettingsListener } from "./settings";
import type { Job } from "./types";

// Live state pushed by the backend over SSE (/events): job progress, library
// changes, and settings saved on other devices. No polling.

type Action =
  | { type: "snapshot"; jobs: Job[] }
  | { type: "upsert"; job: Job }
  | { type: "remove"; id: string };

function reducer(state: Record<string, Job>, a: Action): Record<string, Job> {
  switch (a.type) {
    case "snapshot":
      return Object.fromEntries(a.jobs.map((j) => [j.id, j]));
    case "upsert":
      return { ...state, [a.job.id]: a.job };
    case "remove": {
      const next = { ...state };
      delete next[a.id];
      return next;
    }
  }
}

interface LiveApi {
  jobs: Job[];
  connection: "connecting" | "open" | "closed";
  libraryVersion: number;
  upsert(job: Job): void;
  remove(id: string): void;
}

const Ctx = createContext<LiveApi | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [jobsById, dispatch] = useReducer(reducer, {});
  const [connection, setConnection] = useState<LiveApi["connection"]>("connecting");
  const [libraryVersion, setLibraryVersion] = useState(0);
  const onRemoteSettings = useRemoteSettingsListener();
  const settingsRef = useRef(onRemoteSettings);
  settingsRef.current = onRemoteSettings;

  useEffect(() => {
    let libTimer: number | undefined;
    const close = openEventStream({
      onStatus: setConnection,
      onEvent: (event, data) => {
        if (event === "hello") {
          dispatch({ type: "snapshot", jobs: data.jobs });
          settingsRef.current(data.settingsUpdatedAt);
          setLibraryVersion((v) => v + 1);
        } else if (event === "job") {
          dispatch({ type: "upsert", job: data });
        } else if (event === "job_removed") {
          dispatch({ type: "remove", id: data.id });
        } else if (event === "library") {
          window.clearTimeout(libTimer);
          libTimer = window.setTimeout(() => setLibraryVersion((v) => v + 1), 300);
        } else if (event === "settings") {
          settingsRef.current(data.updatedAt);
        }
      },
    });
    return () => {
      close();
      window.clearTimeout(libTimer);
    };
  }, []);

  // If the stream is down, fall back to one fetch so the UI isn't empty.
  useEffect(() => {
    if (connection !== "closed") return;
    api<{ jobs: Job[] }>("/api/jobs").then((r) => dispatch({ type: "snapshot", jobs: r.jobs })).catch(() => {});
  }, [connection]);

  const jobs = useMemo(() => Object.values(jobsById).sort((a, b) => b.createdAt - a.createdAt), [jobsById]);
  const upsert = useCallback((job: Job) => dispatch({ type: "upsert", job }), []);
  const remove = useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const value = useMemo(() => ({ jobs, connection, libraryVersion, upsert, remove }), [jobs, connection, libraryVersion, upsert, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): LiveApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLive outside LiveProvider");
  return ctx;
}
