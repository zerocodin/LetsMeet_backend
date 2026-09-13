const express = require("express");

const otpController = require("../controller/otp.controller");

const router = express.Router();

router.post("/send", otpController.sendOtp);
router.post("/verify", otpController.verifyOtp);

module.exports = router