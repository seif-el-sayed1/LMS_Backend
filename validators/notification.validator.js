const Joi = require("joi");
const asyncHandler = require("express-async-handler");
const joiErrorHandler = require("./joiErrorHandler");


class NotificationValidator {

    
    valiadteSendNotificationByAdmin = asyncHandler(async (req, res, next) => {
        const schema = Joi.object({
            title: Joi.string().trim().min(2).max(150).required().messages({
                "any.required": "Title is required",
                "string.empty": "Title cannot be empty",
                "string.min": "Title must be at least 2 characters long",
                "string.max": "Title cannot exceed 150 characters",
            }),

            body: Joi.string().trim().min(2).max(1000).required().messages({
                "any.required": "Body is required",
                "string.empty": "Body cannot be empty",
                "string.min": "Body must be at least 2 characters long",
                "string.max": "Body cannot exceed 1000 characters",
            }),

            info: Joi.string().trim().min(2).max(500).optional().messages({
                "string.min": "Info must be at least 2 characters long",
                "string.max": "Info cannot exceed 500 characters",
            }),

            isGlobal: Joi.boolean().default(false),

            users: Joi.when("isGlobal", {
                is: true,
                then: Joi.forbidden().messages({
                    "any.unknown": "Users are not allowed for global notifications",
                }),
                otherwise: Joi.array()
                    .items(Joi.string().uuid())
                    .min(1)
                    .max(1000)
                    .required()
                    .messages({
                        "any.required": "Users are required",
                        "array.min": "At least one user is required",
                        "array.max": "Cannot send to more than 1000 users at once",
                        "string.guid": "Each user ID must be a valid UUID",
                    }),
            }),
        });

        joiErrorHandler(schema, req);
        next();
    });
}

module.exports = new NotificationValidator();