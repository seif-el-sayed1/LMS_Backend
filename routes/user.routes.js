const express = require("express");

const { USER, ADMIN, SUPER_ADMIN } = require("../utils/constants");

// Middlewares
const { protect, allowedTo } = require("../middlewares/auth.middleware");

// Classes
const UserController = require("../controllers/user.controller");
const UserValidator = require("../validators/user.validator");
// Router
const router = express.Router();

// User Routes

router
    .route("/")
    .get(
        protect,
        allowedTo(SUPER_ADMIN, ADMIN),
        UserController.getAllUsers
    )
router
    .route("/me")
    .get(
        protect,
        allowedTo(USER),
        UserController.getMyProfile
    ).patch(
        protect,
        allowedTo(USER),
        UserValidator.validateUpdateUser,
        UserController.updateMyProfile
    )

router.route("/:id").get(
    protect,
    allowedTo(SUPER_ADMIN, ADMIN),
    UserController.getOneUser
)

module.exports = router;