const express = require("express");
const CouponController = require("../controllers/coupon.controller");
const CouponValidator = require("../validators/coupon.validator");
const { protect, allowedTo } = require("../middlewares/auth.middleware");
const { SUPER_ADMIN, ADMIN } = require("../utils/constants");

const router = express.Router();

router.use(protect, allowedTo(SUPER_ADMIN, ADMIN));

router
    .route("/")
    .get(CouponController.getAllCoupons)
    .post(CouponValidator.validateCreateCoupon, CouponController.createCoupon);
    
router
    .route("/:id")
    .get(CouponController.getCouponById)
    .patch(CouponValidator.validateUpdateCoupon, CouponController.updateCoupon);

module.exports = router;
