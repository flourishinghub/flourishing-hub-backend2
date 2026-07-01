import { Router } from "express";

import {
  createImportJobController,
  downloadImportTemplateController,
  listImportJobsController,
  uploadImportController,
  previewImportController
} from "../controllers/import.controller.js";
import { authenticate } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { spreadsheetUpload } from "../middleware/upload.js";
import { validate } from "../middleware/validate.js";
import {
  createImportJobSchema,
  downloadImportTemplateSchema
} from "../validators/import.validation.js";

export const importRoutes = Router();

importRoutes.use(authenticate, authorize("ADMIN"));
importRoutes.get("/", listImportJobsController);
importRoutes.get(
  "/templates/:type",
  validate(downloadImportTemplateSchema),
  downloadImportTemplateController
);
importRoutes.post("/preview", spreadsheetUpload.single("file"), previewImportController);
importRoutes.post("/upload", spreadsheetUpload.single("file"), uploadImportController);
importRoutes.post("/", validate(createImportJobSchema), createImportJobController);




