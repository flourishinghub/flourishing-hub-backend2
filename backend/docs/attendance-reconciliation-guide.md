# Physical Attendance Sheet Reconciliation — Guide

How to take a batch's physical sign-in sheet photos + mam's CSV upload and end up with a
verified, duplicate-free attendance record in the system. Written after reconciling the
D1 batch ("1. Substance Use Awareness", 11 Aug 2026) end-to-end, including every mistake
made along the way — follow this to skip repeating them.

## The core lesson

**Never trust "the roll number I read exists in the CSV" as proof the reading is correct.**
A misread roll (one digit off) will often *still* land on a real CSV row — just the wrong
student's. The only real check is: does the **name** on the sheet also match the CSV name
for that roll? Roll-only matching missed multiple real errors in the D1 pass that name
cross-checking caught immediately.

## Step 0 — Pull the reference data once, up front

Before reading a single photo, export the full CSV roster for that batch + course module:

```js
const event = await prisma.event.findFirst({
  where: { title: { contains: "<workshop title>", mode: "insensitive" }, batch: { equals: "<BATCH>", mode: "insensitive" } },
  select: { courseModuleId: true }
});
const csvRows = await prisma.batchAssignment.findMany({
  where: { batchCode: { equals: "<BATCH>", mode: "insensitive" }, courseModuleId: event.courseModuleId },
  select: { rollNumber: true, name: true },
  orderBy: { rollNumber: "asc" }
});
```

Keep this roll→name list visible while reading every photo. Don't read all the photos
first and cross-check later — cross-check **each row as you read it**, so a suspicious
reading gets a second look at the source image while it's still open.

## Step 1 — Read each photo row by row

For every row: roll number, name, and note whether the signature looks genuinely present
(a squiggle, initials, full name — anything) vs. truly blank.

Also note, per page:
- The header's handwritten "Total no. of Students Present" count.
- Your own count of filled/signed rows.
- Any crossed-out rows, star (★) marks, or other annotations — **ask the user what they
  mean rather than assuming**. In the D1 sheets, star + strikethrough turned out to still
  mean present (the instructor's own de-dup marks on duplicate signatures), not void —
  guessing wrong here was a real mistake corrected mid-session.
- If the header count doesn't match your row count, look for a continuation/backside page
  before assuming it's an instructor error. In D1, a "48 present" header on a 40-row page
  turned out to be exactly right — 8 more rows were on a separate backside photo.

## Step 2 — Cross-check roll + name against the CSV immediately

For each row, look up the roll in your CSV export:
- **Roll exists, name matches** → clean, move on.
- **Roll exists, name does NOT match** → you misread the roll. Search the CSV by name
  instead to find the real roll (or re-look at the image). This is the case that plain
  roll-existence checks silently miss.
- **Roll doesn't exist anywhere close** → either a genuine misread (try closest-match by
  edit distance against the full roll list) or a real no-CSV signer (see Step 4).

