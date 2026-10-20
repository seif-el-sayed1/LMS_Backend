const crypto = require("crypto");
const axios = require("axios");
const prisma = require("../startup/db");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/ApiError");
const ApiFeatures = require("../utils/ApiFeatures");

class PaymentClass {
  async createClientSecretKey(course, user, couponData = null) {
    const originalPrice = Number(
      course.hasDiscount ? course.priceAfterDiscount : course.price
    );

    const finalPrice = couponData
      ? couponData.pricing.finalPrice
      : originalPrice;

    const amount = Math.round(finalPrice * 100);

    const items = [
      {
        name: "Course Fees",
        description: "It's Course Fees",
        quantity: 1,
        amount,
      },
    ];

    const requestBody = {
      amount,
      currency: "EGP",
      payment_methods: [Number(process.env.PAYMOB_INTEGRATION_ID)],

      items,

      billing_data: {
        first_name: user.fullName.split(" ")[0],
        last_name: user.fullName.split(" ")[1] || "",
        email: user.email || "undefined@email.com",
        phone_number: user.phone || "NA",
        apartment: 1,
        floor: 1,
        street: 1,
        building: 1,
        city: user.governmentId?.name || "NA",
        state: user.region?.name || "NA",
        country: "Egypt",
        postal_code: "NA",
        promoCodeApplied: "NA",
      },

      customer: {
        first_name: user.fullName.split(" ")[0],
        last_name: user.fullName.split(" ")[1] || "",
        email: user.email || "undefined@email.com",
        extras: { re: "22" },
      },

      extras: { ee: 22 },
    };

    let response;
    try {
      response = await axios.post(
        "https://accept.paymob.com/v1/intention/",
        requestBody,
        { headers: { Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}` } }
      );
    } catch (err) {
      console.error("Paymob error:", JSON.stringify(err.response?.data, null, 2));
      const e = new Error(
        "Paymob: " + JSON.stringify(err.response?.data ?? err.message)
      );
      e.status = 400;
      throw e;
    }

    const transaction = await prisma.payment.create({
      data: {
        courseId: course.id,
        orderCode: String(response.data.intention_order_id),
        userId: user.id,
        couponId: couponData?.coupon.id ?? null,
        amount: originalPrice,
        billedAmount: finalPrice,
        currency: "EGP",
        status: "PENDING",
        clientSecret: response.data.client_secret,
      },
    });

    return { transaction, clientSecret: response.data.client_secret };
  }

  async callBack(req, res) {
    try {
      if (!process.env.PAYMOB_HMAC_SECRET) {
        return res
          .status(500)
          .json({ success: false, message: "Server misconfigured" });
      }

      const receivedHmac = req.query.hmac || req.headers["x-hmac-sha512"];
      const transactionData = req.body?.obj;

      if (!receivedHmac || !transactionData) {
        return res.status(400).json({
          success: false,
          message: "Invalid callback data",
        });
      }

      if (!/^[a-fA-F0-9]{128}$/.test(receivedHmac)) {
        return res.status(401).json({
          success: false,
          message: "Invalid HMAC",
        });
      }

      const hmacFields = [
        transactionData.amount_cents,
        transactionData.created_at,
        transactionData.currency,
        transactionData.error_occured,
        transactionData.has_parent_transaction,
        transactionData.id,
        transactionData.integration_id,
        transactionData.is_3d_secure,
        transactionData.is_auth,
        transactionData.is_capture,
        transactionData.is_refunded,
        transactionData.is_standalone_payment,
        transactionData.is_voided,
        transactionData.order?.id,
        transactionData.owner,
        transactionData.pending,
        transactionData.source_data?.pan,
        transactionData.source_data?.sub_type,
        transactionData.source_data?.type,
        transactionData.success,
      ]
        .map((value) => value ?? "")
        .join("");

      const calculatedHmac = crypto
        .createHmac("sha512", process.env.PAYMOB_HMAC_SECRET)
        .update(hmacFields)
        .digest("hex");

      const receivedBuffer = Buffer.from(receivedHmac, "hex");
      const calculatedBuffer = Buffer.from(calculatedHmac, "hex");

      if (!crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)) {
        return res.status(401).json({
          success: false,
          message: "Invalid HMAC",
        });
      }

      const status =
        transactionData.success === true &&
        transactionData.pending === false &&
        transactionData.error_occured === false
          ? "SUCCESS"
          : transactionData.pending === true
          ? "PENDING"
          : "FAILED";

      const orderCode = String(transactionData.order?.id ?? "");

      if (!orderCode) {
        return res.status(400).json({
          success: false,
          message: "Missing Paymob order ID",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { orderCode },
          include: {
            course: {
              select: {
                id: true,
                title: true,
              },
            },
            user: {
              select: {
                id: true,
                lang: true,
              },
            },
          },
        });

        if (!payment) return { ignored: "PAYMENT_NOT_FOUND" };
        if (payment.status === "SUCCESS") return { ignored: "ALREADY_PROCESSED" };

        if (
          status === "SUCCESS" &&
          (Number(transactionData.amount_cents) !==
            Math.round(Number(payment.billedAmount) * 100) ||
            transactionData.currency !== payment.currency)
        ) {
          return { ignored: "AMOUNT_OR_CURRENCY_MISMATCH" };
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status,
            cardNum: transactionData.source_data?.pan ?? null,
            cardType: transactionData.source_data?.sub_type ?? null,
            currency: transactionData.currency ?? payment.currency,
          },
        });

        if (status === "SUCCESS") {
          await tx.enrollment.upsert({
            where: {
              userId_courseId: {
                userId: payment.userId,
                courseId: payment.courseId,
              },
            },
            update: {},
            create: {
              userId: payment.userId,
              courseId: payment.courseId,
              paymentId: payment.id,
            },
          });

          if (payment.couponId) {
            await tx.coupon.update({
              where: { id: payment.couponId },
              data: { usedCount: { increment: 1 } },
            });

            await tx.couponRedemption.create({
              data: {
                couponId: payment.couponId,
                userId: payment.userId,
                courseId: payment.courseId,
                paymentId: payment.id,
                originalPrice: payment.amount,
                discountAmount: payment.amount.sub(payment.billedAmount),
                finalPrice: payment.billedAmount,
              },
            });
          }

          const courseTitle = payment.course?.title || "";

          await tx.notification.create({
            data: {
              userId: payment.userId,
              title: "Payment Confirmed & Enrolled! 🎉",
              body: `Your payment was confirmed and you are now enrolled in ${courseTitle}. Happy learning!`,
              case: "PAYMENT_SUCCESS",
              info: payment.courseId,
              isGlobal: false,
            },
          });
        }

        return { ignored: null };
      });

      if (result.ignored) {
        console.error("Paymob callback ignored:", result.ignored, { orderCode });
      }

      return res.status(200).json({
        success: true,
        message: "Callback processed",
        status,
      });
    } catch (error) {
      console.error("Paymob callback error:", error);
      return res.status(500).json({
        success: false,
        message: "Callback processing failed",
      });
    }
  }

  // @desc Get all payments
  // @route GET /api/v1/payments
  // @access Private
  getAllPayments = asyncHandler(async (req, res) => {
    const apiFeatures = new ApiFeatures(
      prisma.payment,
      req.query,
      "Payment",
      {
        select: {
          id: true,
          courseId: true,
          userId: true,
          couponId: true,
          orderCode: true,
          amount: true,
          billedAmount: true,
          cardNum: true,
          cardType: true,
          currency: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          course: {
            select: { id: true, title: true, slug: true },
          },
          user: {
            select: { id: true, fullName: true, phone: true, studentCode: true },
          },
          coupon: {
            select: { id: true, code: true },
          },
        },
      }
    )
      .search()
      .filter()
      .sort()
      .paginate();

    await apiFeatures.calculatePagination();
    const payments = await apiFeatures.execute();

    res.status(200).json({
      success: true,
      message: "Payments fetched successfully",
      pagination: apiFeatures.paginationResult,
      results: payments.length,
      data: payments,
    });
  });

  // @desc    Get logged in user payments
  // @route   GET /api/v1/payments/me
  // @access  Private
  getMyPayments = asyncHandler(async (req, res) => {
    const apiFeatures = new ApiFeatures(
      prisma.payment,
      req.query,
      "Payment",
      {
        where: { userId: req.user.id },
        select: {
          id: true,
          courseId: true,
          userId: true,
          couponId: true,
          orderCode: true,
          amount: true,
          billedAmount: true,
          cardNum: true,
          cardType: true,
          currency: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          course: {
            select: { id: true, title: true, slug: true },
          },
          coupon: {
            select: { id: true, code: true },
          },
        },
      }
    )
      .search()
      .filter()
      .sort()
      .paginate();

    apiFeatures.prismaArgs.where.userId = req.user.id;
    await apiFeatures.calculatePagination();
    const payments = await apiFeatures.execute();

    res.status(200).json({
      success: true,
      message: "Payments fetched successfully",
      pagination: apiFeatures.paginationResult,
      results: payments.length,
      data: payments,
    });
  });

  // @desc    Get payment by id
  // @route   GET /api/v1/payments/:id
  // @access  Private
  getPaymentById = asyncHandler(async (req, res, next) => {
    const payment = await prisma.payment.findFirst({
      where: {
        id: req.params.id,
        ...(req.role === "USER" ? { userId: req.user.id } : {}),
      },
      select: {
        id: true,
        courseId: true,
        userId: true,
        couponId: true,
        orderCode: true,
        amount: true,
        billedAmount: true,
        cardNum: true,
        cardType: true,
        currency: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        course: {
          select: { id: true, title: true, slug: true },
        },
        user: {
          select: { id: true, fullName: true, phone: true, studentCode: true },
        },
        coupon: {
          select: { id: true, code: true },
        },
      },
    });

    if (!payment) {
      return next(new ApiError("Payment not found", 404));
    }

    res.status(200).json({
      success: true,
      message: "Payment fetched successfully",
      data: payment,
    });
  });

}

module.exports = new PaymentClass();