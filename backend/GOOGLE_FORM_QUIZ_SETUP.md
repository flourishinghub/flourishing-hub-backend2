# Google Form Quiz & Rating Setup Guide

## Overview

When a workshop's "Quiz Link" is a Google Form, the backend has no way of
knowing a student actually submitted it — until a small script attached
to that form tells it. Once set up, the admin Event page shows, per
registered student:

- ✅ / ❌ whether they submitted the quiz, and their score (out of 5)
- ⭐ their session rating (out of 5), if they rated it

**You only do the full setup ONCE** (building a master template form).
After that, every new workshop is just: **duplicate the master → change
one/two lines → done** — no code-writing per workshop.

## Two setups — which one do you need?

| | Setup 1 — Single workshop | Setup 2 — Compulsory course, multiple batches |
|---|---|---|
| When | Optional workshop, or any one-off event | Compulsory bundle course, bulk-imported so the SAME workshop (e.g. "Module 1") runs once per batch — several separate Events, same title |
| Google Forms needed | One form per event | **Just ONE form total** — shared across every batch |
| What you configure per copy | `EVENT_ID` | `COMPULSORY_COURSE_ID` + `WORKSHOP_TITLE` |
| How it finds the right student | N/A — one event, no ambiguity | Backend finds whichever batch-Event *this specific student* is registered for, automatically |

If you're not sure which applies: if you bulk-imported this workshop
across multiple batches (Batch 1, Batch 2, ...), use **Setup 2** — it
saves you from making 4+ separate Google Forms for the same quiz.

## Part A — Build the master template (one time only)

### 1. Create the form

Make a new Google Form with:
- **"Email" question** (Short answer, required). Recommended: Settings →
  Responses → turn on "Restrict to users in [your organization]" so
  Google auto-fills it instead of relying on students typing it correctly.
- **Quiz questions** — placeholder ones are fine, you'll edit the actual
  questions per workshop later. Go to Settings → **Quizzes** tab → turn on
  **"Make this a quiz"**, and give each question a point value + correct
  answer. Whatever total you grade it out of gets auto-converted to a
  score out of 5 — you don't need to make it exactly 5 points.
- **A rating question** — "Linear scale", 1 to 5, titled **"Overall
  Session Rating"** (this exact wording matters — see the script's
  `RATING_TITLE_KEYWORDS` comment if you want to change it).

### 2. Attach the script

1. In the form editor, click **⋮** (top right) → **Script editor**.
2. Delete whatever's in `Code.gs`, paste in the full contents of
   [`scripts/google-form-webhook.gs`](./scripts/google-form-webhook.gs).
3. `BACKEND_URL` and `WEBHOOK_SECRET` are already filled in — leave them
   alone. Leave `EVENT_ID` / `COMPULSORY_COURSE_ID` / `WORKSHOP_TITLE` as
   blank placeholders for now — this is the master template, it isn't
   tied to a real workshop yet.
4. Rename the Apps Script project (top left, "Untitled project") to
   something like **"FH Quiz Webhook"**.
5. Rename the form itself to **"FH Quiz Template — DO NOT EDIT, COPY ME"**
   so nobody accidentally uses the master form for a real workshop.

Master template is done. You will never touch this form's responses or
send this exact form to students.

## Part B — For every new workshop

### 1. Duplicate the template

In Google Drive, find the master form → right-click → **Make a copy**.
Rename the copy to the actual workshop name (e.g. "Leadership — Module 1 Quiz").
The Apps Script (with `BACKEND_URL`/`WEBHOOK_SECRET` already filled in)
comes along automatically with the copy.

### 2. Edit the quiz questions for this workshop

Update the quiz questions/answers to match this specific workshop's
content. Leave the Email question and the "Overall Session Rating"
question as they are.

### 3. Get the ID(s) you need

**Setup 1 (single workshop):** Admin panel → **Events** → click into the
workshop. The URL is `.../admin/events/<EVENT_ID>` — copy everything
after `/admin/events/`.

**Setup 2 (compulsory, multi-batch course):** Admin panel → **Courses**
tab → find the course → click the small **"Course ID"** button next to
it (only shown for Compulsory courses) — copies the ID straight to your
clipboard. Also note the exact **workshop title** as it appears across
all the batch events (e.g. "Module 1") — it must match exactly
(case-insensitive is fine, extra spaces are not).

### 4. Configure the script and install the trigger

In the **copied** form → **⋮** → **Script editor**:
1. Fill in **either** `EVENT_ID` (Setup 1) **or** `COMPULSORY_COURSE_ID`
   + `WORKSHOP_TITLE` (Setup 2) — leave the other setup's fields blank.
2. In the function dropdown (toolbar), select **`installFormSubmitTrigger`** → click **Run** (▶).
   - First time ever doing this in your Google account, it'll ask you to
     authorize — click through (Advanced → Go to [project] (unsafe) is
     expected for a script you own).
3. Check **Executions** (left sidebar) — should show it ran with no errors.

### 5. Link the form to the workshop

Copy this form's **Send** link (the one students fill out, not the
Script editor URL) into the workshop's **Quiz Link** field in the admin
panel (Edit Event, or Course Module). For Setup 2, put the same link on
**every batch's** event — it's the same form for all of them.

That's it — every future workshop repeats only Part B (a few minutes),
no code editing beyond one or two lines.

## Testing

Submit a real test response (your own account works). Then:
- Script editor → **Executions** → should show `onFormSubmitHandler` ran
  with a `postToBackend` result at `status: 200`.
- Admin panel → that event's page → your test account should now show a
  quiz score and/or rating in Registered Participants.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Nothing happens, no execution logged | Trigger wasn't installed — redo step 4.2 |
| Log says neither setup is configured | You forgot step 4.1 after copying |
| 401 from backend | `WEBHOOK_SECRET` doesn't match `.env`'s `QUIZ_WEBHOOK_SECRET` (only possible if one of them was changed after this template was written) |
| 404 "No user found with email..." | Email question wasn't answered, or doesn't match a real account's email exactly |
| 404 "No event found with id..." (Setup 1) | Wrong `EVENT_ID` — re-check step 3 |
| 404 "Could not find a workshop under this course..." (Setup 2) | Wrong `COMPULSORY_COURSE_ID`, `WORKSHOP_TITLE` doesn't exactly match the Event title, or the student isn't actually registered for any of that course's batch events |
| 410 "Submission window has closed" | Quiz submissions are only accepted until 5 minutes after the workshop's scheduled end time |
| Quiz score never appears despite quiz questions | Settings → Quizzes → "Make this a quiz" is off for *this specific copy* — it's per-form, doesn't carry a default |

## Where this data lives

- Quiz scores: stored per-student against the specific batch-event's
  session (`ModuleProgress`), shown on that event's admin page in the
  Registered Participants table ("Quiz" column) — for Setup 2, each
  batch's own event page shows only its own students' scores.
- Ratings: stored in the same `Feedback` table the in-app star-rating
  widget writes to — whichever path a student rates through, the same
  "Rating" column picks it up.
- Students see their own score on their own event page too, regardless
  of whether it came via the in-app quiz flow or this Google Form path.