**Name matching must tolerate reordering and missing middle names** — Indian names on
these sheets are frequently written in a different order than the CSV's official name, or
with only first+last (no middle name), or with pet-name spellings. A naive
character-overlap or Levenshtein-on-the-whole-string score will flag dozens of correct
matches as "mismatches" (e.g. "Ram Charan" vs CSV's "Ramcharan Vankudoth", "Vadigepally
Vijay Kumar" vs CSV's "Vijay Kumar Vadigepally"). Use **shared-word-count** similarity
instead:

```js
const wordSim = (a, b) => {
  const wa = new Set((a||"").toLowerCase().split(/\s+/).map(w=>w.replace(/[^a-z]/g,"")).filter(Boolean));
  const wb = new Set((b||"").toLowerCase().split(/\s+/).map(w=>w.replace(/[^a-z]/g,"")).filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  wa.forEach(w => { if (wb.has(w)) shared++; });
  return shared / Math.min(wa.size, wb.size);
};
```

Treat anything below ~0.34 as a real mismatch worth investigating; above that, it's almost
always the same person.

## Step 3 — Mark attendance for matched, real-account students

For a present student who already has an account:

```js
await prisma.attendanceRecord.upsert-or-update({
  eventId, userId, moduleId: null,
  data: { status: "PRESENT", source: `SHEET_RECONCILIATION: signed <sheet description> (<date>)`, markedAt: new Date() }
});
await prisma.eventRegistration.update({
  where: { eventId_userId: { eventId, userId } },
  data: { status: "ATTENDED", checkedInAt: new Date() }
});
```

**Always write a descriptive `source` string**, not a generic tag — every past
reconciliation that did this made the later "which column does this belong to" analytics
work (Physical Sheet Status column) trivial, because the source string itself says which
photo/page it came from. A generic tag like `"admin-analytics"` loses that.

If marking someone from the **physical sheet specifically** (not an online check-in
verification), the source must start with `SHEET_RECONCILIATION` or `PHYSICAL_SHEET` —
the analytics code (`isPhysicalSheetSource` in `admin.service.js`) matches on that prefix
to populate the Physical Sheet Status column.

## Step 4 — No-account signers → PendingAttendance, not a guess

A student who signed the sheet but has no account yet gets a `PendingAttendance` row
(status PRESENT/ABSENT, matched later automatically when they sign up — see
`autoAssignCohortOnSignup` in `batchAssignment.service.js`). Don't invent a fake user.

## Step 5 — The `isMatched` ghost-duplicate sweep (do this every time)

This is the bug that cost the most rework in the D1 pass — twice. A `BatchAssignment` CSV
row stays `isMatched: false` forever unless something explicitly re-checks it. The app's
own signup flow (`autoAssignCohortOnSignup`) sets it correctly when a student signs up
normally — **that code path has no bug**. The gap is specifically when an account gets
created or attendance gets linked through a **manual/ad-hoc reconciliation script**
(exactly what this whole guide describes) — those scripts wrote the `AttendanceRecord`
but never touched the CSV row's `isMatched` flag, leaving a stale `isMatched: false` ghost
that the analytics query still counts as a separate "never showed up" student — even
though the real, matched account is already sitting there marked Present.

**Fix**: after finishing manual reconciliation for a batch, always run this sweep —
exact roll match, not fuzzy name match (fuzzy matching missed 12 real cases in D1 that
this exact-match sweep caught):

```js
const unmatched = await prisma.batchAssignment.findMany({
  where: { batchCode: "<BATCH>", courseModuleId, isMatched: false },
  select: { id: true, rollNumber: true, name: true }
});

for (const u of unmatched) {
  if (!u.rollNumber) continue;
  const sp = await prisma.studentProfile.findFirst({
    where: { rollNumber: { equals: u.rollNumber, mode: "insensitive" } },
    include: { user: { select: { id: true } } }
  });
  if (!sp) continue; // genuinely no account — leave unmatched
  await prisma.batchAssignment.update({
    where: { id: u.id },
    data: { isMatched: true, matchedUserId: sp.user.id }
  });
}
```

Run this **both right after reconciling a batch, and again any time someone reports the
Present/Absent counts "look too high/wrong"** — that symptom is exactly this bug.

This is a known systemic issue beyond just D1 — a project memory note from earlier
flagged roughly 534 unique unmatched rolls system-wide as of 2026-08-24. Worth running
this sweep across every batch, not just the one currently being reconciled.

## Step 6 — Recompute and sanity-check the final numbers

```js
const rows = await getWorkshopAnalyticsTable();
const event = rows.find(r => r.batch === "<BATCH>" && r.workshopName?.includes("<workshop>"));
const counts = {};
for (const s of event.students) {
  const final = s.attendanceStatus === 'NOT_MARKED' ? (s.hasCheckedIn ? 'PENDING_VERIFICATION' : 'ABSENT') : s.attendanceStatus;
  counts[final] = (counts[final] || 0) + 1;
}
```

Sanity checks before calling it done:
- `Present + Absent` total should be close to the CSV row count (small gaps are fine —
  cross-batch signers with no CSV row, no-account signers, etc. — but a large gap means
  something's still wrong).
- Re-run the Step 5 sweep one more time after any manual fixes — fixing one ghost can
  occasionally surface adjacent ones you hadn't checked yet.
- Spot-check a handful of both Present *and* Absent students against the CSV — checking
  only one side is how the 12-record `isMatched` gap in D1 stayed hidden for a full round
  of "everything's verified" reporting. The Absent list needs the same roll+name+email
  scrutiny as the Present list, not less.

## Known edge cases seen in D1 (watch for these elsewhere)

- **Same student, two different rolls on two different pages** (self-check-in roll vs.
  physical-sheet roll, or a genuine typo on one page) — resolve by checking whether a real
  account already exists under one of the two rolls with a matching name; that one wins.
- **Same roll reused by two different names across pages** — a clear misread on one of
  the two; whichever name matches the CSV's name for that roll is correct, the other
  row's true roll needs to be found by searching the CSV by name instead.
- **A student's own account has a typo'd roll number** (e.g. profile roll `23B2234` when
  every other source — CSV, physical sheet, and their own `@iitb.ac.in` email — says
  `26B2234`) — this is a `StudentProfile.rollNumber` data-entry error, not a reconciliation
  error. Fix the profile field directly once confirmed.
- **Duplicate signature by the same person across two pages/rolls** (e.g. signed once
  correctly, once again elsewhere under a misread roll with no matching account) — don't
  double-count; the second appearance should resolve to "no real account" and get deleted
  or ignored rather than treated as a second present student.
