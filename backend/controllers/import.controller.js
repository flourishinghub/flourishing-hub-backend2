import { StatusCodes } from "http-status-codes";

import {
  buildImportTemplate,
  createImportJob,
  listImportJobs,
  processImportUpload,
  previewImportEvents
} from "../services/import.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const createImportJobController = asyncHandler(async (req, res) => {
  const data = await createImportJob(req.validated.body, req.user.id);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Import job created successfully",
    data
  });
});

export const listImportJobsController = asyncHandler(async (_req, res) => {
  const data = await listImportJobs();
  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const uploadImportController = asyncHandler(async (req, res) => {
  const data = await processImportUpload(
    {
      type: req.body.type || "EVENTS",
      fileName: req.file?.originalname,
      fileBuffer: req.file?.buffer,
      meta: req.body.meta,
      courseId: req.body.courseId || null,
      courseModuleId: req.body.courseModuleId || null,
      batchCode: req.body.batchCode || null,
    },
    req.user.id
  );

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Import processed successfully",
    data
  });
});

export const previewImportController = asyncHandler(async (req, res) => {
  const events = await previewImportEvents({
    fileBuffer: req.file?.buffer,
    fileName: req.file?.originalname,
    courseId: req.body.courseId || null,
    courseModuleId: req.body.courseModuleId || null,
    batchCode: req.body.batchCode || null,
  });

  res.status(StatusCodes.OK).json({
    success: true,
    data: events
  });
});

export const downloadImportTemplateController = asyncHandler(async (req, res) => {
  const fileBuffer = await buildImportTemplate(req.validated.params.type);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fh-${req.validated.params.type.toLowerCase()}-template.xlsx"`
  );
  res.status(StatusCodes.OK).send(fileBuffer);
});



