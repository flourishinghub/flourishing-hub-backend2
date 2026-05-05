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
import { authenticate } from "../middleware/auth.js";
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
eventRoutes.get("/", validate(listEventSchema), cacheResponse("events", 30), listEventsController);
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
