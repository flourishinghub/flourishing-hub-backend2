import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { spreadsheetUpload } from "../middleware/upload.js";
import {
  uploadBatchAssignmentController,
  getBatchStatsController,
  listBatchAssignmentsController,
  downloadTemplateController
} from "../controllers/batchAssignment.controller.js";

export const batchAssignmentRoutes = Router();

batchAssignmentRoutes.use(authenticate);
batchAssignmentRoutes.use(authorize("ADMIN"));

batchAssignmentRoutes.post("/upload", spreadsheetUpload.single("file"), uploadBatchAssignmentController);
batchAssignmentRoutes.get("/stats", getBatchStatsController);
batchAssignmentRoutes.get("/records", listBatchAssignmentsController);
batchAssignmentRoutes.get("/template", downloadTemplateController);
