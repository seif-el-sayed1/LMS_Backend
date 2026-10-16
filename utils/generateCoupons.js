const crypto = require("crypto");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generateCoupons = (length = 8) =>
    Array.from({ length }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join("");

module.exports = { generateCoupons };