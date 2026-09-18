const bcrypt = require("bcryptjs")

const userModel = require("../model/user.model")
const imagekit = require("../utils/imagekit")
const {sendOtpEmail} = require('../utils/mailer')

/* GET PROFILE — returns all user data (safe fields) */
const getProfile = async (req, res) => {
  try {
    const user = await userModel
      .findById(req.user._id)
      .select("-password -OTP -OTPexpires -profileImageFileId");

    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    return res.status(200).json({
      message: "Profile fetched",
      success: true,
      user,
    });
  } catch (error) {
    console.error("getProfile error:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/* UPDATE PROFILE (name, bio, profession) */
const updateProfile = async (req, res) => {
  try {
    const { name, bio, profession } = req.body;

    const user = await userModel.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    // --- validate & apply each field only if provided ---
    if (name !== undefined) {
      if (name.trim().length < 3) {
        return res.status(400).json({
          message: "Name must be at least 3 characters",
          success: false,
        });
      }
      user.name = name.trim();
    }

    if (bio !== undefined) {
      if (bio.length > 200) {
        return res.status(400).json({
          message: "Bio can't exceed 200 characters",
          success: false,
        });
      }
      user.bio = bio;
    }

    if (profession !== undefined) {
      if (profession.trim().length > 50) {
        return res.status(400).json({
          message: "Name must be at least 3 characters",
          success: false,
        });
      }
      user.profession = profession.trim();
    }

    await user.save();

    return res.status(200).json({
      message: "Profile updated successfully",
      success: true,
    });
  } catch (error) {
    console.error("updateProfile error:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/* UPDATE PROFILE IMAGE (ImageKit) */
const updateProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No image file provided",
        success: false,
      });
    }

    const user = await userModel
      .findById(req.user._id)
      .select("+profileImageFileId");

    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    // delete old image from ImageKit if it exists
    if (user.profileImageFileId) {
      try {
        await imagekit.deleteFile(user.profileImageFileId);
      } catch (delErr) {
        console.warn("ImageKit delete failed:", delErr.message);
      }
    }

    // upload new image
    const uploadRes = await imagekit.upload({
      file: req.file.buffer,
      fileName: `avatar-${user._id}-${Date.now()}`,
      folder: "/meetup/avatars",
      useUniqueFileName: true,
      transformation: {
        pre: "w-400,h-400,c-maintain_ratio,fo-face",
      },
    });

    user.profileImage = uploadRes.url;
    user.profileImageFileId = uploadRes.fileId;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      message: "Profile image updated",
      success: true,
      profileImage: uploadRes.url,
    });
  } catch (error) {
    console.error("updateProfileImage error:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/* UPDATE EMAIL — step 1 (request change + send OTP)
   body: { newEmail, password } */
const requestEmailUpdate = async (req, res) => {
  try {
    const { newEmail, password } = req.body;

    if (!newEmail || !password) {
      return res.status(400).json({
        message: "New email and password are required",
        success: false,
      });
    }

    if (!/\S+@\S+\.\S+/.test(newEmail)) {
      return res.status(400).json({
        message: "Invalid email address",
        success: false,
      });
    }

    const user = await userModel
      .findById(req.user._id)
      .select("+password +OTP +OTPexpires");

    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    // verify password
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(400).json({
        message: "Incorrect password",
        success: false,
      });
    }

    // new email already in use by someone else?
    const normalized = newEmail.toLowerCase().trim();
    if (normalized === user.email) {
      return res.status(400).json({
        message: "New email is the same as current email",
        success: false,
      });
    }

    const taken = await userModel.findOne({ email: normalized });
    if (taken) {
      return res.status(400).json({
        message: "Email already in use",
        success: false,
      });
    }

    user.email = normalized;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      message: "Email changed successfully",
      success: true,
    });
  } catch (error) {
    console.error("requestEmailUpdate error:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/* UPDATE PASSWORD (with current password)
   body: { currentPassword, newPassword, confirmPassword }*/
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: "All password fields are required",
        success: false,
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters",
        success: false,
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: "Passwords do not match",
        success: false,
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        message: "New password must be different from current password",
        success: false,
      });
    }

    const user = await userModel.findById(req.user._id).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return res.status(400).json({
        message: "Current password is incorrect",
        success: false,
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      message: "Password updated successfully",
      success: true,
    });
  } catch (error) {
    console.error("updatePassword error:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updateProfileImage,
  requestEmailUpdate,
  updatePassword,
};