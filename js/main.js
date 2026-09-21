import { MACHINE_CARDS, SPECS, PERFORMANCE, COMPETITIONS, TEAM, TEAM_GROUPS, CONTACT } from "./spec-data.js";
import { createScrollVideo } from "./scroll-video.js";
import { renderCallouts } from "./callouts.js";

const $ = (s, r = document) => r.querySelector(s);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- section renderers (placeholders stay visibly blank) ---------- */
function renderMachine() {
  const grid = $("#machineGrid");
  grid.innerHTML = "";
  for (const c of MACHINE_CARDS) {
    const card = document.createElement("article");
    card.className = "machine-card";
    card.innerHTML = `
      <figure><img loading="lazy" src="${c.img}" alt="${c.alt}" /></figure>
      <div class="body"><h3>${c.title}</h3><p>${c.text}</p>
      <span class="status">${c.status}</span></div>`;
    grid.appendChild(card);
  }
}

function renderSpecs() {
  const dl = $("#specTable");
  dl.innerHTML = "";
  for (const s of SPECS) {
    const row = document.createElement("div");
    row.className = "spec-row";
    const dd = s.value == null
      ? `<dd class="tbd">&mdash; TBD</dd>`
      : `<dd>${s.value}</dd>`;
    row.innerHTML = `<dt>${s.label}</dt>${dd}`;
    dl.appendChild(row);
  }
}

function renderPerf() {
  const grid = $("#perfGrid");
  grid.innerHTML = "";
  for (const p of PERFORMANCE) {
    const cell = document.createElement("div");
    cell.className = "perf-cell";
    // Counters animate only for confirmed numbers; otherwise a static em-dash.
    cell.innerHTML = p.value == null
      ? `<div class="num">&mdash;</div><div class="lbl">${p.label} &middot; TBD</div>`
      : `<div class="num" data-count="${p.value}">0</div><div class="lbl">${p.label}${p.unit ? " &middot; " + p.unit : ""}</div>`;
    grid.appendChild(cell);
  }
}

function renderComp() {
  const ul = $("#compList");
  ul.innerHTML = "";
  if (!COMPETITIONS.length) {
    ul.innerHTML = `<li>2026 season &mdash; entries to be confirmed.</li>`;
    return;
  }
  for (const c of COMPETITIONS) {
    const li = document.createElement("li");
    li.textContent = `${c.season} — ${c.event}${c.result ? " — " + c.result : ""}`;
    ul.appendChild(li);
  }
}

function renderTeam() {
  const mount = $("#teamGrid");
  mount.innerHTML = "";
  if (!TEAM.length) {
    mount.innerHTML = `<div class="team-empty">Roster publishes on confirmation. No placeholder names.</div>`;
    return;
  }
  let seq = 0;
  for (const g of TEAM_GROUPS) {
    const members = TEAM.filter((m) => m.group === g.id);
    if (!members.length) continue;
    const group = document.createElement("div");
    group.className = `team-group team-group--${g.id}`;

    const heading = document.createElement("h3");
    heading.className = "team-group-title";
    heading.innerHTML = `<span class="team-group-index">${g.index}</span><span aria-hidden="true"> // </span><span>${g.title}</span>`;
    group.appendChild(heading);

    const roster = document.createElement("div");
    roster.className = `team-roster team-roster--${g.id}`;
    roster.setAttribute("role", "list");
    for (const m of members) {
      seq += 1;
      const card = document.createElement("article");
      card.className = "team-card";
      card.setAttribute("role", "listitem");
      card.setAttribute("tabindex", "0");
      const idx = String(seq).padStart(2, "0");
      const nameEl = document.createElement("span");
      nameEl.className = "team-index";
      nameEl.setAttribute("aria-hidden", "true");
      nameEl.textContent = idx;
      const h = document.createElement("h4");
      h.className = "team-name";
      h.textContent = m.name;
      const r = document.createElement("p");
      r.className = "team-role";
      r.textContent = m.role;
      card.append(nameEl, h, r);
      roster.appendChild(card);
    }
    group.appendChild(roster);
    mount.appendChild(group);
  }
}

