const recalculateProgress = async (tx, userId, courseId) => {
    const lessonFilter = {
        isDeleted: false,
        videoStatus: "READY",
        section: { courseId, isDeleted: false },
    };

    const total = await tx.lesson.count({ where: lessonFilter });
    const completed = await tx.lessonProgress.count({
        where: { userId, isCompleted: true, lesson: lessonFilter },
    });

    const progress = total === 0 ? 0 : Math.round((completed / total) * 10000) / 100;
    const isDone = total > 0 && completed >= total;

    const where = { userId_courseId: { userId, courseId } };
    const current = await tx.enrollment.findUnique({
        where,
        select: { completedAt: true },
    });

    return tx.enrollment.update({
        where,
        data: {
            progress,
            completedAt: isDone ? (current.completedAt ?? new Date()) : null,
        },
        select: { progress: true, completedAt: true },
    });
};

module.exports = { recalculateProgress };