const asyncHandler = require("express-async-handler");
const prisma = require("../startup/db");
const ApiFeatures = require("../utils/ApiFeatures");
const ApiError = require("../utils/ApiError");
const R2Service = require("../services/cloudflare.r2.service");
const SocketController = require("./socket.controller");

class ChatController {

  // @desc    Get my chats (for both user and admin)
  // @route   GET /chats
  // @access  Private (USER, ADMIN, SUPER_ADMIN)
  getMyChats = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const role = req.role;
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

    // Build where clause based on role
    const where = isAdmin ? { adminId: userId } : { userId };

    // Get chats with last message included
    const apiFeatures = new ApiFeatures(prisma.chat, req.query, "Chat", {
      where,
      include: {
        user: { select: { id: true, fullName: true, isActive: true } },
        admin: { select: { id: true, firstName: true, lastName: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: true,
            type: true,
            senderType: true,
            isDelivered: true,
            isRead: true,
            createdAt: true,
            senderId: true
          }
        }
      }
    }).sort().paginate();

    await apiFeatures.calculatePagination();
    const chats = await apiFeatures.execute();

    // Get unread counts for all chats in a single batch query
    const chatIds = chats.map((c) => c.id);
    const unreadCounts = await prisma.message.groupBy({
      by: ["chatId"],
      where: {
        chatId: { in: chatIds },
        NOT: { senderId: userId },
        isRead: false
      },
      _count: { id: true }
    });

    const unreadMap = {};
    for (const row of unreadCounts) {
      unreadMap[row.chatId] = row._count.id;
    }

    // Mark messages as delivered (for messages sent to this user)
    await prisma.message.updateMany({
      where: {
        chatId: { in: chatIds },
        NOT: { senderId: userId },
        isDelivered: false
      },
      data: { isDelivered: true }
    });

    // Transform response
    const data = chats.map((chat) => {
      const lastMessage = chat.messages[0] || null;
      const to = isAdmin
        ? { _id: chat.user.id, fullName: chat.user.fullName, isActive: chat.user.isActive }
        : { _id: chat.admin.id, fullName: `${chat.admin.firstName} ${chat.admin.lastName}` };

      return {
        _id: chat.id,
        to,
        lastMessage: lastMessage ? {
          _id: lastMessage.id,
          content: lastMessage.content,
          type: lastMessage.type,
          isDelivered: lastMessage.isDelivered,
          isRead: lastMessage.isRead,
          isMyMsg: lastMessage.senderId === userId,
          createdAt: lastMessage.createdAt
        } : null,
        unreadMessagesCount: unreadMap[chat.id] || 0,
        lastMessageCreatedAt: lastMessage?.createdAt || chat.createdAt
      };
    });

    // Sort by last message date (most recent first)
    data.sort((a, b) => new Date(b.lastMessageCreatedAt) - new Date(a.lastMessageCreatedAt));

    res.status(200).json({
      success: true,
      pagination: apiFeatures.paginationResult,
      data
    });
  });

}

module.exports = new ChatController();
