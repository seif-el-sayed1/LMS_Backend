const asyncHandler = require("express-async-handler");
const prisma = require("../startup/db");
const ApiError = require("../utils/ApiError");
const ApiFeatures = require("../utils/ApiFeatures");
const { generateCoupons, evaluateCoupon } = require("../utils/coupons");

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

    // @desc    Get all coupons
    // @route   GET /coupons
    // @access  Private (ADMIN, SUPER_ADMIN)
    getAllCoupons = asyncHandler(async (req, res) => {
        const apiFeatures = new ApiFeatures(
            prisma.coupon,
            req.query,
            "Coupon",
            {
                include: {
                    course: {
                        select: { id: true, title: true, slug: true },
                    },
                    _count: {
                        select: { redemptions: true },
                    },
                },
            }
        )
            .search()
            .filter()
            .sort()
            .paginate();

        await apiFeatures.calculatePagination();
        const coupons = await apiFeatures.execute();

        res.status(200).json({
            success: true,
            message: "Coupons fetched successfully",
            pagination: apiFeatures.paginationResult,
            results: coupons.length,
            data: coupons,
        });
    });

    // @desc    Get coupon by id
    // @route   GET /coupons/:id
    // @access  Private (ADMIN, SUPER_ADMIN)
    getCouponById = asyncHandler(async (req, res, next) => {
        const { id } = req.params;

        const coupon = await prisma.coupon.findUnique({
            where: { id },
            include: {
                course: {
                    select: { id: true, title: true, slug: true },
                },
                _count: {
                    select: { redemptions: true },
                },
            },
        });

        if (!coupon) {
            return next(new ApiError("Coupon not found", 404));
        }

        res.status(200).json({
            success: true,
            message: "Coupon fetched successfully",
            data: coupon,
        });
    });

    // @desc    Update coupon
    // @route   PATCH /coupons/:id
    // @access  Private (ADMIN, SUPER_ADMIN)
    updateCoupon = asyncHandler(async (req, res, next) => {
        const { id } = req.params;
        const {
            code, value, maxUses, perUserLimit,
            startsAt, expiresAt, isActive,
        } = req.body;

        const coupon = await prisma.coupon.findUnique({ where: { id } });
        if (!coupon) {
            return next(new ApiError("Coupon not found", 404));
        }

        if (value !== undefined) {
            if (coupon.type === "FULL_ACCESS") {
                return next(new ApiError("Value is not allowed for FULL_ACCESS coupons", 400));
            }
            if (coupon.type === "PERCENT" && value > 100) {
                return next(new ApiError("Percentage discount cannot exceed 100", 400));
            }
        }

        if (maxUses != null && maxUses < coupon.usedCount) {
            return next(
                new ApiError(`Max uses cannot be less than current usage (${coupon.usedCount})`, 400)
            );
        }

        const newStartsAt =
            startsAt === undefined ? coupon.startsAt : startsAt ? new Date(startsAt) : null;
        const newExpiresAt =
            expiresAt === undefined ? coupon.expiresAt : expiresAt ? new Date(expiresAt) : null;

        if (newStartsAt && newExpiresAt && newExpiresAt <= newStartsAt) {
            return next(new ApiError("Expiry date must be after start date", 400));
        }

        const updatedCoupon = await prisma.coupon.update({
            where: { id },
            data: {
                code: code?.trim().toUpperCase(),
                value,
                maxUses,
                perUserLimit,
                startsAt: newStartsAt,
                expiresAt: newExpiresAt,
                isActive,
            },
            include: {
                course: { select: { id: true, title: true, slug: true } },
            },
        });

        res.status(200).json({
            success: true,
            message: "Coupon updated successfully",
            data: updatedCoupon,
        });
    });


    //@desc    Check if a coupon is valid
    //@route   POST /coupons/check
    //@access  Public
    checkCoupon = asyncHandler(async (req, res, next) => {
        const { code, courseId } = req.body;

        const { coupon, pricing } = await evaluateCoupon({
            code,
            courseId,
            userId: req.user.id,
        });

        res.status(200).json({
            success: true,
            data: {
                code: coupon.code,
                type: coupon.type,
                ...pricing,
                isFree: pricing.finalPrice === 0,
            },
        });
    });

    // @desc    Get coupon redemptions
    // @route   GET  /coupons/:id/redemptions
    // @access  Private (ADMIN, SUPER_ADMIN)
    getCouponRedemptions = asyncHandler(async (req, res, next) => {
        const couponId =  req.params.id;
        const initialWhere = {};

        if (couponId) {
            const couponExists = await prisma.coupon.findUnique({
                where: { id: couponId },
                select: { id: true },
            });
            if (!couponExists) {
                return next(new ApiError("Coupon not found", 404));
            }
            initialWhere.couponId = couponId;
        }

        const apiFeatures = new ApiFeatures(
            prisma.couponRedemption,
            req.query,
            "CouponRedemption",
            {
                where: initialWhere,
                include: {
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            phone: true,
                            studentCode: true,
                        },
                    },
                    coupon: {
                        select: {
                            id: true,
                            code: true,
                            type: true,
                            value: true,
                        },
                    },
                    course: {
                        select: {
                            id: true,
                            title: true,
                            slug: true,
                            price: true,
                        },
                    },
                    payment: {
                        select: {
                            id: true,
                            orderCode: true,
                        },
                    },
                },
            }
        )
            .search()
            .filter()
            .sort()
            .paginate();

        if (couponId) {
            apiFeatures.prismaArgs.where.couponId = couponId;
        }

        await apiFeatures.calculatePagination();
        const redemptions = await apiFeatures.execute();

        res.status(200).json({
            success: true,
            message: "Coupon redemptions fetched successfully",
            pagination: apiFeatures.paginationResult,
            results: redemptions.length,
            data: redemptions,
        });
    });

    // @desc    Generate bulk coupons
    // @route   POST /coupons/bulk
    // @access  Private (ADMIN, SUPER_ADMIN)
    generateBulkCoupons = asyncHandler(async (req, res, next) => {
        const {
            count, type, value, maxUses, perUserLimit,
            startsAt, expiresAt, isActive, courseId,
        } = req.body;

        const course = await prisma.course.findFirst({
            where: { id: courseId, isDeleted: false },
            select: { id: true },
        });
        if (!course) {
            return next(new ApiError("Course not found", 404));
        }

        const codes = new Set();
        for (let round = 0; round < 5 && codes.size < count; round++) {
            while (codes.size < count) {
                codes.add(generateCoupons());
            }

            const taken = await prisma.coupon.findMany({
                where: { code: { in: [...codes] } },
                select: { code: true },
            });
            taken.forEach(({ code }) => codes.delete(code));
        }

        if (codes.size < count) {
            return next(new ApiError("Could not generate enough unique codes, try again", 500));
        }

        const codesList = [...codes];

        await prisma.coupon.createMany({
            data: codesList.map((code) => ({
                code,
                type,
                value: value ?? null,
                maxUses: maxUses ?? (type === "FULL_ACCESS" ? 1 : null),
                perUserLimit,
                startsAt: startsAt ? new Date(startsAt) : null,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                isActive,
                courseId,
            })),
        });

        res.status(201).json({
            success: true,
            message: `${codesList.length} coupons generated successfully`,
            data: {
                count: codesList.length,
                courseId,
                type,
                codes: codesList,
            },
        });
    });

    
}

module.exports = new CouponController();
