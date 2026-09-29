// Workshops show only a facilitator's first name. Identity, though, is
// decided on first + last name: "Revati Shinde" and a bare "Revati" are the
// same person only while there is exactly one Revati; "Priya Sharma" and
// "Priya Kulkarni" stay two people and are displayed as "Priya S." /
// "Priya K.". Names come from assigned accounts (User.name) and from the
// free-text Event.instructorName / associateInstructorName used for staff
// without an account.

const HONORIFICS = new Set(["dr", "prof", "mr", "mrs", "ms", "miss", "shri", "smt", "sri"]);

const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

const nameWords = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.,]/g, ""))
    .filter((w) => w && !HONORIFICS.has(w.toLowerCase()));

// One field sometimes carries several people ("Chaitralee, Ipsita, Mansi").
const splitPeople = (name) =>
  String(name || "").split(/\s*(?:,|&|\band\b)\s*/i).map((p) => p.trim()).filter(Boolean);

export const toFirstName = (name) => {
  const people = splitPeople(name).map((p) => nameWords(p)[0]).filter(Boolean);
  return people.length ? people.map(capitalize).join(", ") : null;
};

const parsePerson = (name) => {
  const words = nameWords(name);
  if (!words.length) return null;
  return {
    first: words[0].toLowerCase(),
    last: words.length > 1 ? words[words.length - 1].toLowerCase() : null
  };
};

// Builds a directory from every staff name in play and returns a resolver
// mapping any one raw name to a stable { key, display }. Callers pass ALL
// names up front (not just one event's) so collisions are detected globally
// and the same person resolves identically on every row.
export const buildStaffDirectory = (rawNames) => {
  const lastNamesByFirst = new Map();
  for (const raw of rawNames) {
    for (const p of splitPeople(raw).map(parsePerson).filter(Boolean)) {
      if (!lastNamesByFirst.has(p.first)) lastNamesByFirst.set(p.first, new Set());
      if (p.last) lastNamesByFirst.get(p.first).add(p.last);
    }
  }

  // A one-letter surname ("Chaitali P") is the initial of a full one
  // ("Chaitali Patil") when exactly one full surname starts with it; with two
  // or more candidates it can't be told apart, so it resolves to AMBIGUOUS.
  const AMBIGUOUS = "?";
  const canonicalLast = (first, last) => {
    const lasts = [...(lastNamesByFirst.get(first) || [])];
    if (last && last.length === 1) {
      const full = lasts.filter((l) => l.length > 1 && l.startsWith(last));
      if (full.length === 1) return full[0];
      if (full.length > 1) return AMBIGUOUS;
    }
    return last;
  };

  const peopleByFirst = new Map();
  for (const [first, lasts] of lastNamesByFirst) {
    const people = [...lasts].map((l) => canonicalLast(first, l)).filter((l) => l !== AMBIGUOUS);
    peopleByFirst.set(first, new Set(people));
  }

  const resolvePerson = (p) => {
    const people = [...(peopleByFirst.get(p.first) || [])];
    let last = p.last ? canonicalLast(p.first, p.last) : null;
    // Bare first name: attach to the only known person with that first name.
    if (!last && people.length === 1) last = people[0];
    if (last !== AMBIGUOUS && people.length <= 1) {
      return { key: `${p.first}|${last || ""}`, display: capitalize(p.first) };
    }
    if (!last || last === AMBIGUOUS) {
      // Several people share this first name and no surname was given —
      // don't guess which one; surface it as ambiguous instead.
      return { key: `${p.first}|?`, display: `${capitalize(p.first)} (?)`, ambiguous: true };
    }
    const initialClash = people.filter((l) => l && l[0] === last[0]).length > 1;
    const suffix = initialClash ? capitalize(last) : `${last[0].toUpperCase()}.`;
    return { key: `${p.first}|${last}`, display: `${capitalize(p.first)} ${suffix}` };
  };

  return (raw) => {
    const people = splitPeople(raw).map(parsePerson).filter(Boolean);
    if (!people.length) return null;
    const resolved = people.map(resolvePerson);
    return {
      key: resolved.map((r) => r.key).join("+"),
      display: resolved.map((r) => r.display).join(", "),
      ambiguous: resolved.some((r) => r.ambiguous)
    };
  };
};

const TEXT_FIELD_BY_ROLE = {
  INSTRUCTOR: "instructorName",
  ASSOCIATE_INSTRUCTOR: "associateInstructorName"
};

// Full raw name for a role on one event: an assigned account wins over the
// free-text name. `assignments` must be loaded with `user.name`.
export const rawStaffName = (event, role) => {
  const assignment = event.assignments?.find((a) => a.role === role);
  return assignment?.user?.name || event[TEXT_FIELD_BY_ROLE[role]] || null;
};

export const collectStaffNames = (events) =>
  events.flatMap((e) => [rawStaffName(e, "INSTRUCTOR"), rawStaffName(e, "ASSOCIATE_INSTRUCTOR")]).filter(Boolean);

// Directory over every non-archived event's facilitators — used by views that
// only load a subset of events but must resolve names the same way as the
// full analytics table.
export const loadStaffDirectory = async (prisma) => {
  const events = await prisma.event.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: {
      instructorName: true,
      associateInstructorName: true,
      assignments: {
        where: { role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } },
        select: { role: true, user: { select: { name: true } } }
      }
    }
  });
  return buildStaffDirectory(collectStaffNames(events));
};

// Normalizes a free-text name coming from a form/import: trimmed, blank -> null.
export const cleanStaffName = (name) => {
  if (typeof name !== "string") return name === null ? null : undefined;
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed || null;
};
