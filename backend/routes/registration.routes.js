import { Router } from "express";

import {
  myRegistrationsController,
  registerForEventController
} from "../controllers/registration.controller.js";
import { authenticate } from "../middleware/auth.js";
import { cacheResponse } from "../middleware/cacheResponse.js";
import { validate } from "../middleware/validate.js";
import { registerForEventSchema } from "../validators/registration.validation.js";

export const registrationRoutes = Router();

registrationRoutes.use(authenticate);
// Hit on every dashboard mount and every event-page open — was uncached.
registrationRoutes.get("/me", cacheResponse("my-registrations", 15), myRegistrationsController);
registrationRoutes.post("/", validate(registerForEventSchema), registerForEventController);




