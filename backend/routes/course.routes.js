import express from "express";
import * as courseController from "../controllers/course.controller.js";
import * as courseModuleController from "../controllers/courseModule.controller.js";
import { authenticate } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { moduleQuizSchema } from "../validators/quiz.validation.js";
import { bulkEnrollToCourse, selfEnrollToCourse } from "../controllers/course.controller.js";

const router = express.Router();

router.use(authenticate);

// Course CRUD
router.get("/", courseController.getAllCourses);
router.post("/", authorize("ADMIN"), courseController.createCourse);
router.get("/:courseId/analytics", courseController.getCourseAnalytics);
router.post("/:courseId/bulk-enroll", bulkEnrollToCourse);
router.post("/:courseId/self-enroll", selfEnrollToCourse);
router.get("/:courseId", courseController.getCourseById);
router.put("/:courseId", authorize("ADMIN"), courseController.updateCourse);
router.delete("/:courseId", authorize("ADMIN"), courseController.deleteCourse);

// Module routes nested under courses
router.get("/:courseId/modules", courseModuleController.listModules);
router.post("/:courseId/modules", authorize("ADMIN"), courseModuleController.createModule);
router.get("/:courseId/modules/:id/usage", courseModuleController.getModuleUsage);
router.get("/:courseId/modules/:id/quiz", courseModuleController.getModuleQuiz);
router.put(
  "/:courseId/modules/:id/quiz",
  authorize("ADMIN"),
  validate(moduleQuizSchema),
  courseModuleController.saveModuleQuiz
);
router.get("/:courseId/modules/:id", courseModuleController.getModule);
router.put("/:courseId/modules/:id", authorize("ADMIN"), courseModuleController.updateModule);
router.delete("/:courseId/modules/:id", authorize("ADMIN"), courseModuleController.deleteModule);

export default router;
