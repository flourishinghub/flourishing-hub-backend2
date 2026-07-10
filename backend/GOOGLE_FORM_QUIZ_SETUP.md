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
one line → done** — no code-writing per workshop.

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
   alone. Leave `EVENT_ID` as the placeholder (`'PASTE_THE_EVENT_ID_HERE'`)
   for now — this is the master template, it isn't tied to a real
   workshop yet.
4. Rename the Apps Script project (top left, "Untitled project") to
   something like **"FH Quiz Webhook"**.
5. Rename the form itself to **"FH Quiz Template — DO NOT EDIT, COPY ME"**
   so nobody accidentally uses the master form for a real workshop.

Master template is done. You will never touch this form's responses or
send this exact form to students.

## Part B — For every new workshop

### 1. Duplicate the template

In Google Drive, find the master form → right-click → **Make a copy**.
Rename the copy to the actual workshop name (e.g. "Leadership — Session 3 Quiz").
The Apps Script (with `BACKEND_URL`/`WEBHOOK_SECRET` already filled in)
comes along automatically with the copy.

### 2. Edit the quiz questions for this workshop

Update the quiz questions/answers to match this specific session. Leave
the Email question and the "Overall Session Rating" question as they are.

### 3. Get this workshop's Event ID

In the admin panel: **Events** → click into this specific workshop. The
URL looks like:
```
https://your-frontend.vercel.app/admin/events/cmXXXXXXXXXXXXXXXXXXXXXXX
```
Copy everything after `/admin/events/`.

(If the workshop doesn't exist in the admin panel yet, create it first —
you need the Event ID before this step.)

### 4. Set the Event ID and install the trigger

In the **copied** form → **⋮** → **Script editor**:
1. Change the `EVENT_ID` line near the top to the ID from step 3.
2. In the function dropdown (toolbar), select **`installFormSubmitTrigger`** → click **Run** (▶).
   - First time ever doing this in your Google account, it'll ask you to
     authorize — click through (Advanced → Go to [project] (unsafe) is
     expected for a script you own).
3. Check **Executions** (left sidebar) — should show it ran with no errors.

### 5. Link the form to the workshop

Copy this form's **Send** link (the one students fill out, not the
Script editor URL) into the workshop's **Quiz Link** field in the admin
panel (Edit Event, or Course Module).

That's it — every future workshop repeats only Part B (2–3 minutes), no
code editing beyond the one `EVENT_ID` line.

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
| Log says "EVENT_ID is not set" | You forgot step 4.1 after copying |
| 401 from backend | `WEBHOOK_SECRET` doesn't match `.env`'s `QUIZ_WEBHOOK_SECRET` (only possible if one of them was changed after this template was written) |
| 404 "No user found with email..." | Email question wasn't answered, or doesn't match a real account's email exactly |
| 404 "No event found with id..." | Wrong `EVENT_ID` — re-check step 3 |
| 410 "Submission window has closed" | Quiz submissions are only accepted until 30 minutes after the workshop's scheduled end time |
| Quiz score never appears despite quiz questions | Settings → Quizzes → "Make this a quiz" is off for *this specific copy* — it's per-form, doesn't carry a default |

## Where this data lives

- Quiz scores: stored per-student against the event's session
  (`ModuleProgress`), shown on the admin Event page's Registered
  Participants table ("Quiz" column).
- Ratings: stored in the same `Feedback` table the in-app star-rating
  widget writes to — whichever path a student rates through, the same
  "Rating" column picks it up.
- Students see their own score on their own event page too, regardless
  of whether it came via the in-app quiz flow or this Google Form path.
