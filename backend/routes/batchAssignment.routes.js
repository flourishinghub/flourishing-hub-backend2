import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { upload } from "../middleware/upload.js";
import {
  uploadBatchAssignmentController,
  getBatchStatsController,
  downloadTemplateController
} from "../controllers/batchAssignment.controller.js";

export const batchAssignmentRoutes = Router();

batchAssignmentRoutes.use(authenticate);
batchAssignmentRoutes.use(authorize("ADMIN"));

batchAssignmentRoutes.post("/upload", upload.single("file"), uploadBatchAssignmentController);
batchAssignmentRoutes.get("/stats", getBatchStatsController);
batchAssignmentRoutes.get("/template", downloadTemplateController);
