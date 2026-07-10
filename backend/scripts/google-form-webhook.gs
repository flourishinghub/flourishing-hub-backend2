/**
 * Flourishing Hub — Google Form → Backend Webhook
 *
 * This is NOT a Node.js file — it does not run as part of this backend.
 * It's Google Apps Script (.gs), meant to be pasted into the Apps Script
 * editor attached to a Google Form. It's kept here in the repo just so
 * it's version-controlled and easy to find/copy — see
 * GOOGLE_FORM_QUIZ_SETUP.md in the repo root for full setup steps.
 *
 * What it does: whenever a student submits the Google Form, this script
 * runs automatically and sends the result to the backend, which is how
 * "did they submit the quiz, what score, what rating" gets recorded and
 * shown on the admin Event page. Without this script attached, the
 * backend has no way of knowing a Google Form was ever submitted.
 *
 * Handles TWO independent things, either or both may be present on the
 * same form:
 *   1. A Google Forms "Quiz" (Settings → Make this a quiz) → posts the
 *      score to POST /quiz/submit
 *   2. A rating question (Linear scale, 1–5) → posts it to POST /quiz/feedback
 */

// ─── These two are the same for every workshop — already filled in, no
// need to touch them. If you ever redeploy the backend to a new URL or
// rotate QUIZ_WEBHOOK_SECRET in .env, update them here once. ───
const BACKEND_URL = 'https://flourishing-hub-backend2-xif0.onrender.com/api/v1';
const WEBHOOK_SECRET = 'fh-quiz-secret-2026-iitbfh';

// ─── Fill in EXACTLY ONE of these two setups — whichever matches this
// workshop. Leave the other one's fields blank ('').
//
// SETUP 1 — single or optional workshop (just one Event, not scheduled
// per-batch). Use EVENT_ID.
//
// SETUP 2 — compulsory course bundle bulk-imported across MULTIPLE
// batches (e.g. "Module 1" run 4 times, once per batch — 4 separate
// Events, same title). Use COMPULSORY_COURSE_ID + WORKSHOP_TITLE instead
// — ONE Google Form then works for every batch: the backend figures out
// which specific batch-Event a submission belongs to from which one the
// submitting student is actually registered for. You do NOT need a
// separate form per batch.
// ───

// SETUP 1
const EVENT_ID = ''; // from admin panel: Events → click the workshop → .../admin/events/<EVENT_ID>

// SETUP 2
const COMPULSORY_COURSE_ID = ''; // from admin panel: Courses → click the course → .../admin (check the course's id in its edit/API response, or ask an admin who set it up)
const WORKSHOP_TITLE = ''; // must exactly match the Event title used across all of that course's batches, e.g. "Module 1"

// Question title must CONTAIN one of these (case-insensitive) to be
// recognised as the student's email — edit if your form uses different wording.
const EMAIL_TITLE_KEYWORDS = ['email', 'e-mail'];

// Same idea for the rating question — a Linear Scale (1-5) question.
// NOTE: "instructor rating" contains "rating", so if your form has both an
// overall rating question and an instructor rating question, word them so
// they don't overlap (e.g. "Overall Session Rating" vs "Instructor Rating")
// — findAnswerByTitleKeywords returns the FIRST question matching any
// keyword, in form order.
const RATING_TITLE_KEYWORDS = ['session rating', 'how was this session', 'rate this session', 'overall'];
const INSTRUCTOR_RATING_TITLE_KEYWORDS = ['instructor rating', 'rate the instructor', 'facilitator rating'];

/**
 * Run this once manually from the Apps Script editor (select
 * `installFormSubmitTrigger` in the function dropdown, click Run) to wire
 * up the trigger. You only need to do this once per form — after that, it
 * fires automatically on every submission. See the setup guide for why an
 * installable trigger (not a simple `onFormSubmit(e)`) is required here:
 * UrlFetchApp needs authorization that simple triggers don't have.
 */
