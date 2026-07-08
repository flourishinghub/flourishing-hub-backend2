import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";

// Get all active videos
export const getAllVideos = async (category = null) => {
  const where = {
    isActive: true
  };

  if (category && category !== 'ALL') {
    where.category = category;
  }

  const videos = await prisma.video.findMany({
    where,
    orderBy: {
      createdAt: 'desc'
    }
  });

  return videos;
};

// Get video by ID
export const getVideoById = async (videoId) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId }
  });

  if (!video) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Video not found");
  }

  return video;
};

// Increment view count
export const incrementVideoView = async (videoId) => {
  const video = await prisma.video.update({
    where: { id: videoId },
    data: {
      viewCount: {
        increment: 1
      }
    }
  });

  return video;
};

// Create video (admin only)
export const createVideo = async (videoData) => {
  const video = await prisma.video.create({
    data: {
      title: videoData.title,
      description: videoData.description,
      youtubeUrl: videoData.youtubeUrl,
      thumbnailUrl: videoData.thumbnailUrl,
      duration: videoData.duration,
      category: videoData.category,
      tags: videoData.tags || []
    }
  });

  return video;
};

// Update video (admin only)
export const updateVideo = async (videoId, videoData) => {
  const video = await prisma.video.update({
    where: { id: videoId },
    data: {
      title: videoData.title,
      description: videoData.description,
      youtubeUrl: videoData.youtubeUrl,
      thumbnailUrl: videoData.thumbnailUrl,
      duration: videoData.duration,
      category: videoData.category,
      tags: videoData.tags,
      isActive: videoData.isActive
    }
  });

  return video;
};

// Delete video (admin only)
export const deleteVideo = async (videoId) => {
  await prisma.video.delete({
    where: { id: videoId }
  });

  return { success: true };
};
