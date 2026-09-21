/* Centralized scroll-video controller.
   One ScrollTrigger determines the TARGET video time; a single rAF loop
   smoothly converges the displayed time toward it:
   scroll progress -> targetTime ->(lerp)-> video.currentTime.
   No autoplay, no playback-rate tricks, no seek queue. */

const EPS = 0.05; // keep the last frame from holding; preserves perceived continuity
const SMOOTH = 0.2; // convergence per frame: ~63% in 4 frames, ~95% in ~14 — responsive, not laggy
const SETTLE = 0.02; // <= ~half a video frame (1/24s): snap zone, no perceptible step
const SEEK_MIN = 0.008; // never write currentTime for sub-perceptual deltas

export function createScrollVideo({ video, start = 0, end = 100 } = {}) {
  // Touch decoders stall when hammered with sub-frame seeks every rAF tick:
  // converge more calmly and never write deltas below ~one video frame.
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const smooth = coarse ? 0.12 : SMOOTH;
  const seekMin = coarse ? 0.04 : SEEK_MIN;
  let st = null;
  let duration = 0;
  let ready = false;
  let target = 0; // where the scroll position says we should be
  let displayed = 0; // where the video currently is (converges to target)
  let raf = 0;
  let resizeTimer = 0;
  let stallCount = 0;
  let stallWarned = false;
  let verifyAt = 0;
  let verifyTime = 0;
  const pctEls = [document.getElementById("scrollPct")].filter(Boolean);
  const barEl = document.getElementById("progressBar");

  let lastPct = -1;
  let lastBar = -1;
  function setPct(p) {
    // Cheap guard: skip DOM writes when nothing visible changed. Matters
    // most on mobile, where every style recalc steals decoder time.
    const v = Math.round(p * 100);
    if (v !== lastPct) {
      lastPct = v;
      const label = String(v).padStart(2, "0");
      for (const el of pctEls) el.textContent = label;
    }
    const b = Math.round(Math.min(Math.max(p, 0), 1) * 1000) / 1000;
    if (b !== lastBar) {
      lastBar = b;
      if (barEl) barEl.style.transform = `scaleX(${b.toFixed(4)})`;
    }
  }

  function clampTime(t) {
    return Math.min(Math.max(t, 0), Math.max(duration - EPS, 0));
  }

  // Single committed seek. The media pipeline always acts on the latest
  // write, so rapid target changes can never build a backlog of seeks.
  function commitSeek(t) {
    const clamped = clampTime(t);
    // Avoid redundant writes that cause flicker on some decoders.
    if (Math.abs(video.currentTime - clamped) <= seekMin) return;
    try { video.currentTime = clamped; } catch { /* metadata race: ignore */ }
    // Stall detector: if the browser never honors seeks (e.g. a dev
    // server without HTTP Range support), say so exactly once.
    verifyAt = performance.now() + 600;
    verifyTime = clamped;
  }

  // One loop for the life of the controller: converge displayed -> target,
  // forward or reverse, with identical behavior. Direction changes just
  // move the target; convergence follows without jumping.
  function tick() {
    raf = requestAnimationFrame(tick);
    if (verifyAt && performance.now() >= verifyAt) {
      verifyAt = 0;
      if (Math.abs(video.currentTime - verifyTime) > 0.5) {
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
    }
    if (!ready || !Number.isFinite(duration) || duration <= 0) return;
    const span = Math.max(duration - EPS, EPS);
    const diff = target - displayed;
    if (Math.abs(diff) <= SETTLE) {
      if (displayed !== target) {
        displayed = target;
        commitSeek(target); // one final settling seek, then rest
        setPct(target / span);
      }
      return;
    }
    displayed += diff * smooth;
    if (Math.abs(target - displayed) <= SETTLE) displayed = target;
    commitSeek(displayed);
    setPct(displayed / span);
  }

  // Scroll handlers only ever move the target — never touch currentTime.
  function requestSeek(t) {
    target = clampTime(ready ? t : 0);
  }

  function onProgress(self) {
    if (!ready) return;
    target = start + self.progress * (duration - EPS - start);
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
      end: () => `+=${Math.round(window.innerHeight * (window.innerWidth < 760 ? 2.0 : 3.5))}`,
      pin: "#heroPin",
      anticipatePin: 1,
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: onProgress,
      onRefresh: (self) => onProgress(self),
    });
    // Post-settle resync: ScrollTrigger's own refresh can momentarily
    // report a transient progress mid-layout; re-target once stable.
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (st && ready) onProgress(st); }, 450);
    }, { passive: true });
    return true;
  }

  function loopStart() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function loopStop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function init() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return { mode: "reduced" }; // poster frame only; no pin, no scrub, no loop
    }
    const onReady = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        duration = video.duration;
        ready = true;
        loopStart();
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
     moves the same smoothing target — convergence behavior is identical. */
  function initFallback() {
    document.documentElement.classList.add("fallback-pin");
    const hero = document.getElementById("hero");
    let ticking = false;
    const update = () => {
      ticking = false;
      if (!ready || !hero) return;
      const range = hero.offsetHeight - window.innerHeight;
      const p = range > 0 ? Math.min(Math.max(window.scrollY / range, 0), 1) : 0;
      target = p * Math.max(duration - EPS, 0);
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
    loopStop();
    if (st) { st.kill(); st = null; }
    if (fallbackCleanup) { fallbackCleanup(); fallbackCleanup = null; }
    ready = false;
  }

  return { init, destroy, requestSeek };
}