function installFormSubmitTrigger() {
  const form = FormApp.getActiveForm();
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'onFormSubmitHandler') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmitHandler')
    .forForm(form)
    .onFormSubmit()
    .create();
  Logger.log('Trigger installed on form: ' + form.getTitle());
}

// Returns { eventId } for Setup 1, or { courseId, eventTitle } for Setup 2,
// or null if neither is configured.
function getWorkshopIdentifier() {
  if (EVENT_ID) return { eventId: EVENT_ID };
  if (COMPULSORY_COURSE_ID && WORKSHOP_TITLE) return { courseId: COMPULSORY_COURSE_ID, eventTitle: WORKSHOP_TITLE };
  return null;
}

function onFormSubmitHandler(e) {
  try {
    const identifier = getWorkshopIdentifier();
    if (!identifier) {
      Logger.log('Neither EVENT_ID nor COMPULSORY_COURSE_ID+WORKSHOP_TITLE is set — this form was probably ' +
        'just copied from the master template. Open Extensions/Script editor, fill in ONE of the two setups ' +
        'at the top of the script, then run installFormSubmitTrigger once more.');
      return;
    }

    const formResponse = e.response;
    const itemResponses = formResponse.getItemResponses();

    const email = findAnswerByTitleKeywords(itemResponses, EMAIL_TITLE_KEYWORDS);
    if (!email) {
      Logger.log('No email question found/answered — skipping submission. Check EMAIL_TITLE_KEYWORDS.');
      return;
    }

    const results = [];

    // ── 1. Quiz score (only if this form has grading enabled) ──
    const form = FormApp.getActiveForm();
    if (form.isQuiz()) {
      let totalScore = 0;
      let maxScore = 0;
      itemResponses.forEach((itemResponse) => {
        try {
          const item = itemResponse.getItem();
          const points = item.getPoints(); // only gradable item types (multiple choice, checkbox, etc.) support this
          const grade = itemResponse.getScore(); // awarded score, or null if ungraded
          maxScore += points;
          if (grade !== null) totalScore += grade;
        } catch (err) {
          // Not every item type is gradable (e.g. section headers, plain text) — skip those.
        }
      });

      if (maxScore > 0) {
        const scoreOutOf5 = Math.round((totalScore / maxScore) * 5);
        results.push(postToBackend('/quiz/submit', Object.assign({
          email: email,
          score: scoreOutOf5,
          secret: WEBHOOK_SECRET,
        }, identifier)));
      }
    }

    // ── 2. Rating / feedback ──
    const eventRating = findAnswerByTitleKeywords(itemResponses, RATING_TITLE_KEYWORDS);
    if (eventRating) {
      const instructorRating = findAnswerByTitleKeywords(itemResponses, INSTRUCTOR_RATING_TITLE_KEYWORDS);
      const feedbackPayload = Object.assign({
        email: email,
        eventRating: Number(eventRating),
        secret: WEBHOOK_SECRET,
      }, identifier);
      if (instructorRating) feedbackPayload.instructorRating = Number(instructorRating);
      results.push(postToBackend('/quiz/feedback', feedbackPayload));
    }

    Logger.log('Submitted for ' + email + ': ' + JSON.stringify(results));
  } catch (err) {
    Logger.log('ERROR in onFormSubmitHandler: ' + err.message);
  }
}

function findAnswerByTitleKeywords(itemResponses, keywords) {
  for (const itemResponse of itemResponses) {
    const title = itemResponse.getItem().getTitle().toLowerCase();
    if (keywords.some((k) => title.includes(k))) {
      return itemResponse.getResponse();
    }
  }
  return null;
}

function postToBackend(path, payload) {
  const response = UrlFetchApp.fetch(BACKEND_URL + path, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status >= 400) {
    Logger.log('Backend call to ' + path + ' failed (' + status + '): ' + body);
  }
  return { path: path, status: status, body: body };
}
