const asyncHandler = require("express-async-handler")
const crypto = require("crypto");

// Prisma
const prisma = require("../startup/db")

// Utils
const ApiError = require("../utils/ApiError")
const ApiFeatures = require("../utils/ApiFeatures")
const { translate } = require("../utils/translation")

class NotificationController {

    // @desc    Get user notifications
    // @route   GET /notifications/me
    // @access  Private
    getUserNotifications = asyncHandler(async (req, res, next) => {
        const now = new Date();

        const baseWhere = {
            OR: [
                {
                    isGlobal: true,
                    createdAt: {
                        gte: req.user.createdAt,
                    },
                    OR: [
                        {
                            scheduleTime: {
                                lte: now,
                            },
                        },
                        {
                            scheduleTime: null,
                        },
                    ],
                },
                {
                    userId: req.user.id,
                    createdAt: {
                        gte: req.user.createdAt,
                    },
                    OR: [
                        {
                            scheduleTime: {
                                lte: now,
                            },
                        },
                        {
                            scheduleTime: null,
                        },
                    ],
                },
            ],
        };

        const apiFeatures = new ApiFeatures(
            prisma.notification,
            req.query,
            "Notification",
            { where: baseWhere }
        )
            .search()
            .filter()
            .sort()
            .paginate();

        await apiFeatures.calculatePagination();
        const notifications = await apiFeatures.execute();

        res.status(200).json({
            success: true,
            message: "User notifications fetched successfully",
            pagination: apiFeatures.paginationResult,
            totalResults: apiFeatures.paginationResult?.totalResults ?? notifications.length,
            results: notifications.length,
            data: notifications,
        });
    });

    // @desc    Mark one notification as Seen
    // @route   PATCH /notifications/mark/:id/seen
    // @access  Private
    markNotificationAsSeen = asyncHandler(async (req, res, next) => {

        const { id } = req.params

        const notification = await prisma.notification.findUnique({
            where: { id }
        })

        if (!notification) {
            return next(
                new ApiError(
                    translate("Notification not found", req.headers.lang),
                    404
                )
            )
        }

        await prisma.notification.update({
            where: { id },
            data: {
                seen: true
            }
        })

        res.status(200).json({
            success: true,
            message: "Notification is seen successfully"
        })
    })

    // @desc    Mark all notifications as Seen
    // @route   PATCH /notifications/mark/all/seen
    // @access  Private
    markAllNotificationsAsSeen = asyncHandler(async (req, res, next) => {

        await prisma.notification.updateMany({
            where: {
                userId: req.user.id
            },
            data: {
                seen: true
            }
        })

        res.status(200).json({
            success: true,
            message: "Notifications are Marked seen successfully"
        })
    })


}

module.exports = new NotificationController()