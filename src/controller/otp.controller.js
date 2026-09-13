const userModel = require("../model/user.model");
const { sendOtpEmail } = require("../utils/mailer");

const sendOtp = async (req, res) => {
  try {
    const {email} = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000); // 6 digits

    user.OTP = otp;
    user.OTPexpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await user.save({ validateBeforeSave: false });

    await sendOtpEmail(user.email, otp);

    return res.status(200).json({
      message: "OTP sent to your email",
      success: true,
    });
  } catch (error) {
    console.error("sendOtp error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      success: false,
    });
  }
};


const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    // OTP & OTPexpires have select:false, so pick them explicitly
    const user = await userModel
      .findOne({ email })
      .select("+OTP +OTPexpires");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    if (!user.OTP || !user.OTPexpires) {
      return res.status(400).json({ message: "No OTP requested" });
    }

    if (user.OTPexpires < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    if (user.OTP !== Number(otp)) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    user.isVerified = true;
    user.emailStatus = "VERIFIED";
    user.OTP = undefined;
    user.OTPexpires = undefined;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      message: "Email verified successfully",
      success: true,
    });
  } catch (error) {
    console.error("verifyOtp error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      success: false,
    });
  }
};

module.exports = { sendOtp, verifyOtp };