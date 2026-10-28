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

  // @desc    Get chat messages (paginated)
  // @route   GET /chats/:id/messages
  // @access  Private (USER, ADMIN, SUPER_ADMIN)
  getChatMessages = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.role;
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

    const chat = await prisma.chat.findUnique({ where: { id } });
    if (!chat) throw new ApiError("Chat not found", 404);

    // Authorization check
    if (isAdmin && chat.adminId !== userId) throw new ApiError("Not authorized to access this chat", 403);
    if (!isAdmin && chat.userId !== userId) throw new ApiError("Not authorized to access this chat", 403);

    const apiFeatures = new ApiFeatures(prisma.message, req.query, "Message", { where: { chatId: id } })
      .search()
      .filter()
      .sort()
      .paginate();

    await apiFeatures.calculatePagination();
    const messages = await apiFeatures.execute({
      select: {
        id: true, senderId: true, content: true, type: true,
        isDelivered: true, isRead: true, createdAt: true
      }
    });

    // Transform messages
    const data = messages.map((msg) => ({
      _id: msg.id,
      content: msg.content,
      type: msg.type,
      isDelivered: msg.senderId === userId ? msg.isDelivered : true,
      isRead: msg.senderId === userId ? msg.isRead : true,
      isMyMsg: msg.senderId === userId,
      createdAt: msg.createdAt
    }));

    // Mark all messages from others as delivered & read
    await prisma.message.updateMany({
      where: {
        chatId: id,
        NOT: { senderId: userId }
      },
      data: { isDelivered: true, isRead: true }
    });

    res.status(200).json({
      success: true,
      totalResults: data.length,
      pagination: apiFeatures.paginationResult,
      data
    });
  });

  // @desc    Send media message (images via R2)
  // @route   POST /chats/media
  // @access  Private (USER, ADMIN, SUPER_ADMIN)
  sendMediaMessage = asyncHandler(async (req, res, next) => {
    try {
      const userId = req.user.id;
      const role = req.role;
      const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
      const senderType = isAdmin ? "ADMIN" : "USER";
      const { chatId, adminId: targetAdminId } = req.body;
      const files = req.files?.chatImages || [];

      if (files.length === 0) throw new ApiError("No images provided", 400);

      let chat;
      let firstMsg = false;

      if (chatId && !targetAdminId) {
        // Send to existing chat
        chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat) throw new ApiError("Chat not found", 404);
        if (isAdmin && chat.adminId !== userId) throw new ApiError("Not authorized", 403);
        if (!isAdmin && chat.userId !== userId) throw new ApiError("Not authorized", 403);

      } else if (targetAdminId && !chatId && !isAdmin) {
        const admin = await prisma.admin.findFirst({
          where: { id: targetAdminId, isDeleted: false, isBlocked: false }
        });
        if (!admin) throw new ApiError("Admin not found", 404);

        chat = await prisma.chat.findUnique({
          where: { userId_adminId: { userId, adminId: targetAdminId } }
        });
        if (!chat) {
          chat = await prisma.chat.create({
            data: { userId, adminId: targetAdminId }
          });
          firstMsg = true;
        }

      } else if (!chatId && isAdmin) {
        const { userId: targetUserId } = req.body;
        if (!targetUserId) throw new ApiError("Please provide chatId or userId", 400);

        const user = await prisma.user.findFirst({
          where: { id: targetUserId, isActive: true, isBlocked: false }
        });
        if (!user) throw new ApiError("User not found", 404);

        chat = await prisma.chat.findUnique({
          where: { userId_adminId: { userId: targetUserId, adminId: userId } }
        });
        if (!chat) {
          chat = await prisma.chat.create({
            data: { userId: targetUserId, adminId: userId }
          });
          firstMsg = true;
        }

      } else {
        throw new ApiError("Please provide either chatId or target user/admin id", 400);
      }

      // Upload images to R2
      const uploadedUrls = await Promise.all(
        files.map((file) => R2Service.uploadChatImage(file))
      );

      // Get receiver info for socket events
      const receiverId = isAdmin ? chat.userId : chat.adminId;
      const io = req.app.get("socketio");
      const onlineUsers = req.app.get("onlineUsers");
      const { chatRoomUsers } = require("../startup/socket");

      const receiverIsOnline = !!(onlineUsers && receiverId && (
        typeof onlineUsers.has === "function"
          ? onlineUsers.has(receiverId)
          : Array.isArray(onlineUsers)
            ? onlineUsers.includes(receiverId)
            : false
      ));
      const receiverInRoom = SocketController.isUserInChatRoom(chatRoomUsers, chat.id, receiverId);

      // Create messages in DB
      const messages = [];
      for (const url of uploadedUrls) {
        const msg = await prisma.message.create({
          data: {
            chatId: chat.id,
            senderId: userId,
            senderType,
            content: url,
            type: "image",
            isDelivered: receiverInRoom || receiverIsOnline,
            isRead: receiverInRoom
          }
        });
        messages.push(msg);
      }

      const [userParticipant, adminParticipant] = await Promise.all([
        prisma.user.findUnique({
          where: { id: chat.userId },
          select: { id: true, fullName: true, isActive: true }
        }),
        prisma.admin.findUnique({
          where: { id: chat.adminId },
          select: { id: true, firstName: true, lastName: true }
        })
      ]);

      if (!userParticipant || !adminParticipant) {
        throw new ApiError("Chat participant not found", 404);
      }

      const senderDisplayName = req.user.fullName || `${req.user.firstName} ${req.user.lastName}`;
      const userTo = {
        _id: userParticipant.id,
        fullName: userParticipant.fullName,
        isActive: userParticipant.isActive
      };
      const adminTo = {
        _id: adminParticipant.id,
        fullName: `${adminParticipant.firstName} ${adminParticipant.lastName}`
      };

      messages.forEach((newMessage, index) => {
        SocketController.emitMessageToParticipants(io, {
          chat,
          message: newMessage,
          senderId: userId,
          senderDisplayName,
          userTo,
          adminTo,
          firstMsg: firstMsg && index === 0,
          receiverId,
          receiverInRoom,
          receiverIsOnline
        });
      });

      // Create DB notification if admin sends to user
      if (senderType === "ADMIN" && !receiverInRoom) {
        await prisma.notification.create({
          data: {
            title: "New message",
            body: "You received new image(s)",
            case: "chat",
            info: chat.id,
            userId: chat.userId,
            adminId: chat.adminId
          }
        });
      }

      // Format response
      const formatMsg = (msg) => ({
        _id: msg.id,
        chatId: msg.chatId,
        content: msg.content,
        type: msg.type,
        isMyMsg: true,
        isDelivered: receiverInRoom || receiverIsOnline,
        isRead: receiverInRoom,
        createdAt: msg.createdAt
      });

      res.status(201).json({
        success: true,
        chat: firstMsg ? {
          _id: chat.id,
          to: isAdmin ? userTo : adminTo,
          messages: messages.map(formatMsg),
          unreadMessagesCount: 0,
        } : undefined,
        messages: firstMsg ? undefined : messages.map(formatMsg),
      });

    } catch (error) {
      // Rollback uploaded images on error
      if (req._uploadedChatUrls && req._uploadedChatUrls.length > 0) {
        await Promise.allSettled(
          req._uploadedChatUrls.map((url) => R2Service.deleteChatImage(url))
        );
      }
      next(error);
    }
  });

}

module.exports = new ChatController();
