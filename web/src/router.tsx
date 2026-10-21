import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Route = "download" | "queue" | "library" | "settings";

export const ROUTES: Record<Route, string> = {
  download: "/",
  queue: "/queue",
  library: "/library",
  settings: "/settings",
};

function fromPath(path: string): Route {
  const hit = (Object.entries(ROUTES) as [Route, string][]).find(([, p]) => p === path.replace(/\/+$/, "") || (p === "/" && path === "/"));
  return hit ? hit[0] : "download";
}

interface RouterApi {
  route: Route;
  go(route: Route): void;
}

const Ctx = createContext<RouterApi | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => fromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(fromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((r: Route) => {
    if (window.location.pathname !== ROUTES[r]) window.history.pushState({}, "", ROUTES[r]);
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);
  const value = useMemo(() => ({ route, go }), [route, go]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRouter outside RouterProvider");
  return ctx;
}
