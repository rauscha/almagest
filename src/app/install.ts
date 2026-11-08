/**
 * Running as an installed app, or in a browser tab.
 *
 * Installed, the manifest's `fullscreen` display mode is the app's own window state: it survives the
 * page being hidden and shows no toast. The Fullscreen API on top of it costs "drag from the top to
 * exit" on every wake, because Android drops API fullscreen whenever the page is hidden. So it's only
 * ever for a browser tab, where it's the one way to hide the bars.
 */
export type DisplayMode = "fullscreen" | "standalone" | "browser";

export function displayMode(): DisplayMode {
  try {
    if (matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
    if (matchMedia("(display-mode: standalone)").matches) return "standalone";
  } catch {
    // No matchMedia here, so nothing says it's installed.
  }
  return "browser";
}

export const isInstalled = () => displayMode() !== "browser";

/** Hides the bars in a browser tab. Does nothing at all when installed. */
export async function enterFullscreen(): Promise<void> {
  if (isInstalled() || document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
  } catch {
    // Not every browser allows this, and the instrument works without it.
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (isInstalled()) return;
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  else await enterFullscreen();
}

/**
 * The service worker, which is what lets the app open offline: each launch takes up the newest version,
 * but airplane mode never makes it hang.
 *
 * The page always opens at once from the copy on the phone; nothing here is waited on. Meanwhile each
 * launch asks the server for a newer version, and if one arrives before the first tap, the page swaps to
 * it with one reload. A tap can't outrun that: if a new version is already downloaded when the start
 * button is tapped, `takeUpdate` swaps to it then (an earlier rule lost every race to a quick tap, and
 * left a phone a day behind). It never reloads a page being played: a version that arrives after the
 * tap waits, and the next launch takes it up. Offline, the ask simply fails.
 */
let ready: ServiceWorker | null = null;
let swapping = false;
let reloadUnlessStarted: () => void = () => {};

function swap(worker: ServiceWorker) {
  if (swapping) return;
  swapping = true;
  navigator.serviceWorker.addEventListener("controllerchange", () => reloadUnlessStarted(), { once: true });
  worker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * For the start button: true when a newer version is downloaded (or already being swapped in), in which
 * case the page is about to reload into it and starting the old one would be wasted.
 */
export function takeUpdate(): boolean {
  if (swapping) return true;
  if (!ready) return false;
  swap(ready);
  return true;
}

export async function registerUpdates(hasStarted: () => boolean): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  reloadUnlessStarted = () => {
    if (!hasStarted()) location.reload();
  };
  try {
    // updateViaCache "none": the check always reaches the server, never an HTTP-cached sw.js.
    const reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    // The very first visit: this page already is the newest, and the copy is being saved.
    if (!navigator.serviceWorker.controller) return;
    const takeUp = (worker: ServiceWorker) => {
      ready = worker;
      if (!hasStarted()) swap(worker);
    };
    const whenReady = (worker: ServiceWorker) => {
      if (worker.state === "installed") takeUp(worker);
      else worker.addEventListener("statechange", () => worker.state === "installed" && takeUp(worker));
    };
    if (reg.waiting) takeUp(reg.waiting);
    if (reg.installing) whenReady(reg.installing);
    reg.addEventListener("updatefound", () => reg.installing && whenReady(reg.installing));
    reg.update().catch(() => {}); // offline, or the server's away: the copy on the phone carries on
  } catch {
    // Only an offline copy is lost, and the app works without it.
  }
}
