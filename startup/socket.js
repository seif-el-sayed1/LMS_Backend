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

module.exports.chatRoomUsers = chatRoomUsers;
module.exports.getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};
