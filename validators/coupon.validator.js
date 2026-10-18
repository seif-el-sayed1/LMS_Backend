const Joi = require("joi");
const asyncHandler = require("express-async-handler");
const joiErrorHandler = require("./joiErrorHandler");
const { COUPON_TYPES } = require("../utils/constants");

class CouponValidator {

    validateCreateCoupon = asyncHandler(async (req, res, next) => {
        const schema = Joi.object({
            code: Joi.string().trim().min(3).max(32).allow("", null).messages({
                "string.min": "Coupon code must be at least 3 characters",
                "string.max": "Coupon code cannot exceed 32 characters",
            }),

            type: Joi.string().valid(...COUPON_TYPES).required().messages({
                "any.required": "Coupon type is required",
                "any.only": `Coupon type must be one of: ${COUPON_TYPES.join(", ")}`,
            }),

            value: Joi.when("type", {
                switch: [
                    {
                        is: "PERCENT",
                        then: Joi.number().integer().min(1).max(100).required().messages({
                            "any.required": "Discount percentage is required for PERCENT type",
                            "number.min": "Discount percentage must be at least 1%",
                            "number.max": "Discount percentage cannot exceed 100%",
                        }),
                    },
                    {
                        is: "FIXED",
                        then: Joi.number().integer().min(1).required().messages({
                            "any.required": "Discount amount is required for FIXED type",
                            "number.min": "Discount amount must be at least 1",
                        }),
                    },
                ],
                otherwise: Joi.forbidden().messages({
                    "any.unknown": "Value should not be provided for FULL_ACCESS type",
                }),
            }),

            maxUses: Joi.number().integer().min(1).allow(null).messages({
                "number.min": "Max uses must be at least 1",
            }),

            perUserLimit: Joi.number().integer().min(1).default(1).messages({
                "number.min": "Per user limit must be at least 1",
            }),

            startsAt: Joi.date().iso().allow(null).messages({
                "date.format": "Start date must be a valid ISO date",
            }),

            expiresAt: Joi.date().iso().min("now").allow(null)
                .when("startsAt", {
                    is: Joi.date().required(),
                    then: Joi.date().greater(Joi.ref("startsAt")),
                })
                .messages({
                    "date.format": "Expiry date must be a valid ISO date",
                    "date.min": "Expiry date must be in the future",
                    "date.greater": "Expiry date must be after start date",
                }),

            isActive: Joi.boolean(),

            courseId: Joi.string().uuid().required().messages({
                "any.required": "Course ID is required",
                "string.guid": "Course ID must be a valid UUID",
            }),
        });

        joiErrorHandler(schema, req);
        next();
    });

    validateUpdateCoupon = asyncHandler(async (req, res, next) => {
        const schema = Joi.object({
            code: Joi.string().trim().min(3).max(32).messages({
                "string.min": "Coupon code must be at least 3 characters",
                "string.max": "Coupon code cannot exceed 32 characters",
                "string.empty": "Coupon code cannot be empty",
            }),
            value: Joi.number().integer().min(1).messages({
                "number.min": "Value must be at least 1",
            }),
            maxUses: Joi.number().integer().min(1).allow(null).messages({
                "number.min": "Max uses must be at least 1",
            }),
            perUserLimit: Joi.number().integer().min(1).messages({
                "number.min": "Per user limit must be at least 1",
            }),
            startsAt: Joi.date().iso().allow(null).messages({
                "date.format": "Start date must be a valid ISO date",
            }),
            expiresAt: Joi.date().iso().allow(null).messages({
                "date.format": "Expiry date must be a valid ISO date",
            }),
            isActive: Joi.boolean(),
        })
            .min(1)
            .messages({
                "object.min": "At least one field must be provided to update",
                "object.unknown": "This field cannot be updated",
            });

        joiErrorHandler(schema, req);
        next();
    });

    validateCheckCoupon = asyncHandler(async (req, res, next) => {
        const schema = Joi.object({
            code: Joi.string().trim().min(3).max(32).required().messages({
                "any.required": "Coupon code is required",
                "string.empty": "Coupon code cannot be empty",
                "string.min": "Coupon code must be at least 3 characters",
                "string.max": "Coupon code cannot exceed 32 characters",
            }),
            courseId: Joi.string().uuid().required().messages({
                "any.required": "Course ID is required",
                "string.guid": "Course ID must be a valid UUID",
            }),
        });

        joiErrorHandler(schema, req);
        next();
    });

    validateBulkCoupons = asyncHandler(async (req, res, next) => {
        const schema = Joi.object({
            count: Joi.number().integer().min(1).max(500).required().messages({
                "any.required": "Count is required",
                "number.min": "Count must be at least 1",
                "number.max": "Count cannot exceed 500 per request",
            }),

            type: Joi.string().valid(...COUPON_TYPES).required().messages({
                "any.required": "Coupon type is required",
                "any.only": `Coupon type must be one of: ${COUPON_TYPES.join(", ")}`,
            }),

            value: Joi.when("type", {
                switch: [
                    {
                        is: "PERCENT",
                        then: Joi.number().integer().min(1).max(100).required().messages({
                            "any.required": "Discount percentage is required for PERCENT type",
                            "number.min": "Discount percentage must be at least 1%",
                            "number.max": "Discount percentage cannot exceed 100%",
                        }),
                    },
                    {
                        is: "FIXED",
                        then: Joi.number().integer().min(1).required().messages({
                            "any.required": "Discount amount is required for FIXED type",
                            "number.min": "Discount amount must be at least 1",
                        }),
                    },
                ],
                otherwise: Joi.forbidden().messages({
                    "any.unknown": "Value should not be provided for FULL_ACCESS type",
                }),
            }),

            maxUses: Joi.number().integer().min(1).allow(null).messages({
                "number.min": "Max uses must be at least 1",
            }),

            perUserLimit: Joi.number().integer().min(1).default(1).messages({
                "number.min": "Per user limit must be at least 1",
            }),

            startsAt: Joi.date().iso().allow(null).messages({
                "date.format": "Start date must be a valid ISO date",
            }),

            expiresAt: Joi.date().iso().min("now").allow(null)
                .when("startsAt", {
                    is: Joi.date().required(),
                    then: Joi.date().greater(Joi.ref("startsAt")),
                })
                .messages({
                    "date.format": "Expiry date must be a valid ISO date",
                    "date.min": "Expiry date must be in the future",
                    "date.greater": "Expiry date must be after start date",
                }),

            isActive: Joi.boolean(),

            courseId: Joi.string().uuid().required().messages({
                "any.required": "Course ID is required",
                "string.guid": "Course ID must be a valid UUID",
            }),
        });

        joiErrorHandler(schema, req);
        next();
    });
}

module.exports = new CouponValidator();
