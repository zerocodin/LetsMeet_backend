const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
			required: true,
			index: true,
		},
		type: {
			type: String,
			enum: [
				"FRIEND_REQUEST",
				"FRIEND_ACCEPTED",
				"FRIEND_REJECTED",
				"MEETING_INVITE",
				"MEETING_STARTING",
				"MEETING_ENDED",
				"MEETING_CANCELLED",
				"SYSTEM",
			],
			required: true,
			index: true,
		},
		title: {
			type: String,
			required: true,
			trim: true,
			maxlength: 150,
		},
		body: {
			type: String,
			trim: true,
			maxlength: 500,
			default: "",
		},
		// Who triggered it (friend requester, meeting host, etc.)
		from: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
			default: null,
		},
		// Optional deep link on the frontend: "/friends", "/meeting/abc-def-123", etc.
		link: {
			type: String,
			default: "",
		},
		// Extra data — e.g. { meetingId, requestId } for actions
		meta: {
			type: mongoose.Schema.Types.Mixed,
			default: {},
		},
		isRead: {
			type: Boolean,
			default: false,
			index: true,
		},
		readAt: {
			type: Date,
			default: null,
		},
	},
	{ timestamps: true }
);

// Common query: "unread notifications, newest first"
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

const notificationModel = mongoose.model("notification", notificationSchema);

module.exports = notificationModel;