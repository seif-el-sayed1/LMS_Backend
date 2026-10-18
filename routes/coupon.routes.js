const express = require("express");
const CouponController = require("../controllers/coupon.controller");
const CouponValidator = require("../validators/coupon.validator");
const { protect, allowedTo } = require("../middlewares/auth.middleware");
const { SUPER_ADMIN, ADMIN, USER } = require("../utils/constants");

const router = express.Router();

router
    .route("/")
    .get(
        protect, 
        allowedTo(SUPER_ADMIN, ADMIN),
        CouponController.getAllCoupons
    )
    .post(
        protect, 
        allowedTo(SUPER_ADMIN, ADMIN),
        CouponValidator.validateCreateCoupon,
        CouponController.createCoupon
    );

    
router.route("/validate")
    .post(
        protect,
        allowedTo(SUPER_ADMIN, ADMIN, USER),
        CouponValidator.validateCheckCoupon,
        CouponController.checkCoupon
    );

router.route("/bulk")
    .post(
        protect,
        allowedTo(SUPER_ADMIN, ADMIN),
        CouponController.generateBulkCoupons
    );

router
    .route("/:id/redemptions")
    .get(
        protect, 
        allowedTo(SUPER_ADMIN, ADMIN),
        CouponController.getCouponRedemptions
    );

router
    .route("/:id")
    .get(
        protect, 
        allowedTo(SUPER_ADMIN, ADMIN),
        CouponController.getCouponById
    )
    .patch(
        protect, 
        allowedTo(SUPER_ADMIN, ADMIN),
        CouponValidator.validateUpdateCoupon, 
        CouponController.updateCoupon
    );

module.exports = router;
