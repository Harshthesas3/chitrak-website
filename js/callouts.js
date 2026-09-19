/* TechnicalCallout factory. Callouts are labels + thin rules positioned
   over approximate bike regions — never fake exploded parts. */

export const HERO_CALLOUTS = [
  { zone: "fork", label: "FRONT FORK", flip: true },
  { zone: "cell", label: "ENERGY CELL", flip: true },
  { zone: "drive", label: "DRIVE UNIT", flip: true },
  { zone: "brake", label: "BRAKING", flip: false },
];

export function renderCallouts(mount, items = HERO_CALLOUTS) {
  mount.innerHTML = "";
  for (const c of items) {
    const el = document.createElement("div");
    el.className = "callout" + (c.flip ? " flip" : "");
    el.dataset.zone = c.zone;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = c.label;
    const rule = document.createElement("span");
    rule.className = "rule";
    el.append(tag, rule);
    mount.appendChild(el);
  }
  return mount.children;
}
