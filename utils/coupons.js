const crypto = require("crypto");
const ApiError = require("./ApiError");
const prisma = require("../startup/db"); 

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateCoupons = (length = 8) =>
    Array.from({ length }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join("");

const round2 = (n) => Math.round(n * 100) / 100;

const calculatePrice = (coupon, coursePrice) => {
    const originalPrice = Number(coursePrice);
    let discount;

    if (coupon.type === "FULL_ACCESS") {
        discount = originalPrice;
    } else if (coupon.type === "PERCENT") {
        discount = (originalPrice * Number(coupon.value)) / 100;
    } else {
        discount = Number(coupon.value);
    }

    discount = Math.min(round2(discount), originalPrice);

    return {
        originalPrice,
        discountAmount: discount,
        finalPrice: round2(originalPrice - discount),
    };
};

const evaluateCoupon = async ({ code, courseId, userId }) => {
    const course = await prisma.course.findFirst({
        where: { id: courseId, isDeleted: false },
    });
    if (!course) {
        throw new ApiError("Course not found", 404);
    }

    const enrolled = await prisma.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
    });
    if (enrolled) {
        throw new ApiError("You are already enrolled in this course", 400);
    }

    const coupon = await prisma.coupon.findUnique({
        where: { code: code.trim().toUpperCase() },
    });

    if (!coupon || coupon.courseId !== courseId || !coupon.isActive) {
        throw new ApiError("Invalid coupon code", 400);
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
        throw new ApiError("This coupon is not active yet", 400);
    }
    if (coupon.expiresAt && coupon.expiresAt <= now) {
        throw new ApiError("This coupon has expired", 400);
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
        throw new ApiError("Invalid coupon code", 400);
    }

    const userUses = await prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId },
    });
    if (userUses >= coupon.perUserLimit) {
        throw new ApiError("You have already used this coupon", 400);
    }

    const basePrice = course.hasDiscount ? course.priceAfterDiscount : course.price;

    return { coupon, course, pricing: calculatePrice(coupon, basePrice) };

};

module.exports = { 
    generateCoupons,
    evaluateCoupon
};