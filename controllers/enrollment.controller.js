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

    //@desc    Get enrolled course by id
    //@route  GET /enrollments/:courseId
    //@access  Private
    getMyEnrollmentCourse = asyncHandler(async (req, res, next) => {
        const { courseId } = req.params;
        const userId = req.user.id;

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: {
                id: true,
                progress: true,
                completedAt: true,
                enrolledAt: true,
                course: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        slug: true,
                        image: true,
                        level: true,
                        sections: {
                            where: { isDeleted: false },
                            orderBy: { order: "asc" },
                            select: {
                                id: true,
                                title: true,
                                description: true,
                                order: true,
                                isFree: true,
                                lessons: {
                                    where: { isDeleted: false },
                                    orderBy: { order: "asc" },
                                    select: {
                                        id: true,
                                        title: true,
                                        description: true,
                                        duration: true,
                                        order: true,
                                        isPreview: true,
                                        bunnyVideoId: true,
                                        videoStatus: true,
                                        attachments: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!enrollment) return next(new ApiError("Enrollment not found", 404));

        await Promise.all(
            enrollment.course.sections.flatMap((section) =>
                section.lessons.map(async (lesson) => {
                    const links = await R2Service.getAttachmentLinks(
                        lesson.attachments
                    );
                    lesson.attachments = links.map(({ key, url }) => ({
                        name: key.split("/").pop(),
                        url,
                    }));
                })
            )
        );

        res.status(200).json({ success: true, data: enrollment });
    });    

    //@desc get payment status by order code
    //@route GET /enrollments/:orderCode
    //@access Private
    getPaymentStatus = asyncHandler(async (req, res, next) => {
        const { orderCode } = req.params;

        const payment = await prisma.payment.findFirst({
            where: { orderCode, userId: req.user.id },
            select: { status: true, courseId: true },
        });

        if (!payment) return next(new ApiError("Payment not found", 404));

        res.status(200).json({ success: true, data: payment });
    });

}

module.exports = new EnrollmentController();