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

export const TEAM = []; // { name, role } — add only confirmed members

export const CONTACT = { email: "contact@example.com" }; // TODO: replace with team inbox
