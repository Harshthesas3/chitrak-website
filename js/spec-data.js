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

export const SUBSYSTEMS = [
  {
    index: "01",
    title: "CHASSIS & STRUCTURE",
    tag: "ALLOY STEEL · TOPOLOGY OPTIMIZATION · FEA",
    text: "Team CHITRAK's frame is engineered from high-strength alloy steel, chosen for its excellent strength-to-weight ratio and impact energy absorption. The design was developed using topology optimization to minimize mass while maximizing stiffness, then validated through finite element analysis (FEA) under acceleration and braking load cases — ensuring the chassis meets competition safety standards with margin to spare.",
  },
  {
    index: "02",
    title: "POWERTRAIN",
    tag: "REGENERATIVE BLDC HUB · CAN · GALVANIC ISOLATION",
    text: "A regenerative BLDC hub motor system delivers strong low-end torque and efficient power delivery across the full speed range, paired with a CAN-enabled motor controller featuring galvanic isolation between high- and low-voltage systems for enhanced rider safety.",
  },
  {
    index: "03",
    title: "ENERGY SYSTEM",
    tag: "LiFePO4 · INTEGRATED BMS · THERMAL PROTECTION",
    text: "A LiFePO4 battery pack with an integrated Battery Management System (BMS) provides reliable range, fast-charging support, and multi-layer thermal protection — engineered for both performance and longevity.",
  },
  {
    index: "04",
    title: "SAFETY SYSTEMS",
    tag: "FAIL-SAFE LOOP · FUSED PROTECTION · HV/LV ISOLATION",
    text: "Redundant safety architecture is built into every subsystem: a fail-safe shutdown loop, fused circuit protection at every major junction, and physically isolated high/low-voltage circuits work together to protect both rider and hardware in any fault condition.",
  },
];

export const SPECS = [
  { label: "Battery", value: "LiFePO4 · integrated BMS" },
  { label: "Motor", value: "Regenerative BLDC hub motor" },
  { label: "Frame", value: "High-strength alloy steel" },
  { label: "Suspension", value: null },
  { label: "Braking", value: null },
  { label: "Drivetrain", value: "CAN controller · galvanic isolation" },
  { label: "Weight", value: "96 kg" },
];

export const PERFORMANCE = [
  { label: "TOP SPEED", value: 85, unit: "kmph" },
  { label: "PEAK POWER", value: 4, unit: "kW" },
  { label: "RATED POWER", value: 2, unit: "kW" },
  { label: "TORQUE", value: 127, unit: "Nm" },
  { label: "RANGE", value: null, unit: "" },
  { label: "WEIGHT", value: 96, unit: "kg" },
]; // Chitrak previous gen (2025) — acceleration / gradient blank in source

export const COMPETITIONS = []; // { season, event, result } — add only confirmed entries

export const TEAM = [
  { name: "Dr. Rajkumar", role: "Faculty Incharge / Mentor", group: "faculty" },
  { name: "T Harshith Krishna Sastry", role: "President", group: "leadership" },
  { name: "Pradyun Venkateshan", role: "Vice President", group: "leadership" },
  { name: "Disha", role: "Secretary", group: "leadership" },
  { name: "Sainath Reddy", role: "Telemetry Analyst", group: "engineering" },
  { name: "Vishwa", role: "Data Analyst", group: "engineering" },
  { name: "Yashwanth RK", role: "Electrical Wing Head", group: "engineering" },
  { name: "Trisha Prasad", role: "Media & Sponsorship Head", group: "media" },
]; // authoritative roster — no bios, photos, or links

export const TEAM_GROUPS = [
  { id: "faculty", index: "01", title: "FACULTY MENTOR" },
  { id: "leadership", index: "02", title: "LEADERSHIP" },
  { id: "engineering", index: "03", title: "ENGINEERING & DATA" },
  { id: "media", index: "04", title: "MEDIA & PARTNERSHIPS" },
];

export const CONTACT = { email: "chitrak@rvce.edu.in" };
