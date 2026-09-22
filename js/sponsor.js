/* Sponsor page behavior: nav, scroll reveals, parallax, copy-email.
   Same animation language as homepage: clip-path / translate / opacity /
   scale / subtle parallax / technical line animations. Deliberate, not busy. */

const EMAIL = "chitrak@rvce.edu.in";
const SUBJECT = "Chitrak RVCE — Sponsorship / Partnership Inquiry";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- nav ---------- */
function nav() {
  const burger = document.getElementById("navBurger");
  const menu = document.getElementById("mobileMenu");
  if (!burger || !menu) return;
  burger.addEventListener("click", () => {
    const open = menu.hasAttribute("hidden");
    if (open) menu.removeAttribute("hidden");
    else menu.setAttribute("hidden", "");
    burger.setAttribute("aria-expanded", String(open));
  });
  menu.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      menu.setAttribute("hidden", "");
      burger.setAttribute("aria-expanded", "false");
    })
  );
}

/* ---------- copy email ---------- */
function copyEmail() {
  const btn = document.getElementById("copyEmail");
  const msg = document.getElementById("copiedMsg");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(EMAIL);
      ok = true;
    } catch {
      // Clipboard API unavailable (permissions / non-secure context): fallback.
      const ta = document.createElement("textarea");
      ta.value = EMAIL;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    if (ok && msg) {
      msg.hidden = false;
      btn.textContent = "Copied";
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        msg.hidden = true;
        btn.textContent = "Copy email";
      }, 1800);
    } else {
      btn.textContent = EMAIL;
    }
  });
}

/* ---------- scroll animations ---------- */
function reveals() {
  if (!window.gsap || !window.ScrollTrigger) return false;
  gsap.registerPlugin(ScrollTrigger);

  // Hero intro: line-mask rise + fade, once on load.
  gsap.fromTo(
    ".sp-hero .sp-line",
    { yPercent: 112 },
    { yPercent: 0, duration: 1.1, ease: "power3.out", stagger: 0.12, delay: 0.15 }
  );
  gsap.fromTo(
    ".sp-hero-quote, .sp-hero-sub, .sp-hero-actions, .sp-hero-meta",
    { opacity: 0, y: 26 },
    { opacity: 1, y: 0, duration: 0.9, ease: "power2.out", stagger: 0.1, delay: 0.5 }
  );
  gsap.fromTo(
    ".sp-hero .mono-label",
    { opacity: 0, x: -18 },
    { opacity: 1, x: 0, duration: 0.7, ease: "power2.out", delay: 0.1 }
  );

  // Subtle hero parallax: media drifts + fades as you leave the hero.
  gsap.to(".sp-hero-media", {
    yPercent: 12,
    scale: 1.06,
    opacity: 0.35,
    ease: "none",
    scrollTrigger: { trigger: ".sp-hero", start: "top top", end: "bottom top", scrub: true },
  });
  gsap.to(".sp-hero-inner", {
    y: -60,
    opacity: 0.25,
    ease: "none",
    scrollTrigger: { trigger: ".sp-hero", start: "top top", end: "bottom 30%", scrub: true },
  });

  // Generic section reveals: clip + rise, one trigger each.
  gsap.utils.toArray(".sp-why .section-head, .sp-ways .section-head, .sp-machine .section-head, .sp-final .mono-label, .sp-final h2, .sp-final .section-lede, .sp-final .final-actions").forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 50, clipPath: "inset(12% 0 12% 0)" },
      {
        opacity: 1, y: 0, clipPath: "inset(0% 0 0% 0)",
        duration: 0.9, ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 84%" },
      }
    );
  });

  // Cards: staggered rise with technical line sweep.
  gsap.utils.toArray(".sp-card, .sp-tier, .sp-still, .sp-contact-card").forEach((el, i) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 36, scale: 0.985 },
      {
        opacity: 1, y: 0, scale: 1,
        duration: 0.7, ease: "power2.out", delay: (i % 3) * 0.06,
        scrollTrigger: { trigger: el, start: "top 90%" },
      }
    );
  });

  // Scroll progress hairline under hero.
  const bar = document.getElementById("spProgress");
  if (bar) {
    gsap.to(bar, {
      scaleX: 1, ease: "none",
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.3 },
    });
  }
  return true;
}

function boot() {
  nav();
  copyEmail();
  if (reduced()) return; // content stays in its natural composed state
  if (!reveals()) {
    console.warn("[chitrak] GSAP unavailable — sponsor page shown without scroll animation.");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
