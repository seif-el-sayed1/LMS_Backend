const asycnHandler = require("express-async-handler");
const prisma = require("../startup/db");
const ApiFeatures = require("../utils/ApiFeatures");
class UserController {

    // @desc    Get all users
    // @route   GET /api/v1/users
    // @access  Private (ADMIN, SUPER_ADMIN)
    getAllUsers = asycnHandler(async (req, res) => {
        const apiFeatures = new ApiFeatures(
            prisma.user,
            req.query,
            "User",
            {
                select: {
                    id: true,
                    fullName: true,
                    phone: true,
                    parentPhone: true,
                    level: true,
                    studentCode: true,
                    studyMode: true,
                    budget: true,
                    role: true,
                    isVerified: true,
                    isActive: true,
                    isBlocked: true,
                    createdAt: true,
                    government: {
                        select: { id: true, name: true },
                    },
                    groupe: {
                        select: { id: true, name: true, day: true, time: true },
                    },
                },
            }
        )
            .search()
            .filter()
            .sort()
            .paginate();

        await apiFeatures.calculatePagination();
        const users = await apiFeatures.execute();

        res.status(200).json({
            success: true,
            message: "Users fetched successfully",
            pagination: apiFeatures.paginationResult,
            results: users.length,
            data: users,
        });
    });

    // @desc    Get my profile
    // @route   GET /api/v1/users/me
    // @access  Private (User)
    getMyProfile = asycnHandler(async (req, res) => {
        const user = await prisma.user.findUnique({
            where: {
                id: req.user.id,
            },
            select: {
                id: true,
                studyMode: true,
                class: true,
                parentPhone: true,
                fullName: true,
                phone: true,
                lang: true
            }
        });
        res.status(200).json({
            success: true,
            data: user,
        });
    });

    // @desc    Update my profile
    // @route   PATCH /api/v1/users/me
    // @access  Private (User)
    updateMyProfile = asycnHandler(async (req, res) => {
        const { fullName, phone } = req.body;
        const user = await prisma.user.update({
            where: {
                id: req.user.id,
            },
            select: {
                id: true,
                studyMode: true,
                class: true,
                parentPhone: true,
                fullName: true,
                phone: true,
                lang: true
            },
            data: {
                fullName,
                phone,
            }
        });
        res.status(200).json({
            success: true,
            data: user,
        });
    });

    // @desc get one user 
    // @route GET /api/v1/users/:id
    // @access Private 
    getOneUser = asycnHandler(async (req, res, next) => {
        const userId = req.params.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                studyMode: true,
                class: true,
                parentPhone: true,
                fullName: true,
                phone: true,
                lang: true
            }
        });
        res.status(200).json({
            success: true,
            data: user,
        });
    });

}

module.exports = new UserController();