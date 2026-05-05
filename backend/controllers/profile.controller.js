import { StatusCodes } from "http-status-codes";
import { getUserProfile, updateUserProfile } from "../services/profile.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const getProfileController = asyncHandler(async (req, res) => {
  const user = await getUserProfile(req.user.id);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: user
  });
});

export const updateProfileController = asyncHandler(async (req, res) => {
  const updatedUser = await updateUserProfile(req.user.id, req.body);
  
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Profile updated successfully",
    data: updatedUser
  });
});