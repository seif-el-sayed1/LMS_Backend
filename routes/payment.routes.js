const express = require("express");
// Class 
const PaymentController = require("../controllers/payment.controller");
const { protect, allowedTo } = require("../middlewares/auth.middleware");
const { USER, ADMIN, SUPER_ADMIN } = require("../utils/constants");

//Router
const router = express.Router();

router.all("/callback", PaymentController.callBack);

router.get(
  "/",
  protect,
  allowedTo(ADMIN, SUPER_ADMIN),
  PaymentController.getAllPayments
);

router.get(
  "/me",
  protect,
  allowedTo(USER),
  PaymentController.getMyPayments
);

router.get(
  "/:id",
  protect,
  allowedTo(USER, ADMIN, SUPER_ADMIN),
  PaymentController.getPaymentById
);

module.exports = router;
