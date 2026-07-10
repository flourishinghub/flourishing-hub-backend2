# Google Form Quiz & Rating Setup Guide

## Overview

When a workshop's "Quiz Link" is a Google Form, the backend has no way of
knowing a student actually submitted it — until you attach a small script
to that Google Form that tells the backend when someone does. Once set up,
the admin Event page shows, per registered student:

- ✅ / ❌ whether they submitted the quiz, and their score (out of 5)
- ⭐ their session rating (out of 5), if they rated it

This is one Apps Script per Google Form — since one form = one specific
workshop, you attach it once when you create the form, then never touch it
again (submissions after that are automatic).

## What you need

- The event's ID (see step 3)
- The `QUIZ_WEBHOOK_SECRET` value from the backend's `.env`
- Your backend's live URL (e.g. `https://flourishing-hub-backend.onrender.com`)

## Setup Steps

### 1. Build the Google Form

Your form needs:
- **An "Email" question** (Short answer) — so the backend knows which
  student submitted. Recommended: make it required, and turn on
  Settings → Responses → "Restrict to users in [your organization]" so
  Google auto-fills it correctly instead of relying on students typing
  their own email.
- **(Optional) Quiz questions** — go to Settings → the "Quizzes" tab →
  turn on "Make this a quiz". Give each question a point value and mark
  the correct answer. The script converts whatever you scored it out of
  into a score out of 5 automatically — you don't need to make every quiz
  exactly 5 points.
- **(Optional) A rating question** — a "Linear scale" question, 1 to 5,
  titled something like "Overall Session Rating" (avoid the word "rating"
  colliding with an instructor-rating question — see the script's comments
  if you add both).

### 2. Attach the script

1. In the Google Form editor, click the **⋮** (three dots) menu → **Script editor**.
2. Delete whatever's in `Code.gs` and paste in the contents of
   [`scripts/google-form-webhook.gs`](./scripts/google-form-webhook.gs) from this repo.
3. At the top of the script, fill in:
   ```js
   const BACKEND_URL = 'https://your-actual-backend-url.onrender.com/api/v1';
   const WEBHOOK_SECRET = 'the QUIZ_WEBHOOK_SECRET value from .env';
   const EVENT_ID = 'the event ID — see step 3 below';
   ```

### 3. Find the Event ID

In the admin panel, go to **Events**, click into the specific workshop
this form belongs to. The URL looks like:

```
https://your-frontend.vercel.app/admin/events/cmXXXXXXXXXXXXXXXXXXXXXXX
```

Everything after `/admin/events/` is the Event ID — copy that into `EVENT_ID`.

### 4. Install the trigger

Back in the Apps Script editor:
1. In the function dropdown (top toolbar), select **`installFormSubmitTrigger`**.
2. Click **Run** (▶).
3. The first time, Google will ask you to authorize the script — click
   through (Advanced → Go to [project name] (unsafe) is expected for a
   script you wrote yourself; it's only "unsafe" in Google's eyes because
   it isn't published/verified).
4. Check **Executions** (left sidebar) to confirm it ran without errors.

You only need to do this once per form.

### 5. Test it

Submit a test response to your own form (with a real student email, or
your own if you have a test account). Then:
- In Apps Script, check **Executions** — you should see `onFormSubmitHandler`
  ran, and its logs should show a `postToBackend` result with `status: 200`.
- In the admin panel, open that event's page — the student should now show
  a quiz score and/or rating in the Registered Participants table.

If something's wrong, the Execution log will show the exact error —
common ones:
- **401 from the backend** → `WEBHOOK_SECRET` doesn't match `.env`'s `QUIZ_WEBHOOK_SECRET`.
- **404 "No user found with email..."** → the email question wasn't
  answered, or doesn't match a real account's email exactly.
- **404 "No event found with id..."** → `EVENT_ID` is wrong — re-check step 3.
- **410 "Submission window has closed"** → quiz submissions are only
  accepted until 30 minutes after the workshop's scheduled end time.
- Quiz score never shows up even though the form has quiz questions →
  confirm Settings → Quizzes → "Make this a quiz" is actually on for
  *this* form (it's a per-form setting).

## Where this data lives

- Quiz scores are stored per-student against the event's session
  (`ModuleProgress`, backend) and shown on the admin Event page's
  Registered Participants table ("Quiz" column).
- Ratings are stored in the same `Feedback` table the in-app star-rating
  widget writes to — a student can rate either through the app or through
  this form; whichever happens, the same "Rating" column picks it up.
- Students also see their own score directly on their event page (the
  quiz progress card), regardless of whether they got it via the app quiz
  flow or this Google Form path.
