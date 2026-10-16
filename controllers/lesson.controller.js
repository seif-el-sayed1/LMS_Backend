const prisma = require('../startup/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('express-async-handler');
const BunnyService = require("../services/bunny.service");
const R2Service = require("../services/cloudflare.r2.service");
const { ADMIN, SUPER_ADMIN } = require("../utils/constants");

class LessonController {

    // @desc   Create a new lesson
    // @route  POST /lessons/:sectionId
    // @access Private
    createLesson = asyncHandler(async (req, res, next) => {
        const { sectionId } = req.params;
        const { title, description, isPreview } = req.body;

        if (!title) return next(new ApiError("Title is required", 400));

        const existingSection = await prisma.section.findFirst({
            where: { id: sectionId, isDeleted: false }
        });

        if (!existingSection) {
            return next(new ApiError("Section not found", 404));
        }

        const lastLesson = await prisma.lesson.findFirst({
            where: { sectionId, isDeleted: false },
            orderBy: { order: "desc" }
        });

        const nextOrder = lastLesson ? lastLesson.order + 1 : 1;

        const attachmentKeys = await R2Service.uploadAttachments(req.files?.attachments);
        const bunnyVideo = await BunnyService.createVideo(title);

        const lesson = await prisma.lesson.create({
            data: {
                title,
                description,
                attachments: attachmentKeys,
                isPreview,
                order: nextOrder,
                sectionId,
                bunnyVideoId: bunnyVideo.guid,
                videoStatus: "UPLOADING"
            }
        });

        res.status(201).json({
            success: true,
            message: "Lesson created successfully",
            data: {
                lesson: {
                    ...lesson,
                    attachments: await R2Service.getAttachmentLinks(lesson.attachments)
                },
                upload: BunnyService.signUpload(bunnyVideo.guid)
            }
        });
    });

    // @desc   Update a lesson
    // @route  PATCH /api/lessons/:id
    // @access Private
    updateLesson = asyncHandler(async (req, res, next) => {
        const { id } = req.params;
        const { title, description, attachmentKeysToDelete, isPreview } = req.body;

        const existingLesson = await prisma.lesson.findFirst({
            where: { id, isDeleted: false }
        });

        if (!existingLesson) {
            return next(new ApiError("Lesson not found", 404));
        }

        let updatedAttachments = existingLesson.attachments;

        const keysToDelete = attachmentKeysToDelete
            ? [].concat(attachmentKeysToDelete)
            : [];

        if (keysToDelete.some((key) => !existingLesson.attachments.includes(key))) {
            return next(new ApiError("Invalid attachment key", 400));
        }

        updatedAttachments = updatedAttachments.filter(
            (key) => !keysToDelete.includes(key)
        );

        const newKeys = await R2Service.uploadAttachments(req.files?.attachments);
        updatedAttachments = [...updatedAttachments, ...newKeys];

        const lesson = await prisma.lesson.update({
            where: { id },
            data: {
                title,
                description,
                attachments: updatedAttachments,
                isPreview
            }
        });

        await Promise.all(keysToDelete.map(R2Service.deleteAttachment));

        res.status(200).json({
            success: true,
            message: "Lesson updated successfully",
            data: {
                ...lesson,
                attachments: await R2Service.getAttachmentLinks(lesson.attachments)
            }
        });
    });
    
    // @desc   Delete a lesson 
    // @route  DELETE /lessons/:id
    // @access Private
    deleteLesson = asyncHandler(async (req, res, next) => {
        const { id } = req.params;

        const existingLesson = await prisma.lesson.findFirst({
            where: { id, isDeleted: false } 
        });

        if (!existingLesson) {
            return next(new ApiError("Lesson not found", 404));
        }

        await prisma.lesson.update({
            where: { id },
            data: { isDeleted: true }
        });

        res.status(200).json({
            success: true,
            message: "Lesson deleted successfully"
        });
    });

    // @desc   Handle Bunny webhook callback
    // @route  POST /lessons/bunny-callback
    // @access Public
    bunnyCallback = asyncHandler(async (req, res, next) => {
        const rawBody = req.rawBody || req.body;

        if (!BunnyService.verifyWebhookSignature(rawBody, req.headers)) {
            return next(new ApiError("Invalid signature", 401));
        }

        const { VideoGuid, Status } = typeof req.body === 'object' ? req.body : JSON.parse(rawBody.toString("utf8"));

        if (Status === 3) {
            let duration;
            try {
                const video = await BunnyService.getVideo(VideoGuid);
                duration = Math.round(video.length);
            } catch (err) {
                console.error("Failed to fetch video metadata:", err.message);
            }

            await prisma.lesson.updateMany({
                where: { bunnyVideoId: VideoGuid },
                data: {
                    videoStatus: "READY",
                    ...(duration ? { duration } : {})
                }
            });
        } else if (Status === 5) {
            await prisma.lesson.updateMany({
                where: { bunnyVideoId: VideoGuid },
                data: { videoStatus: "FAILED" }
            });
        } else if ([0, 1, 2, 4].includes(Status)) {
            await prisma.lesson.updateMany({
                where: { bunnyVideoId: VideoGuid, videoStatus: { not: "READY" } },
                data: { videoStatus: "PROCESSING" }
            });
        }

        res.sendStatus(200);
    });


    // @desc   Get lesson video URL
    // @route  GET /lessons/:courseId/:lessonId/video
    // @access Public (with optional authentication)
    getLessonVideo = asyncHandler(async (req, res, next) => {
        const { courseId, lessonId } = req.params;

        const lesson = await prisma.lesson.findFirst({
            where: {
                id: lessonId,
                isDeleted: false,
                section: {
                    courseId,
                    isDeleted: false,
                    course: { isPublished: true, isDeleted: false },
                },
            },
            select: { bunnyVideoId: true, videoStatus: true, isPreview: true },
        });

        if (!lesson) return next(new ApiError("Lesson not found", 404));

        const isAdmin = [ADMIN, SUPER_ADMIN].includes(req.role);
        let allowed = isAdmin || lesson.isPreview;

        if (!allowed && req.user) {
            const enrollment = await prisma.enrollment.findUnique({
                where: { userId_courseId: { userId: req.user.id, courseId } },
                select: { id: true },
            });
            allowed = !!enrollment;
        }

        if (!allowed) return next(new ApiError("You are not enrolled in this course", 403));

        if (lesson.videoStatus !== "READY") {
            return next(new ApiError("Video is still processing", 409));
        }

        const { url, expiresAt } = BunnyService.getSignedEmbedUrl(lesson.bunnyVideoId);

        res.status(200).json({
            success: true,
            data: { url, expiresAt },
        });
    });

}

module.exports = new LessonController();