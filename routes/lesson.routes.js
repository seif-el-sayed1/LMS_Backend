const express = require("express");

const LessonController = require("../controllers/lesson.controller");

const parseFormData = require("../middlewares/parseFormData.middleware");
const { protect, allowedTo } = require("../middlewares/auth.middleware");
const { optionalAuth } = require("../middlewares/optional.middleware");

const { SUPER_ADMIN, ADMIN,USER } = require("../utils/constants");

const router = express.Router();

router.route("/bunny-callback").post(LessonController.bunnyCallback);

router.route("/:courseId/:lessonId/video")
    .get(
        optionalAuth,
        LessonController.getLessonVideo
    )

router.route("/:courseId/:lessonId/attachment/:index")
    .get(
        optionalAuth,
        LessonController.getLessonAttachment
    )
    
router.post(
    "/:sectionId",
    protect,
    allowedTo(ADMIN, SUPER_ADMIN, USER),
    parseFormData(["isPreview"], []),
    LessonController.createLesson
)


router.route("/:id")
    .patch(
        protect,
        allowedTo(ADMIN, SUPER_ADMIN),
        parseFormData(["isPreview"], []),
        LessonController.updateLesson
    ).delete(
        protect,
        allowedTo(ADMIN, SUPER_ADMIN),
        LessonController.deleteLesson
    )

module.exports = router;

