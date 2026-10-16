const asyncHandler = require("express-async-handler");
const prisma = require("../startup/db");
const ApiError = require("../utils/ApiError");
const ApiFeatures = require("../utils/ApiFeatures");
const { generateCoupons } = require("../utils/generateCoupons");

class CouponController {

    // @desc    Create Coupon
    // @route   POST /coupons
    // @access  Private (ADMIN, SUPER_ADMIN)
    createCoupon = asyncHandler(async (req, res, next) => {
        const {
            code, type, value, maxUses, perUserLimit,
            startsAt, expiresAt, isActive, courseId,
        } = req.body;

        const course = await prisma.course.findFirst({
            where: { id: courseId, isDeleted: false },
        });
        if (!course) {
            return next(new ApiError("Course not found", 404));
        }

        const coupon = await prisma.coupon.create({
            data: {
                code: code?.trim() ? code.trim().toUpperCase() : generateCoupons(),
                type,
                value: value ?? null,
                maxUses: maxUses ?? (type === "FULL_ACCESS" ? 1 : null),
                perUserLimit,
                startsAt: startsAt ? new Date(startsAt) : null,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                isActive,
                courseId,
            },
            include: {
                course: { select: { id: true, title: true, slug: true } },
            },
        });

        res.status(201).json({
            success: true,
            message: "Coupon created successfully",
            data: coupon,
        });
    });

}

module.exports = new CouponController();
