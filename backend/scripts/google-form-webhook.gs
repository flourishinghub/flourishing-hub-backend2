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

// ─── This is the ONE line you change every time you copy this form for a
// new workshop. Get it from the admin panel: Events → click the workshop
// → the URL is .../admin/events/<EVENT_ID>. ───
const EVENT_ID = 'PASTE_THE_EVENT_ID_HERE';

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

function onFormSubmitHandler(e) {
  try {
    if (!EVENT_ID || EVENT_ID === 'PASTE_THE_EVENT_ID_HERE') {
      Logger.log('EVENT_ID is not set — this form was probably just copied from the master template. ' +
        'Open Extensions/Script editor, set EVENT_ID at the top of the script to this workshop\'s event ID, ' +
        'then run installFormSubmitTrigger once more.');
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
        results.push(postToBackend('/quiz/submit', {
          email: email,
          eventId: EVENT_ID,
          score: scoreOutOf5,
          secret: WEBHOOK_SECRET,
        }));
      }
    }

    // ── 2. Rating / feedback ──
    const eventRating = findAnswerByTitleKeywords(itemResponses, RATING_TITLE_KEYWORDS);
    if (eventRating) {
      const instructorRating = findAnswerByTitleKeywords(itemResponses, INSTRUCTOR_RATING_TITLE_KEYWORDS);
      const feedbackPayload = {
        email: email,
        eventId: EVENT_ID,
        eventRating: Number(eventRating),
        secret: WEBHOOK_SECRET,
      };
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
