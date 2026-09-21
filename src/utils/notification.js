const notificationModel = require("../model/notification.model");

/**
 * Create a notification and push it over socket.io in real-time.
 *
 */
const createNotification = async ({
	userId,
	type,
	title,
	body = "",
	from = null,
	link = "",
	meta = {},
}) => {
	try {
		const notification = await notificationModel.create({
			user: userId,
			type,
			title,
			body,
			from,
			link,
			meta,
		});

		// Push via socket.io — each user joins a personal room on connect
		try {
			const { getIO } = require("../socket/socket");
			const io = getIO?.();
			if (io) {
				io.to(`user:${userId.toString()}`).emit(
					"notification:new",
					notification.toObject()
				);
			}
		} catch (socketErr) {
			// Non-fatal — notification is persisted, socket push just failed
			console.warn(
				"Notification socket push failed:",
				socketErr.message
			);
		}

		return notification.toObject();
	} catch (err) {
		console.error("createNotification error:", err);
		return null;
	}
};

module.exports = { createNotification };