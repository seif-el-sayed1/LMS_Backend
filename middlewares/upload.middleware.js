const multer = require("multer");
const ApiError = require("../utils/ApiError");

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith("image") ||
    file.mimetype === "application/pdf" ||
    file.mimetype === "application/octet-stream"
  )
    cb(null, true);
  else cb(new ApiError("Invalid file type, please upload an image or PDF", 400), false);
};

const filesConfiguration = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const uploadAnyFile = filesConfiguration.fields([
  { name: "image", maxCount: 1 },
  { name: "attachments", maxCount: 5 },
  { name: "chatImages", maxCount: 5 },
]);

module.exports = uploadAnyFile;