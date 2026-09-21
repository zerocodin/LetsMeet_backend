const notificationModel = require("../model/notification.model");

/**
 * @desc    Get my notifications (paginated)
 * @route   GET /api/notifications
 * @access  Private
 * Query:  ?unreadOnly=true&limit=30&before=<ISO>
 */
const getMyNotifications = async (req, res) => {
	try {
		const userId = req.user._id;
		const { unreadOnly, limit = 30, before } = req.query;

		const query = { user: userId };
		if (unreadOnly === "true") query.isRead = false;
		if (before) {
			const d = new Date(before);
			if (!isNaN(d.getTime())) query.createdAt = { $lt: d };
		}

		const cap = Math.min(Number(limit) || 30, 100);

		const [notifications, unreadCount] = await Promise.all([
			notificationModel
				.find(query)
				.populate("from", "name username profileImage")
				.sort({ createdAt: -1 })
				.limit(cap)
				.lean(),
			notificationModel.countDocuments({ user: userId, isRead: false }),
		]);

		return res.status(200).json({
			success: true,
			count: notifications.length,
			unreadCount,
			data: notifications,
		});
	} catch (err) {
		console.error("getMyNotifications error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch notifications",
			error: err.message,
		});
	}
};

/**
 * @desc    Get unread count only (cheap — for the sidebar badge)
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
const getUnreadCount = async (req, res) => {
	try {
		const count = await notificationModel.countDocuments({
			user: req.user._id,
			isRead: false,
		});
		return res.status(200).json({ success: true, count });
	} catch (err) {
		console.error("getUnreadCount error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch count",
			error: err.message,
		});
	}
};

/**
 * @desc    Mark a single notification as read
 * @route   PATCH /api/notifications/:id/read
 */
const markAsRead = async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user._id;

		const notification = await notificationModel.findOneAndUpdate(
			{ _id: id, user: userId },
			{ $set: { isRead: true, readAt: new Date() } },
			{ returnDocument: "after" }
		);

		if (!notification) {
			return res
				.status(404)
				.json({ success: false, message: "Notification not found" });
		}

		return res.status(200).json({ success: true, data: notification });
	} catch (err) {
		console.error("markAsRead error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to update",
			error: err.message,
		});
	}
};

/**
 * @desc    Mark all my notifications as read
 * @route   PATCH /api/notifications/read-all
 */
const markAllAsRead = async (req, res) => {
	try {
		const result = await notificationModel.updateMany(
			{ user: req.user._id, isRead: false },
			{ $set: { isRead: true, readAt: new Date() } }
		);

		return res
			.status(200)
			.json({ success: true, modifiedCount: result.modifiedCount });
	} catch (err) {
		console.error("markAllAsRead error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to update",
			error: err.message,
		});
	}
};

/**
 * @desc    Delete a notification
 * @route   DELETE /api/notifications/:id
 */
const deleteNotification = async (req, res) => {
	try {
		const { id } = req.params;
		const deleted = await notificationModel.findOneAndDelete({
			_id: id,
			user: req.user._id,
		});

		if (!deleted) {
			return res
				.status(404)
				.json({ success: false, message: "Notification not found" });
		}

		return res.status(200).json({ success: true });
	} catch (err) {
		console.error("deleteNotification error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to delete",
			error: err.message,
		});
	}
};

/**
 * @desc    Delete all read notifications
 * @route   DELETE /api/notifications/clear-read
 */
const clearRead = async (req, res) => {
	try {
		const result = await notificationModel.deleteMany({
			user: req.user._id,
			isRead: true,
		});
		return res
			.status(200)
			.json({ success: true, deletedCount: result.deletedCount });
	} catch (err) {
		console.error("clearRead error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to clear",
			error: err.message,
		});
	}
};

module.exports = {
	getMyNotifications,
	getUnreadCount,
	markAsRead,
	markAllAsRead,
	deleteNotification,
	clearRead,
};