const express = require("express");

const LessonController = require("../controllers/lesson.controller");

const parseFormData = require("../middlewares/parseFormData.middleware");
const { protect, allowedTo } = require("../middlewares/auth.middleware");
const { SUPER_ADMIN, ADMIN,USER } = require("../utils/constants");

const router = express.Router();

router.post(
    "/bunny-callback",
     LessonController.bunnyCallback
    );

router.post(
    "/:sectionId",
    protect,
    allowedTo(ADMIN, SUPER_ADMIN, USER),
    parseFormData(["isPreview"], []),
    LessonController.createLesson
)

router.patch(
    "/:id",
    protect,
    allowedTo(ADMIN, SUPER_ADMIN),
    parseFormData(["isPreview"], []),
    LessonController.updateLesson
)


router.delete(
    "/:id",
    protect,
    allowedTo(ADMIN, SUPER_ADMIN),
    LessonController.deleteLesson
)

module.exports = router;

