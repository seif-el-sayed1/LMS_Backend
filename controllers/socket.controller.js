const prisma = require("../startup/db");

const addUserToChatRoom = (chatRoomUsers, chatId, userId, socketId) => {
  if (!chatRoomUsers[chatId]) chatRoomUsers[chatId] = {};
  if (!chatRoomUsers[chatId][userId]) chatRoomUsers[chatId][userId] = new Set();
  chatRoomUsers[chatId][userId].add(socketId);
};

const isUserInChatRoom = (chatRoomUsers, chatId, userId) =>
  !!(chatRoomUsers[chatId]?.[userId] && chatRoomUsers[chatId][userId].size > 0);

const isUserOnline = (onlineUsers, userId) => {
  if (!onlineUsers || !userId) return false;
  if (typeof onlineUsers.has === "function") return onlineUsers.has(userId);
  if (Array.isArray(onlineUsers)) return onlineUsers.includes(userId);
  return false;
};

const findOrCreateUserAdminChat = async ({ userId, adminId }) => {
  const existing = await prisma.chat.findUnique({
    where: { userId_adminId: { userId, adminId } }
  });
  if (existing) return { chat: existing, firstMsg: false };

  try {
    const chat = await prisma.chat.create({
      data: { userId, adminId }
    });
    return { chat, firstMsg: true };
  } catch (error) {
    if (error.code === "P2002") {
      const chat = await prisma.chat.findUnique({
        where: { userId_adminId: { userId, adminId } }
      });
      if (chat) return { chat, firstMsg: false };
    }
    throw error;
  }
};

class SocketController {

  isUserInChatRoom = isUserInChatRoom;

  emitMessageToParticipants = (io, {
    chat,
    message,
    senderId,
    senderDisplayName,
    userTo,
    adminTo,
    firstMsg,
    receiverId,
    receiverInRoom,
    receiverIsOnline
  }) => {
    const participants = [chat.userId, chat.adminId];

    for (const participantId of participants) {
      const isMe = participantId === senderId;
      const to = participantId === chat.userId ? adminTo : userTo;

      if (firstMsg) {
        io.to(participantId).emit("new-chat", {
          _id: chat.id,
          to,
          messages: [{
            _id: message.id,
            sender: { _id: senderId, fullName: isMe ? "You" : senderDisplayName },
            receiver: { _id: receiverId },
            content: message.content,
            type: message.type,
            isDelivered: message.isDelivered,
            isRead: message.isRead,
            isMyMsg: isMe,
            createdAt: message.createdAt
          }],
          unreadMessagesCount: isMe ? 0 : 1
        });
      } else {
        io.to(participantId).emit("message", {
          _id: message.id,
          chatId: message.chatId,
          content: message.content,
          type: message.type,
          isDelivered: message.isDelivered,
          isRead: message.isRead,
          isMyMsg: isMe,
          createdAt: message.createdAt
        });
      }

      if (isMe && receiverInRoom) {
        io.to(senderId).emit("messages-seen", {
          chatId: chat.id,
          seenTime: message.createdAt
        });
      } else if (isMe && receiverIsOnline) {
        io.to(senderId).emit("message-delivered", {
          chatId: chat.id,
          messageId: message.id,
          messageTime: message.createdAt
        });
      }
    }
  };

