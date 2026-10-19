const appRouter = require("express").Router();
const BASE_URL = "/api/v1";
const ApiError = require("../utils/ApiError");

let adminRoutes = require("./admin.routes");
let adminAuthRoutes = require("./adminAuth.routes");

let userAuthRoutes = require("./userAuth.routes")
let userRoutes = require("./user.routes")

let courseRoutes = require("./course.routes");
let sectionRoutes = require("./section.routes");
let lessonRoutes = require("./lesson.routes");
let paymentRoutes = require("./payment.routes");
let enrollmentRoutes = require("./enrollment.routes");
let couponRoutes = require("./coupon.routes");
let notificationRoutes = require("./notification.routes");
let chatRoutes = require("./chat.routes");

let governmentRoutes = require("./government.routes");
let groupeRoutes = require("./groupe.routes");


appRouter.use(`${BASE_URL}/admins`, adminRoutes);
appRouter.use(`${BASE_URL}/admins/auth`, adminAuthRoutes);
appRouter.use(`${BASE_URL}/users/auth`, userAuthRoutes);
appRouter.use(`${BASE_URL}/users`, userRoutes);

appRouter.use(`${BASE_URL}/courses`, courseRoutes);
appRouter.use(`${BASE_URL}/sections`, sectionRoutes);
appRouter.use(`${BASE_URL}/lessons`, lessonRoutes);
appRouter.use(`${BASE_URL}/payments`, paymentRoutes);
appRouter.use(`${BASE_URL}/enrollments`, enrollmentRoutes);
appRouter.use(`${BASE_URL}/coupons`, couponRoutes);
appRouter.use(`${BASE_URL}/notifications`, notificationRoutes);

appRouter.use(`${BASE_URL}/governments`, governmentRoutes);
appRouter.use(`${BASE_URL}/groupes`, groupeRoutes);

appRouter.get("/", (req, res) => {
  res.status(200).json({
    status: true,
    message: "You're Server is up and running!"
  });
});

// Not Found Route
appRouter.use((req, res, next) => {
  next(new ApiError(`This Route (${req.originalUrl}) is not found`, 404));
});


module.exports = appRouter;
