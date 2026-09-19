/* Centralized scroll-video controller.
   One ScrollTrigger drives the video as a deterministic timeline:
   scroll progress -> video.currentTime. No autoplay, no playback-rate tricks. */

const EPS = 0.05; // keep the last frame from holding; preserves perceived continuity

export function createScrollVideo({ video, start = 0, end = 100 } = {}) {
  let st = null;
  let duration = 0;
  let ready = false;
  let seekQueued = false;
  let pendingTime = 0;
  let resizeTimer = 0;
  let stallCount = 0;
  let stallWarned = false;
  const pctEls = [document.getElementById("scrollPct")].filter(Boolean);
  const barEl = document.getElementById("progressBar");

  function setPct(p) {
    const v = String(Math.round(p * 100)).padStart(2, "0");
    for (const el of pctEls) el.textContent = v;
    if (barEl) barEl.style.transform = `scaleX(${Math.min(Math.max(p, 0), 1).toFixed(4)})`;
  }

  // Serialize seeks through rAF: at most one currentTime write per frame,
  // so fast scrolls never queue hundreds of seeks.
  function requestSeek(t) {
    pendingTime = t;
    if (seekQueued) return;
    seekQueued = true;
    requestAnimationFrame(() => {
      seekQueued = false;
      if (!ready || !Number.isFinite(duration) || duration <= 0) return;
      const clamped = Math.min(Math.max(pendingTime, 0), Math.max(duration - EPS, 0));
      // Avoid redundant seeks that cause flicker on some decoders.
      if (Math.abs(video.currentTime - clamped) > 1 / 60) {
        try { video.currentTime = clamped; } catch { /* metadata race: ignore */ }
        // Stall detector: if the browser never honors seeks (e.g. a dev
        // server without HTTP Range support), say so exactly once.
        const target = clamped;
        setTimeout(() => {
          if (Math.abs(video.currentTime - target) > 0.5) {
            stallCount += 1;
            if (stallCount >= 3 && !stallWarned) {
              stallWarned = true;
              console.warn(
                "[chitrak] video seeks are stalling — the dev server must " +
                "support HTTP Range requests. Use `python serve.py` instead " +
                "of `python -m http.server`."
              );
            }
          } else {
            stallCount = 0;
          }
        }, 600);
      }
      setPct(duration > 0 ? clamped / Math.max(duration - EPS, EPS) : 0);
    });
  }

  function onProgress(self) {
    requestSeek(start + self.progress * (duration - EPS - start));
  }

  function bind() {
    if (!window.gsap || !window.ScrollTrigger) return false;
    gsap.registerPlugin(ScrollTrigger);
    st = ScrollTrigger.create({
      trigger: "#hero",
      // Numeric start: the hero is the first document element, so its top
      // is always 0. This avoids re-measuring a pinned trigger's start on
      // resize, which Chromium can report viewport-relative (negative).
      start: 0,
      end: () => `+=${Math.round(window.innerHeight * (window.innerWidth < 760 ? 2.5 : 3.5))}`,
      pin: "#heroPin",
      anticipatePin: 1,
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: onProgress,
      onRefresh: (self) => onProgress(self),
    });
    // Post-settle resync: ScrollTrigger's own refresh can momentarily
    // report a transient progress mid-layout; re-seek once stable.
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (st && ready) onProgress(st); }, 450);
    }, { passive: true });
    return true;
  }

  function init() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return { mode: "reduced" }; // poster frame only; no pin, no scrub
    }
    const onReady = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        duration = video.duration;
        ready = true;
        if (!window.gsap || !window.ScrollTrigger) {
          initFallback(); // CDN blocked/offline: CSS sticky pin + vanilla scrub
          return;
        }
        if (!st) bind();
        else ScrollTrigger.refresh();
      }
    };
    if (Number.isFinite(video.duration) && video.duration > 0) onReady();
    video.addEventListener("loadedmetadata", onReady, { once: false });
    video.addEventListener("canplay", onReady, { once: true });
    // Metadata-only preload: nothing to do until user scrolls.
    return { mode: "scrub" };
  }

  /* Fallback path: no GSAP available. The hero is stretched tall and the
     viewport sticks to it with pure CSS; a single passive scroll listener
     maps scroll position to video time through the same rAF serializer. */
  function initFallback() {
    document.documentElement.classList.add("fallback-pin");
    const hero = document.getElementById("hero");
    let ticking = false;
    const update = () => {
      ticking = false;
      if (!ready || !hero) return;
      const range = hero.offsetHeight - window.innerHeight;
      const p = range > 0 ? Math.min(Math.max(window.scrollY / range, 0), 1) : 0;
      requestSeek(p * Math.max(duration - EPS, 0));
    };
    const onScroll = () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    fallbackCleanup = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.documentElement.classList.remove("fallback-pin");
    };
    update();
  }

  let fallbackCleanup = null;

  function destroy() {
    if (st) { st.kill(); st = null; }
    if (fallbackCleanup) { fallbackCleanup(); fallbackCleanup = null; }
    ready = false;
  }

  return { init, destroy, requestSeek };
}
