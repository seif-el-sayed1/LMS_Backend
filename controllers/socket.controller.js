const prisma = require("../startup/db");



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


}

module.exports = new SocketController();
