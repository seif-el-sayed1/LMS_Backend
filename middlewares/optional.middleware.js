const asyncHandler = require("express-async-handler");
const prisma = require("../startup/db");
const { protect } = require("../middlewares/auth.middleware");
const { USER } = require("../utils/constants");

exports.optionalAuth = (req, res, next) => {
  if (!req.headers.authorization) return next();

  let done = false;
  protect(req, res, (err) => {
    if (done) return;
    done = true;

    if (err) {
      req.user = undefined;
      req.role = undefined;
      req.userId = undefined;
    }
    next();
  });
};

exports.attachEnrollments = asyncHandler(async (req, res, next) => {
  req.enrolledCourseIds = new Set();

  if (req.user && req.role === USER) {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user.id },
      select: { courseId: true },
    });
    req.enrolledCourseIds = new Set(enrollments.map((e) => e.courseId));
  }

  next();
});