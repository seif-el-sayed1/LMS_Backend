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

    //@desc    Send notification by admin
    //@route   POST /notifications/send/admin
    //@access  Private
    sendNotificationByAdmin = asyncHandler(async (req, res, next) => {
        const { title, body, info, isGlobal, users } = req.body;
        const adminId = req.user.id;
        const batchId = crypto.randomUUID();
        const activeUserFilter = { isActive: true };

        let userIds;
        if (isGlobal) {
            const allUsers = await prisma.user.findMany({
                where: activeUserFilter,
                select: { id: true },
            });
            userIds = allUsers.map((u) => u.id);
        } else {
            const requestedIds = [...new Set(users)];

            const found = await prisma.user.findMany({
                where: { id: { in: requestedIds }, ...activeUserFilter },
                select: { id: true },
            });

            if (found.length !== requestedIds.length) {
                const foundSet = new Set(found.map((u) => u.id));
                const missing = requestedIds.filter((id) => !foundSet.has(id));
                return next(new ApiError(`${missing.length} user(s) not found or inactive`, 404));
            }

            userIds = found.map((u) => u.id);
        }

        if (userIds.length === 0) {
            return next(new ApiError("No users to send the notification to", 400));
        }

        const CHUNK_SIZE = 1000;

        await prisma.$transaction(
            async (tx) => {
                for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
                    await tx.notification.createMany({
                        data: userIds.slice(i, i + CHUNK_SIZE).map((userId) => ({
                            userId,
                            adminId,
                            batchId,
                            title,
                            body,
                            info: info ?? null,
                            case: "ADMIN_MESSAGE",
                            isGlobal,
                        })),
                    });
                }
            },
            { timeout: 30000 }
        );

        res.status(201).json({
            success: true,
            message: "Notification sent successfully",
            data: {
                batchId,
                count: userIds.length,
                isGlobal,
            },
        });
    });


    // @desc    Delete notification batch
    // @route   DELETE /notifications/:batchId
    // @access  Private
    deleteNotificationBatch = asyncHandler(async (req, res, next) => {
        const { batchId } = req.params;

        const { count } = await prisma.notification.deleteMany({
            where: { batchId },
        });

        if (count === 0) {
            return next(new ApiError("Notification batch not found", 404));
        }

        res.status(200).json({
            success: true,
            message: "Notification deleted successfully",
            data: { deletedCount: count },
        });
    });


}

module.exports = new NotificationController()