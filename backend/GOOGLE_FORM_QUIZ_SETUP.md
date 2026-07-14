# Google Form Quiz & Rating Setup Guide

## Overview

When a workshop's "Quiz Link" is a Google Form, the backend has no way of
knowing a student actually submitted it — until a small script attached
to that form tells it. Once set up, the admin Event page shows, per
registered student:

- ✅ / ❌ whether they submitted the quiz, and their score (out of 5)
- ⭐ their session rating (out of 5), if they rated it

**You only do the full setup ONCE** (building a master template form).
After that, every new workshop is just: **duplicate the master → paste
its Send link into the workshop's Quiz Link field → done** — no code
editing per workshop, for either a single one-off event or a compulsory
course bundled across multiple batches.

## How it finds the right workshop — no per-copy configuration

Every copy of the script is byte-for-byte identical — nothing to fill in.
When a student submits, the script sends the form's own "Send" link to
the backend, which looks up whichever Event(s) have that exact link
pasted into their **Quiz Link** field (set from the admin panel), then
narrows to the one *this specific student* is actually registered for.

That single mechanism covers both cases:
- **Single/optional workshop** — one Event has that Quiz Link, no ambiguity.
- **Compulsory course, multiple batches** (e.g. "Module 1" bulk-imported
  once per batch — several separate Events, same title) — paste the
  *same* Send link into every batch's Quiz Link field. Since a student
  only ever belongs to one batch, the registration lookup picks the
  right Event automatically. **Just ONE Google Form total**, no need to
  make a separate form per batch.

There's a manual `EVENT_ID` override in the script for edge cases (e.g.
testing before a Quiz Link is saved anywhere), but you shouldn't need it
for normal use.

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
   alone. Leave `EVENT_ID` blank too — this is the master template, and
   every copy of it auto-detects its own workshop, no editing needed.
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

### 3. Install the trigger

In the **copied** form → **⋮** → **Script editor** (the script itself
needs zero edits):
1. In the function dropdown (toolbar), select **`installFormSubmitTrigger`** → click **Run** (▶).
   - First time ever doing this in your Google account, it'll ask you to
     authorize — click through (Advanced → Go to [project] (unsafe) is
     expected for a script you own).
2. Check **Executions** (left sidebar) — should show it ran with no errors.

### 4. Link the form to the workshop

Copy this form's **Send** link — use the long
`https://docs.google.com/forms/d/e/.../viewform` link, **not** a
shortened `forms.gle` link (shortening it breaks the auto-match, since
the backend matches on the long link's own ID). Paste it into the
workshop's **Quiz Link** field in the admin panel (Edit Event, or Course
Module). For a compulsory course bundled across multiple batches, paste
the *same* Send link into **every batch's** event — it's the same form
for all of them, and the backend tells them apart by which batch the
submitting student is registered in.

That's it — every future workshop repeats only Part B (a couple of
minutes), no code editing at all.

## Testing

Submit a real test response (your own account works). Then:
- Script editor → **Executions** → should show `onFormSubmitHandler` ran
  with a `postToBackend` result at `status: 200`.
- Admin panel → that event's page → your test account should now show a
  quiz score and/or rating in Registered Participants.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Nothing happens, no execution logged | Trigger wasn't installed — redo step 3 |
| 401 from backend | `WEBHOOK_SECRET` doesn't match `.env`'s `QUIZ_WEBHOOK_SECRET` (only possible if one of them was changed after this template was written) |
| 404 "No user found with email..." | Email question wasn't answered, or doesn't match a real account's email exactly |
| 404 "No workshop found whose Quiz Link matches this form..." | The Send link pasted into the event's Quiz Link field doesn't match this form (wrong link, a shortened `forms.gle` link was used instead of the long one, or it wasn't saved yet), or the student isn't actually registered for any event carrying that link |
| 410 "Submission window has closed" | Quiz submissions are only accepted until 5 minutes after the workshop's scheduled end time |
| Quiz score never appears despite quiz questions | Settings → Quizzes → "Make this a quiz" is off for *this specific copy* — it's per-form, doesn't carry a default |

## Where this data lives

- Quiz scores: stored per-student against the specific batch-event's
  session (`ModuleProgress`), shown on that event's admin page in the
  Registered Participants table ("Quiz" column) — for a compulsory
  course shared across batches, each batch's own event page shows only
  its own students' scores.
- Ratings: stored in the same `Feedback` table the in-app star-rating
  widget writes to — whichever path a student rates through, the same
  "Rating" column picks it up.
- Students see their own score on their own event page too, regardless
  of whether it came via the in-app quiz flow or this Google Form path.
