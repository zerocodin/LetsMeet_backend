const express = require("express");
const router = express.Router();
const {
	getMyNotifications,
	getUnreadCount,
	markAsRead,
	markAllAsRead,
	deleteNotification,
	clearRead,
} = require("../controller/notification.controller");
const { protect } = require("../middleware/auth.middleware");

// static paths before :id
router.get("/", protect, getMyNotifications);
router.get("/unread-count", protect, getUnreadCount);
router.patch("/read-all", protect, markAllAsRead);
router.delete("/clear-read", protect, clearRead);
router.patch("/:id/read", protect, markAsRead);
router.delete("/:id", protect, deleteNotification);

module.exports = router;