const express = require("express");
const router = express.Router();

const authController = require("../controller/auth.controller");

const protect  = require("../middleware/auth.middleware");

// unprotected routes
router.post("/register", authController.userRegister);
router.delete("/delete-1", authController.deleteUnverifiedUser);
router.post("/login", authController.userLogin);
router.put("/reset-password", authController.resetPassword);

// protected routes
router.post("/logout", protect.protect, authController.userLogout);
router.get("/me", protect.protect, authController.getMe); // change later
router.delete("/delete-2", protect.protect ,authController.deleteVerifiedUser);


module.exports = router;