function renderContact() {
  const a = document.querySelector('[data-contact="email"]');
  if (a && CONTACT.email) {
    const subject = "Chitrak RVCE — Sponsorship / Partnership Inquiry";
    a.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}`;
  }
}

/* ---------- hero typography choreography (shares the hero scroll range) ----------
   p0 state == CSS defaults (title/kicker/sub visible) so first paint is
   already composed; the timeline only moves things away and back. */
function heroTimeline() {
  // Mobile GPUs rasterize huge blended/blurred text every frame while the
  // video seeks underneath — drop the blur and the hidden callouts there.
  // Desktop choreography is untouched.
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: "#hero",
      start: 0, // hero is the first document element; see scroll-video.js
      end: () => `+=${Math.round(window.innerHeight * (window.innerWidth < 760 ? 2.0 : 3.5))}`,
      scrub: 0.4,
      invalidateOnRefresh: true,
    },
  });
  // 0–15%: settle — title breathes, nothing leaves yet
  tl.to('[data-hero="title"]', { y: "-6%", scale: 0.98, duration: 0.8, ease: "none" }, 0)
    .to('[data-hero="cue"]', { opacity: 0, duration: 0.3 }, 0.15)
    // 15–40%: title lifts + recedes to clear the bike as the orbit runs
    .to('[data-hero="title"]', { y: "-46%", scale: 0.58, opacity: 0.3, duration: 1.2, ease: "power1.inOut" }, 0.8)
    .to('[data-hero="sub"]', { opacity: 0, y: -30, duration: 0.6 }, 0.9)
    .to('[data-hero="kicker"]', { opacity: 0, duration: 0.5 }, 1.0)
    // 40–65%: technical callouts, windowed to orbit angles where each
    // region is actually on screen (front → flank → rear → flank).
    // Skipped on mobile: .hero-callouts is display:none there.
    if (!isMobile) {
    tl.fromTo('.callout[data-zone="fork"]', { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.35 }, 1.9)
    .to('.callout[data-zone="fork"]', { opacity: 0, duration: 0.3 }, 2.4)
    .fromTo('.callout[data-zone="cell"]', { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.35 }, 2.3)
    .to('.callout[data-zone="cell"]', { opacity: 0, duration: 0.3 }, 2.8)
    .fromTo('.callout[data-zone="drive"]', { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.35 }, 2.6)
    .to('.callout[data-zone="drive"]', { opacity: 0, duration: 0.3 }, 3.1)
    .fromTo('.callout[data-zone="brake"]', { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.35 }, 2.85)
    .to('.callout[data-zone="brake"]', { opacity: 0, duration: 0.3 }, 3.3);
    }
    // 65–85%: aggressive statement, clip-reveal per line over soft blur
    // (blur omitted on mobile — compositor-only transform + opacity instead)
    tl.to('[data-hero="title"]', { opacity: 0, y: "-80%", duration: 0.3 }, 3.05)
    .to('[data-hero="statement"]', { opacity: 1, duration: 0.3 }, 3.15);
    if (isMobile) {
      tl.fromTo(".stmt-line", { yPercent: 112 }, { yPercent: 0, stagger: 0.14, duration: 0.55, ease: "power3.out" }, 3.2);
    } else {
      tl.fromTo(".stmt-line", { yPercent: 112, filter: "blur(5px)" },
        { yPercent: 0, filter: "blur(0px)", stagger: 0.14, duration: 0.55, ease: "power3.out" }, 3.2);
    }
    tl.fromTo('[data-hero="aggressive"]', { opacity: 0 }, { opacity: 0.55, duration: 0.6 }, 3.25)
    .to('[data-hero="statement"]', { opacity: 0, y: -40, duration: 0.45 }, 4.25)
    .to('[data-hero="aggressive"]', { opacity: 0, duration: 0.4 }, 4.25)
    // 85–100%: simplify to mark + CTA over the completed arc
    .fromTo('[data-hero="end"]', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.55 }, 4.4);
  return tl;
}

/* ---------- generic section reveals (one trigger each, no loops) ---------- */
function reveals() {
  gsap.utils.toArray(".section-head").forEach((head) => {
    gsap.fromTo(head, { opacity: 0, y: 50 }, {
      opacity: 1, y: 0, duration: 0.9, ease: "power2.out",
      scrollTrigger: { trigger: head, start: "top 82%" },
    });
  });
  gsap.utils.toArray(".machine-card, .perf-cell, .spec-row, .team-group-title, .team-card").forEach((el, i) => {
    gsap.fromTo(el, { opacity: 0, y: 34 }, {
      opacity: 1, y: 0, duration: 0.7, ease: "power2.out", delay: (i % 4) * 0.05,
      scrollTrigger: { trigger: el, start: "top 88%" },
    });
  });
}

/* ---------- perf counters (confirmed values only) ---------- */
function counters() {
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = parseFloat(el.dataset.count);
    if (!Number.isFinite(target)) return;
    ScrollTrigger.create({
      trigger: el, start: "top 85%", once: true,
      onEnter: () => {
        const obj = { v: 0 };
        gsap.to(obj, { v: target, duration: 1.4, ease: "power2.out",
          onUpdate: () => { el.textContent = Math.round(obj.v); } });
      },
    });
  });
}

/* ---------- nav ---------- */
function nav() {
  const burger = $("#navBurger");
  const menu = $("#mobileMenu");
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
    }));
}

/* ---------- boot ---------- */
function boot() {
  renderMachine();
  renderSpecs();
  renderPerf();
  renderComp();
  renderTeam();
  renderContact();
  renderCallouts($("#heroCallouts"));
  nav();

  const video = $("#chitrakVideo");
  const controller = createScrollVideo({ video });
  const { mode } = controller.init();
  // Full choreography needs GSAP; without it the controller's sticky
  // fallback still scrubs the video and the hero rests in its p0 state.
  if (mode !== "reduced" && window.gsap && window.ScrollTrigger) {
    heroTimeline();
    reveals();
    counters();
  } else if (mode !== "reduced") {
    console.warn("[chitrak] GSAP unavailable — sticky fallback scrub active.");
  }
  // ScrollTrigger already debounces its own resize refresh; no manual
  // refresh here — a forced synchronous refresh mid-layout can seek the
  // video from a transient progress value.
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
