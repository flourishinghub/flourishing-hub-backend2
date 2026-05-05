import { StatusCodes } from "http-status-codes";
import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";

export const getUserProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    }
  });

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  return user;
};

export const updateUserProfile = async (userId, profileData) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    }
  });

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  // Update basic user information
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      name: profileData.name || user.name,
      email: profileData.email || user.email,
      profileImageUrl: profileData.profileImageUrl || user.profileImageUrl,
    },
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    }
  });

  // Update student profile if user is a student
  if (user.role === 'STUDENT' && user.studentProfile && profileData.studentProfile) {
    await prisma.studentProfile.update({
      where: { userId: userId },
      data: {
        department: profileData.studentProfile.department || user.studentProfile.department,
        yearOfStudy: profileData.studentProfile.yearOfStudy || user.studentProfile.yearOfStudy,
        programme: profileData.studentProfile.programme || user.studentProfile.programme,
        section: profileData.studentProfile.section || user.studentProfile.section,
        cohort: profileData.studentProfile.cohort || user.studentProfile.cohort,
      }
    });
  }

  // Update instructor profile if user is an instructor
  if (user.role === 'INSTRUCTOR' && user.instructorProfile && profileData.instructorProfile) {
    await prisma.instructorProfile.update({
      where: { userId: userId },
      data: {
        designation: profileData.instructorProfile.designation || user.instructorProfile.designation,
        department: profileData.instructorProfile.department || user.instructorProfile.department,
      }
    });
  }

  // Fetch and return updated user data
  return await prisma.user.findUnique({
    where: { id: userId },
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    }
  });
};