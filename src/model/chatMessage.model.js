const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
	{
		meeting: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "meeting",
			required: true,
			index: true,
		},
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
			required: true,
			index: true,
		},
		// Snapshot of user info at time of send (name/avatar can change later)
		senderName: {
			type: String,
			required: true,
			trim: true,
		},
		senderUsername: {
			type: String,
			required: true,
			trim: true,
		},
		senderProfileImage: {
			type: String,
			default: "",
		},
		message: {
			type: String,
			required: true,
			trim: true,
			maxlength: [1000, "Message can't exceed 1000 characters"],
		},
		// Soft-delete flag so we don't lose audit trail
		isDeleted: {
			type: Boolean,
			default: false,
			select: false,
		},
		// Optional: system messages ("X joined", "Y left")
		type: {
			type: String,
			enum: ["USER", "SYSTEM"],
			default: "USER",
		},
	},
	{ timestamps: true }
);

// Fast lookup: get all messages for a meeting, newest first
chatMessageSchema.index({ meeting: 1, createdAt: -1 });

const chatMessageModel = mongoose.model("chatMessage", chatMessageSchema);

module.exports = chatMessageModel;