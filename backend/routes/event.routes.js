import { Router } from "express";

import {
  createTemplateController,
  listTemplatesController
} from "../controllers/event-template.controller.js";
import {
  bulkCreateEventsController,
  createEventController,
  deleteEventController,
  exportEventDataController,
  getEventController,
  getEventRecordController,
  listEventsController,
  updateEventController,
  expressVolunteerInterestController,
  withdrawVolunteerInterestController,
  getEventVolunteersController,
  assignVolunteerController,
  unassignVolunteerController
} from "../controllers/event.controller.js";
import { authenticate, authenticateOptional } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { cacheResponse } from "../middleware/cacheResponse.js";
import { validate } from "../middleware/validate.js";
import { createTemplateSchema } from "../validators/event-template.validation.js";
import {
  bulkCreateEventSchema,
  createEventSchema,
  listEventSchema,
  updateEventSchema
} from "../validators/event.validation.js";

export const eventRoutes = Router();

eventRoutes.get("/templates", listTemplatesController);
eventRoutes.post(
  "/templates",
  authenticate,
  authorize("ADMIN"),
  validate(createTemplateSchema),
  createTemplateController
);
eventRoutes.post(
  "/bulk",
  authenticate,
  authorize("ADMIN"),
  validate(bulkCreateEventSchema),
  bulkCreateEventsController
);
// Heaviest query in the app (full include tree + count) and hit by every
// dashboard mount AND every individual event-page open — was uncached
// despite cacheResponse already being imported above. 20s TTL: not polled
// on a schedule, so this mainly absorbs a student's own repeat hits
// (dashboard -> event detail within the window, retries, duplicate fires)
// rather than deduping across different students, since the cache key is
// per-user (student-scoped visibility rules make the response genuinely
// user-specific, not just query-specific).
eventRoutes.get("/", authenticateOptional, validate(listEventSchema), cacheResponse("events", 20), listEventsController);
eventRoutes.get("/:eventId/record", authenticate, authorize("ADMIN"), getEventRecordController);
eventRoutes.get("/:eventId/export", authenticate, authorize("ADMIN"), exportEventDataController);
eventRoutes.get("/:eventId/volunteers", authenticate, authorize("ADMIN"), getEventVolunteersController);
eventRoutes.post("/:eventId/volunteers/:userId/assign", authenticate, authorize("ADMIN"), assignVolunteerController);
eventRoutes.delete("/:eventId/volunteers/:userId/unassign", authenticate, authorize("ADMIN"), unassignVolunteerController);
eventRoutes.get("/:eventId", getEventController);
eventRoutes.post("/:eventId/volunteer", authenticate, expressVolunteerInterestController);
eventRoutes.delete("/:eventId/volunteer/withdraw", authenticate, withdrawVolunteerInterestController);
eventRoutes.post("/", authenticate, authorize("ADMIN"), validate(createEventSchema), createEventController);
eventRoutes.patch(
  "/:eventId",
  authenticate,
  authorize("ADMIN"),
  validate(updateEventSchema),
  updateEventController
);
eventRoutes.delete("/:eventId", authenticate, authorize("ADMIN"), deleteEventController);
