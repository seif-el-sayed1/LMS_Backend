const express = require("express");

// Auth middlewares
const { protect, allowedTo } = require("../middlewares/auth.middleware");

// Constants
const { USER, ADMIN, SUPER_ADMIN } = require("../utils/constants");

// Controllers
const ChatController = require("../controllers/chat.controller");

// Router
const router = express.Router();

// Routes — accessible by both users and admins
router.route("/")
  .get(protect, allowedTo(USER, ADMIN, SUPER_ADMIN), ChatController.getMyChats);

router.route("/contacts")
  .get(protect, allowedTo(USER, ADMIN, SUPER_ADMIN), ChatController.getChatContacts);

router.route("/media")
  .post(protect, allowedTo(USER, ADMIN, SUPER_ADMIN), ChatController.sendMediaMessage);

router.route("/:id")
  .get(protect, allowedTo(USER, ADMIN, SUPER_ADMIN), ChatController.getOneChat);

router.route("/:id/messages")
  .get(protect, allowedTo(USER, ADMIN, SUPER_ADMIN), ChatController.getChatMessages);

module.exports = router;