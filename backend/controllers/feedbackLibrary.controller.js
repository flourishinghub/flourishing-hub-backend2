import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as feedbackLibraryService from "../services/feedbackLibrary.service.js";

export const listFormsController = asyncHandler(async (req, res) => {
  const forms = await feedbackLibraryService.listForms(req.query.search);
  res.status(StatusCodes.OK).json({ success: true, data: forms });
});

export const getFormController = asyncHandler(async (req, res) => {
  const form = await feedbackLibraryService.getFormById(req.params.id);
  res.status(StatusCodes.OK).json({ success: true, data: form });
});

export const createFormController = asyncHandler(async (req, res) => {
  const form = await feedbackLibraryService.createForm(req.validated.body.title, req.validated.body.questions);
  res.status(StatusCodes.CREATED).json({ success: true, message: "Feedback form created successfully", data: form });
});

export const updateFormController = asyncHandler(async (req, res) => {
  const form = await feedbackLibraryService.updateFormQuestions(
    req.params.id,
    req.validated.body.title,
    req.validated.body.questions
  );
  res.status(StatusCodes.OK).json({ success: true, message: "Feedback form updated successfully", data: form });
});

export const getFormUsageController = asyncHandler(async (req, res) => {
  const usage = await feedbackLibraryService.getFormUsage(req.params.id);
  res.status(StatusCodes.OK).json({ success: true, data: usage });
});

export const deleteFormController = asyncHandler(async (req, res) => {
  const result = await feedbackLibraryService.deleteForm(req.params.id);
  res.status(StatusCodes.OK).json({ success: true, message: result.message });
});
