import { StatusCodes } from "http-status-codes";

import { listMyRegistrations, registerForEvent } from "../services/registration.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { cache } from "../utils/cache.js";

export const registerForEventController = asyncHandler(async (req, res) => {
  const data = await registerForEvent(req.validated.body, req.user);
  // GET /registrations/me is now cached (routes/registration.routes.js) —
  // the frontend re-fetches it right after this call to confirm the new
  // registration, which would otherwise hit a stale pre-registration cache
  // entry for up to the cache's TTL.
  cache.delete(`my-registrations:${req.user.id}:/api/v1/registrations/me`);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Registered for event successfully",
    data
  });
});

export const myRegistrationsController = asyncHandler(async (req, res) => {
  const data = await listMyRegistrations(req.user.id);
  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});



