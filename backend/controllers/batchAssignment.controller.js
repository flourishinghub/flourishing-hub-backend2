import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  uploadBatchAssignment,
  getBatchAssignmentStats,
  downloadBatchTemplate
} from "../services/batchAssignment.service.js";

export const uploadBatchAssignmentController = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "File is required" });
  }

  const result = await uploadBatchAssignment({
    fileBuffer: req.file.buffer,
    fileName: req.file.originalname
  });

  res.status(StatusCodes.OK).json({ success: true, data: result });
});

export const getBatchStatsController = asyncHandler(async (_req, res) => {
  const stats = await getBatchAssignmentStats();
  res.status(StatusCodes.OK).json({ success: true, data: stats });
});

export const downloadTemplateController = asyncHandler(async (_req, res) => {
  const buffer = await downloadBatchTemplate();
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="batch_assignment_template.xlsx"'
  });
  res.send(buffer);
});
