const ApiError = require("../utils/ApiError");
const capitalizeFirstLetter = require("../utils/capitalizeFirstLetter");
const { translate } = require("../utils/translation");
const { Prisma } = require("@prisma/client");

const sendErrorForDev = (err, res, lang) => {
  res.status(err.statusCode).json({
    success: err.success || false,
    message: err.message || translate("Something went wrong", lang),
    stack: err.stack,
  });
};

const sendErrorForProd = (err, res, lang) => {
  if (!err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: translate("Something went wrong", lang),
    });
  } else {
    res.status(err.statusCode).json({
      success: err.success || false,
      message: err.message,
    });
  }
};

const extractFieldFromCause = (cause) => {
  if (!cause) return null;

  if (cause.constraint?.fields?.length) return cause.constraint.fields[0];

  if (cause.constraint?.columns?.length) return cause.constraint.columns[0];

  if (cause.constraint?.index) {
    const parts = cause.constraint.index.split("_");
    return parts.length > 2 ? parts[parts.length - 2] : parts[0];
  }

  if (cause.column) return cause.column;
  if (cause.field) return cause.field;

  if (cause.originalMessage) {
    const match = cause.originalMessage.match(/"([^"]+)"/g);
    const constraintName = match?.[0]?.replace(/"/g, "");
    if (constraintName) {
      const parts = constraintName.split("_");
      return parts.length > 2 ? parts[parts.length - 2] : parts[0];
    }
  }

  return null;
};

const handleDuplicatedFieldsDB = (err, lang) => {
  const cause = err.meta?.driverAdapterError?.cause;
  const target = err.meta?.target;
  const targetStr = Array.isArray(target) ? target.join(",") : String(target || "");

  const isDuplicateEnrollment =
    (targetStr.includes("userId") && targetStr.includes("courseId")) ||
    (cause?.constraint?.fields?.includes("userId") &&
      cause?.constraint?.fields?.includes("courseId")) ||
    cause?.constraint?.index === "Enrollment_userId_courseId_key";

  if (isDuplicateEnrollment) {
    return new ApiError(
      translate("You are already enrolled in this course", lang),
      400
    );
  }

  const duplicateKey =
    extractFieldFromCause(cause) ||
    (Array.isArray(target) ? target[0] : target) ||
    "field";

  const alreadyUsed = translate("is already used", lang);
  const fieldName = capitalizeFirstLetter(translate(duplicateKey, lang));
  return new ApiError(`${fieldName} ${alreadyUsed}`, 400);
};

const handleRecordNotFound = (err, lang) => {
  const message = translate("Record not found", lang);
  return new ApiError(message, 404);
};

const handleForeignKeyConstraint = (err, lang) => {
  const cause = err.meta?.driverAdapterError?.cause;
  const field = extractFieldFromCause(cause) || err.meta?.field_name || "field";
  const message = `${translate("Invalid relation", lang)}: ${translate(field, lang)}`;
  return new ApiError(message, 400);
};

const handleValueTooLong = (err, lang) => {
  const cause = err.meta?.driverAdapterError?.cause;
  const field = extractFieldFromCause(cause) || err.meta?.column_name || "field";
  const fieldName = capitalizeFirstLetter(translate(field, lang));
  const message = `${fieldName} ${translate("value is too long", lang)}`;
  return new ApiError(message, 400);
};

const handleNullConstraint = (err, lang) => {
  const cause = err.meta?.driverAdapterError?.cause;
  const field = extractFieldFromCause(cause) || err.meta?.constraint || "field";
  const fieldName = capitalizeFirstLetter(translate(field, lang));
  const message = `${fieldName} ${translate("is required", lang)}`;
  return new ApiError(message, 400);
};

const handleRelationViolation = (err, lang) => {
  const message = translate("Invalid relation data", lang);
  return new ApiError(message, 400);
};

const handleValidationError = (err, lang) => {
  const invalidData = translate("Invalid Input Data", lang);
  const shortMessage = err.message.split("\n").filter(Boolean).pop() || err.message;
  return new ApiError(`${invalidData}: ${shortMessage}`, 400);
};

const handleDriverAdapterError = (err, lang) => {
  const message = err.message || "";

  if (message.includes("violates RESTRICT setting") || message.includes("violates foreign key constraint")) {
    return new ApiError(translate("Cannot delete this record because it has related data", lang), 400);
  }

  return new ApiError(translate("Something went wrong", lang), 500);
};

const handleInvalidJwtSignature = (lang) =>
  new ApiError(translate("Invalid token, Please login again ...", lang), 401);

const handleJwtExpired = (lang) =>
  new ApiError(translate("Expired token, Please login again ...", lang), 401);

const globalError = (err, req, res, next) => {
  const lang = req.headers?.lang?.toLowerCase() || "en";

  err.success = err.success || false;
  err.statusCode = err.statusCode || 500;

  let error = err;
  error.message = err.message;

  // JWT Errors
  if (err.name === "JsonWebTokenError") error = handleInvalidJwtSignature(lang);
  if (err.name === "TokenExpiredError") error = handleJwtExpired(lang);

  // Driver Adapter Errors (RESTRICT, FK violations from pg driver)
  if (err.name === "DriverAdapterError" || err.constructor?.name === "DriverAdapterError") {
    error = handleDriverAdapterError(err, lang);
  }

  // Prisma Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") error = handleDuplicatedFieldsDB(err, lang);
    if (err.code === "P2025") error = handleRecordNotFound(err, lang);
    if (err.code === "P2003") error = handleForeignKeyConstraint(err, lang);
    if (err.code === "P2000") error = handleValueTooLong(err, lang);
    if (err.code === "P2011") error = handleNullConstraint(err, lang);
    if (err.code === "P2014") error = handleRelationViolation(err, lang);
  }

  // Prisma Validation Error
  if (err instanceof Prisma.PrismaClientValidationError) {
    error = handleValidationError(err, lang);
  }

  error.message = translate(error.message, lang);

  if (process.env.NODE_ENV === "development") {
    sendErrorForDev(error, res, lang);
  } else {
    sendErrorForProd(error, res, lang);
  }
};

module.exports = globalError;