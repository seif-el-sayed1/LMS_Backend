const express = require("express");
// Class 
const PaymentController = require("../controllers/payment.controller");

//Router
const router = express.Router();

router.all("/callback", PaymentController.callBack);

module.exports = router;
