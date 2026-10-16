const express = require("express");

const EnrollmentController = require("../controllers/enrollment.controller");
const { protect, allowedTo } = require("../middlewares/auth.middleware");
const { USER } = require("../utils/constants");

const router = express.Router();

router
    .route("/me")
    .get(
        protect,
        allowedTo(USER),
        EnrollmentController.getMyEnrolledCourses
    );

router
    .route("/payment/:orderCode")
    .get(
        protect,
        allowedTo(USER),
        EnrollmentController.getPaymentStatus
    );

router
    .route("/:courseId/enroll")
    .post(
        protect,
        allowedTo(USER),
        EnrollmentController.enrollToCourse
    );

router
    .route("/:courseId")
    .get(
        protect,
        allowedTo(USER),
        EnrollmentController.getMyEnrollmentCourse
    );

module.exports = router;