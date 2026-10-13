const asyncHandler = require('express-async-handler');
const prisma = require('../startup/db');
const ApiError = require('../utils/ApiError');
const ApiFeatures = require('../utils/ApiFeatures');
const PaymentController = require('./payment.controller');
const R2Service = require('../services/cloudflare.r2.service');

class EnrollmentController {

    //@desc    Enroll to a course
    //@route   POST /courses/:courseId/enroll
    //@access  Private
    enrollToCourse = asyncHandler(async (req, res, next) => {
        const { courseId } = req.params;

        const course = await prisma.course.findUnique({
            where: { id: courseId, isPublished: true, isDeleted: false },
        });

        if (!course) {
            return next(new ApiError("Course not found", 404));
        }
        
        const existingEnrollment = await prisma.enrollment.findUnique({
            where: {
                userId_courseId: { userId: req.user.id, courseId },
            },
        });

        if (existingEnrollment) {
            return next(new ApiError("You are already enrolled in this course", 400));
        }
        
        const data = await PaymentController.createClientSecretKey(course, req.user);

        data.paymentKey =
            `https://accept.paymob.com/unifiedcheckout/?publicKey=${process.env.PAYMOB_PUBLIC_KEY}&clientSecret=` +
            data.clientSecret;

        res.status(200).json({
            success: true,
            message: "Payment key created successfully",
            data,
        });
    });

    //@desc    Get enrolled courses
    //@route   GET /enrollments
    //@access  Private
    getMyEnrolledCourses = asyncHandler(async (req, res) => {
        const courseSelect = {
            id: true,
            title: true,
            description: true,
            slug: true,
            image: true,
            level: true,
            price: true,
            isFree: true,
            hasDiscount: true,
            discountPercent: true,
            priceAfterDiscount: true,
            createdAt: true,
            sections: {
                where: { isDeleted: false },
                select: {
                    _count: {
                        select: { lessons: { where: { isDeleted: false } } },
                    },
                },
            },
        };

        const apiFeatures = new ApiFeatures(
            prisma.enrollment,
            req.query,
            "Enrollment",
            {
                where: { userId: req.user.id },
                include: { course: { select: courseSelect } },
            }
        )
            .filter()
            .sort()
            .paginate();

        apiFeatures.prismaArgs.where.userId = req.user.id;

        await apiFeatures.calculatePagination();
        const enrollments = await apiFeatures.execute();

        const data = enrollments.map(({ course, ...enrollment }) => {
            const { sections, ...courseData } = course;
            return {
                ...enrollment,
                course: {
                    ...courseData,
                    sectionsCount: sections.length,
                    lessonsCount: sections.reduce(
                        (sum, section) => sum + section._count.lessons,
                        0
                    ),
                },
            };
        });

        res.status(200).json({
            success: true,
            message: "Enrolled courses fetched successfully",
            pagination: apiFeatures.paginationResult,
            results: data.length,
            data,
        });
    });


}

module.exports = new EnrollmentController();