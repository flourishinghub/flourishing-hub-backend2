import express from "express";
import * as courseController from "../controllers/course.controller.js";
import * as courseModuleController from "../controllers/courseModule.controller.js";
import { authenticate } from "../middleware/auth.js";
import { bulkEnrollToCourse, selfEnrollToCourse } from "../controllers/course.controller.js";

const router = express.Router();

router.use(authenticate);

// Course CRUD
router.get("/", courseController.getAllCourses);
router.post("/", courseController.createCourse);
router.get("/:courseId/analytics", courseController.getCourseAnalytics);
router.post("/:courseId/bulk-enroll", bulkEnrollToCourse);
router.post("/:courseId/self-enroll", selfEnrollToCourse);
router.get("/:courseId", courseController.getCourseById);
router.put("/:courseId", courseController.updateCourse);
router.delete("/:courseId", courseController.deleteCourse);

// Module routes nested under courses
router.get("/:courseId/modules", courseModuleController.listModules);
router.post("/:courseId/modules", courseModuleController.createModule);
router.get("/:courseId/modules/:id/usage", courseModuleController.getModuleUsage);
router.get("/:courseId/modules/:id", courseModuleController.getModule);
router.put("/:courseId/modules/:id", courseModuleController.updateModule);
router.delete("/:courseId/modules/:id", courseModuleController.deleteModule);

export default router;
