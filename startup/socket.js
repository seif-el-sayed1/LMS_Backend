const jwt = require("jsonwebtoken");
const socketio = require("socket.io");
const prisma = require("./db");

const SocketController = require("../controllers/socket.controller");

const onlineUsers = new Map();
const chatRoomUsers = {};
let io;

const addOnlineUser = (userId, socketId) => {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
};

const removeOnlineUser = (userId, socketId) => {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) onlineUsers.delete(userId);
};

const emitOnlineUsers = () => {
  io.emit("online-users", Array.from(onlineUsers.keys()));
};

const getAuthenticatedUser = async (token) => {
  try {
    if (!token) return { error: "Authentication required" };

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { userId, role } = decoded;

    let currentUser;
    let senderType;

    if (role === "ADMIN" || role === "SUPER_ADMIN") {
      currentUser = await prisma.admin.findUnique({ where: { id: userId } });
      if (!currentUser) return { error: "Admin not found" };
      if (currentUser.token !== token) return { error: "Session expired" };
      if (currentUser.isDeleted) return { error: "Account deleted" };
      if (currentUser.isBlocked) return { error: "Account blocked" };
      senderType = "ADMIN";
    } else if (role === "USER") {
      currentUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!currentUser) return { error: "User not found" };
      if (currentUser.token !== token) return { error: "Session expired" };
      if (!currentUser.isActive) return { error: "Account deactivated" };
      if (currentUser.isBlocked) return { error: "Account blocked" };
      senderType = "USER";
    } else {
      return { error: "Invalid role" };
    }

    if (currentUser.passwordChangedAt) {
      const passwordChangedAtTimestamp = parseInt(currentUser.passwordChangedAt.getTime() / 1000, 10);
      if (passwordChangedAtTimestamp > decoded.iat) {
        return { error: "Password changed, login again" };
      }
    }

    currentUser._senderType = senderType;
    currentUser._role = role;
    return { user: currentUser };
  } catch (error) {
    return { error: "Authentication error" };
  }
};

module.exports = (server, app) => {
  io = socketio(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true }
  });
  app.set("socketio", io);
  app.set("onlineUsers", onlineUsers);

  io.on("connection", async (socket) => {
    try {
      const token = socket.handshake.headers.authorization;
      const { user: userData, error } = await getAuthenticatedUser(token);

      if (error || !userData) {
        socket.emit("error", error || "Authentication error");
        socket.disconnect(true);
        return;
      }

      socket.join(userData.id);
      addOnlineUser(userData.id, socket.id);
      emitOnlineUsers();

      SocketController.messagesDeliveredOnConnect(io, socket, userData, chatRoomUsers);

      socket.on("typing", (data) => SocketController.startTyping(socket, userData, data));
      socket.on("stop-typing", (data) => SocketController.stopTyping(socket, userData, data));
      socket.on("message-delivered", (data) => SocketController.messageDelivered(io, socket, userData, chatRoomUsers, data));
      socket.on("join-chat", (data) => SocketController.joinChat(io, socket, userData, chatRoomUsers, data));
      socket.on("leave-chat", (data) => SocketController.leaveChat(socket, userData, chatRoomUsers, data));
      socket.on("new-message", (data) => SocketController.sendChatMessage(io, socket, userData, chatRoomUsers, data, onlineUsers));

      socket.on("disconnect", () => {
        removeOnlineUser(userData.id, socket.id);
        SocketController.leaveAllChats(socket, userData, chatRoomUsers);
        emitOnlineUsers();
      });
    } catch (error) {
      socket.emit("error", { message: error.message });
      socket.disconnect(true);
    }
  });
};

module.exports.chatRoomUsers = chatRoomUsers;
module.exports.getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};
