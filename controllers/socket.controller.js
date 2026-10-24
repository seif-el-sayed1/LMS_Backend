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

}

module.exports = new SocketController();
