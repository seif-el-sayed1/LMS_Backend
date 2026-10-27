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

  // @desc    List chat contacts (users see all admins, admins see all users)
  // @route   GET /chats/contacts
  // @access  Private (USER, ADMIN, SUPER_ADMIN)
  getChatContacts = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const isAdmin = req.role === "ADMIN" || req.role === "SUPER_ADMIN";
    const onlineUsers = req.app.get("onlineUsers");
    const isOnline = (id) => !!(onlineUsers && typeof onlineUsers.has === "function" && onlineUsers.has(id));

    if (isAdmin) {
      const apiFeatures = new ApiFeatures(prisma.user, req.query, "User", {
        where: { isActive: true, isBlocked: false },
        select: { id: true, fullName: true, isActive: true }
      })
        .search()
        .filter()
        .sort()
        .paginate();

      apiFeatures.prismaArgs.where.isActive = true;
      apiFeatures.prismaArgs.where.isBlocked = false;

      await apiFeatures.calculatePagination();
      const users = await apiFeatures.execute();
      const userIds = users.map((u) => u.id);

      const chats = userIds.length
        ? await prisma.chat.findMany({
            where: { adminId: userId, userId: { in: userIds } },
            select: { id: true, userId: true }
          })
        : [];

      const chatByUserId = {};
      for (const chat of chats) chatByUserId[chat.userId] = chat.id;

      return res.status(200).json({
        success: true,
        pagination: apiFeatures.paginationResult,
        data: users.map((user) => ({
          _id: user.id,
          fullName: user.fullName,
          isOnline: isOnline(user.id),
          chatId: chatByUserId[user.id] || null
        }))
      });
    }

    const apiFeatures = new ApiFeatures(prisma.admin, req.query, "Admin", {
      where: { isDeleted: false, isBlocked: false },
      select: { id: true, firstName: true, lastName: true }
    })
      .search()
      .filter()
      .sort()
      .paginate();

    apiFeatures.prismaArgs.where.isDeleted = false;
    apiFeatures.prismaArgs.where.isBlocked = false;

    await apiFeatures.calculatePagination();
    const admins = await apiFeatures.execute();
    const adminIds = admins.map((a) => a.id);

    const chats = adminIds.length
      ? await prisma.chat.findMany({
          where: { userId, adminId: { in: adminIds } },
          select: { id: true, adminId: true }
        })
      : [];

    const chatByAdminId = {};
    for (const chat of chats) chatByAdminId[chat.adminId] = chat.id;

    res.status(200).json({
      success: true,
      pagination: apiFeatures.paginationResult,
      data: admins.map((admin) => ({
        _id: admin.id,
        fullName: `${admin.firstName} ${admin.lastName}`,
        isOnline: isOnline(admin.id),
        chatId: chatByAdminId[admin.id] || null
      }))
    });
  });

  // @desc    Get one chat with recent messages
  // @route   GET /chats/:id
  // @access  Private (USER, ADMIN, SUPER_ADMIN)
  getOneChat = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const role = req.role;
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
    const noOfMessages = parseInt(req.query.noOfMessages) || 10;

    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, fullName: true, isActive: true } },
        admin: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    if (!chat) throw new ApiError("Chat not found", 404);

    // Authorization check
    if (isAdmin && chat.adminId !== userId) throw new ApiError("Not authorized to access this chat", 403);
    if (!isAdmin && chat.userId !== userId) throw new ApiError("Not authorized to access this chat", 403);

    const messages = await prisma.message.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: "desc" },
      take: noOfMessages,
      select: {
        id: true, content: true, type: true, senderId: true,
        isDelivered: true, isRead: true, createdAt: true
      }
    });

    const to = isAdmin
      ? { _id: chat.user.id, fullName: chat.user.fullName, isActive: chat.user.isActive }
      : { _id: chat.admin.id, fullName: `${chat.admin.firstName} ${chat.admin.lastName}` };

    const data = {
      _id: chat.id,
      to,
      messages: messages.map((msg) => ({
        _id: msg.id,
        content: msg.content,
        type: msg.type,
        isDelivered: msg.isDelivered,
        isRead: msg.isRead,
        isMyMsg: msg.senderId === userId,
        createdAt: msg.createdAt
      }))
    };

    res.status(200).json({ success: true, data });
  });


}

module.exports = new ChatController();
