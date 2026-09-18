const express = require("express");
const router = express.Router();

const userController = require("../controller/user.controller");
const protect  = require("../middleware/auth.middleware");
const { upload } = require("../middleware/upload.middleware");

// All user routes require a valid JWT
router.use(protect.protect);

// get profile
router.get("/me", userController.getProfile);

// update text fields (name, username, profession)
router.patch("/me", userController.updateProfile);

// update profile image
router.patch(
	"/me/avatar",
	upload.single("avatar"),
	userController.updateProfileImage,
);

// update email — 2-step
router.post("/me/email/request", userController.requestEmailUpdate);

// update password
router.patch("/me/password", userController.updatePassword);

module.exports = router;