  joinChat = async (io, socket, userData, chatRoomUsers, { chatId }) => {
    try {
      if (!chatId) {
        socket.emit("error", "Chat ID is required");
        return;
      }

      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat || (chat.userId !== userData.id && chat.adminId !== userData.id)) {
        socket.emit("error", "Chat not found or unauthorized");
        return;
      }

      socket.join(chatId);
      addUserToChatRoom(chatRoomUsers, chatId, userData.id, socket.id);

      await prisma.message.updateMany({
        where: {
          chatId,
          NOT: { senderId: userData.id }
        },
        data: {
          isDelivered: true,
          isRead: true
        }
      });

      const otherUserId = chat.userId === userData.id ? chat.adminId : chat.userId;
      if (otherUserId) {
        io.to(otherUserId).emit("messages-seen", {
          chatId,
          seenTime: new Date()
        });
      }
    } catch (error) {
      console.error("Error in joinChat:", error);
      socket.emit("error", "Failed to join chat");
    }
  };

  startTyping = async (socket, userData, { chatId }) => {
    try {
      if (!chatId) {
        socket.emit("error", "Chat ID is required");
        return;
      }

      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat || (chat.userId !== userData.id && chat.adminId !== userData.id)) {
        socket.emit("error", "Chat not found or unauthorized");
        return;
      }

      const otherUserId = chat.userId === userData.id ? chat.adminId : chat.userId;
      const displayName = userData.fullName || userData.firstName || "Admin";
      socket.to(otherUserId).emit("typing", {
        chatId,
        userId: userData.id,
        userName: displayName
      });
    } catch (error) {
      console.error("Error in startTyping:", error);
      socket.emit("error", "Failed to send typing indicator");
    }
  };

  stopTyping = async (socket, userData, { chatId }) => {
    try {
      if (!chatId) {
        socket.emit("error", "Chat ID is required");
        return;
      }

      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat || (chat.userId !== userData.id && chat.adminId !== userData.id)) {
        socket.emit("error", "Chat not found or unauthorized");
        return;
      }

      const otherUserId = chat.userId === userData.id ? chat.adminId : chat.userId;
      const displayName = userData.fullName || userData.firstName || "Admin";
      socket.to(otherUserId).emit("stop-typing", {
        chatId,
        userId: userData.id,
        userName: displayName
      });
    } catch (error) {
      console.error("Error in stopTyping:", error);
      socket.emit("error", "Failed to send stop typing indicator");
    }
  };

  sendChatMessage = async (io, socket, userData, chatRoomUsers, data = {}, onlineUsers) => {
    try {
      let { content, chatId, adminId, userId: targetUserId, type = "text" } = data;
      let firstMsg = false;
      const senderType = userData._senderType;

      if (type !== "text") {
        socket.emit("error", "Only text messages are allowed via socket");
        return;
      }

      if (typeof content !== "string" || !content.trim()) {
        socket.emit("error", "Message content is required");
        return;
      }

      content = content.trim();
      if (content.length > 5000) {
        socket.emit("error", "Message is too long");
        return;
      }

      const hasChatId = !!chatId;
      const hasAdminId = !!adminId;
      const hasTargetUserId = !!targetUserId;

      if ([hasChatId, hasAdminId, hasTargetUserId].filter(Boolean).length !== 1) {
        socket.emit("error", "Provide exactly one of chatId, adminId, or userId");
        return;
      }

      if (hasAdminId && senderType !== "USER") {
        socket.emit("error", "Only users can start a chat with adminId");
        return;
      }

      if (hasTargetUserId && senderType !== "ADMIN") {
        socket.emit("error", "Only admins can start a chat with userId");
        return;
      }

      let chat;

      if (hasAdminId) {
        const admin = await prisma.admin.findFirst({
          where: { id: adminId, isDeleted: false, isBlocked: false }
        });
        if (!admin) {
          socket.emit("error", "Admin not found");
          return;
        }

        const result = await findOrCreateUserAdminChat({
          userId: userData.id,
          adminId
        });
        chat = result.chat;
        firstMsg = result.firstMsg;
        chatId = chat.id;
        socket.join(chatId);
        addUserToChatRoom(chatRoomUsers, chatId, userData.id, socket.id);
      } else if (hasTargetUserId) {
        const user = await prisma.user.findFirst({
          where: { id: targetUserId, isActive: true, isBlocked: false }
        });
        if (!user) {
          socket.emit("error", "User not found");
          return;
        }

        const result = await findOrCreateUserAdminChat({
          userId: targetUserId,
          adminId: userData.id
        });
        chat = result.chat;
        firstMsg = result.firstMsg;
        chatId = chat.id;
        socket.join(chatId);
        addUserToChatRoom(chatRoomUsers, chatId, userData.id, socket.id);
      } else {
        chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat || (chat.userId !== userData.id && chat.adminId !== userData.id)) {
          socket.emit("error", "Chat not found or unauthorized");
          return;
        }
      }

      const receiverId = chat.userId === userData.id ? chat.adminId : chat.userId;
      const receiverIsOnline = isUserOnline(onlineUsers, receiverId);
      const receiverInRoom = isUserInChatRoom(chatRoomUsers, chat.id, receiverId);

      const newMessage = await prisma.message.create({
        data: {
          chatId: chat.id,
          senderId: userData.id,
          senderType,
          content,
          type: "text",
          isDelivered: receiverInRoom || receiverIsOnline,
          isRead: receiverInRoom
        }
      });

      const senderDisplayName = userData.fullName || `${userData.firstName} ${userData.lastName}`;

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
        socket.emit("error", "Chat participant not found");
        return;
      }

      this.emitMessageToParticipants(io, {
        chat,
        message: newMessage,
        senderId: userData.id,
        senderDisplayName,
        userTo: {
          _id: userParticipant.id,
          fullName: userParticipant.fullName,
          isActive: userParticipant.isActive
        },
        adminTo: {
          _id: adminParticipant.id,
          fullName: `${adminParticipant.firstName} ${adminParticipant.lastName}`
        },
        firstMsg,
        receiverId,
        receiverInRoom,
        receiverIsOnline
      });

      if (senderType === "ADMIN" && !receiverInRoom) {
        await prisma.notification.create({
          data: {
            title: "New message",
            body: content.length > 100 ? content.substring(0, 100) + "..." : content,
            case: "chat",
            info: chat.id,
            userId: chat.userId,
            adminId: chat.adminId
          }
        });
      }
    } catch (error) {
      socket.emit("error", { message: error.message });
    }
  };

  messagesDeliveredOnConnect = async (io, socket, userData, chatRoomUsers) => {
    try {
      const whereClause = userData._senderType === "USER"
        ? { userId: userData.id }
        : { adminId: userData.id };

      const chats = await prisma.chat.findMany({
        where: whereClause,
        select: { id: true, userId: true, adminId: true }
      });
      const chatIds = chats.map((chat) => chat.id);

      if (chatIds.length === 0) return;

      const undeliveredMessages = await prisma.message.findMany({
        where: {
          chatId: { in: chatIds },
          NOT: { senderId: userData.id },
          isDelivered: false
        },
        orderBy: { createdAt: "asc" }
      });

      if (undeliveredMessages.length === 0) return;

      const messagesByChatId = {};
      for (const msg of undeliveredMessages) {
        if (!messagesByChatId[msg.chatId]) messagesByChatId[msg.chatId] = [];
        messagesByChatId[msg.chatId].push(msg);
      }

      for (const [chatId, messages] of Object.entries(messagesByChatId)) {
        const isInRoom = isUserInChatRoom(chatRoomUsers, chatId, userData.id);
        const updateData = { isDelivered: true };
        if (isInRoom) updateData.isRead = true;

        await prisma.message.updateMany({
          where: {
            chatId,
            NOT: { senderId: userData.id },
            isDelivered: false
          },
          data: updateData
        });

        const chat = chats.find((c) => c.id === chatId);
        const otherUserId = chat.userId === userData.id ? chat.adminId : chat.userId;

        if (otherUserId) {
          const lastMessage = messages[messages.length - 1];

          io.to(otherUserId).emit("message-delivered", {
            chatId,
            messageId: lastMessage.id,
            messageTime: lastMessage.createdAt
          });

          if (isInRoom) {
            io.to(otherUserId).emit("messages-seen", {
              chatId,
              seenTime: new Date()
            });
          }
        }
      }
    } catch (error) {
      socket.emit("error", { message: error.message });
    }
  };

}

module.exports = new SocketController();
