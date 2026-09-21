/* Central content model. Every unverified value is null and renders as "—".
   Replace nulls with confirmed strings/numbers only. Never invent specs. */

export const MACHINE_CARDS = [
  {
    id: "front",
    title: "FRONT",
    img: "public/images/machine-front.webp",
    alt: "Still crop of the Chitrak front fork and front wheel from the orbit video",
    text: "Fork, front brake and front wheel region. Detail pending verification.",
    status: "DETAIL TBD",
  },
  {
    id: "profile",
    title: "PROFILE",
    img: "public/images/machine-side.webp",
    alt: "Still crop of the Chitrak side profile from the orbit video",
    text: "Full side profile: bodywork, seat and livery. Detail pending verification.",
    status: "DETAIL TBD",
  },
  {
    id: "tail",
    title: "TAIL / DRIVE",
    img: "public/images/machine-rear.webp",
    alt: "Still crop of the Chitrak tail and rear wheel region from the orbit video",
    text: "Tail unit, rear wheel and drive region. Detail pending verification.",
    status: "DETAIL TBD",
  },
];

export const SPECS = [
  { label: "Battery", value: null },
  { label: "Motor", value: null },
  { label: "Frame", value: null },
  { label: "Suspension", value: null },
  { label: "Braking", value: null },
  { label: "Drivetrain", value: null },
];

export const PERFORMANCE = [
  { label: "TOP SPEED", value: null, unit: "" },
  { label: "RANGE", value: null, unit: "" },
  { label: "PEAK POWER", value: null, unit: "" },
  { label: "WEIGHT", value: null, unit: "" },
];

export const COMPETITIONS = []; // { season, event, result } — add only confirmed entries

export const TEAM = [
  { name: "T Harshith Krishna Sastry", role: "President", group: "leadership" },
  { name: "Pradyun Venkateshan", role: "Vice President", group: "leadership" },
  { name: "Disha", role: "Secretary", group: "leadership" },
  { name: "Sainath Reddy", role: "Telemetry Analyst", group: "engineering" },
  { name: "Vishwa", role: "Data Analyst", group: "engineering" },
  { name: "Yashwanth RK", role: "Electrical Wing Head", group: "engineering" },
  { name: "Trisha Prasad", role: "Media & Sponsorship Head", group: "media" },
]; // authoritative roster — no bios, photos, or links

export const TEAM_GROUPS = [
  { id: "leadership", index: "01", title: "LEADERSHIP" },
  { id: "engineering", index: "02", title: "ENGINEERING & DATA" },
  { id: "media", index: "03", title: "MEDIA & PARTNERSHIPS" },
];

export const CONTACT = { email: "chitrak@rvce.edu.in" };
