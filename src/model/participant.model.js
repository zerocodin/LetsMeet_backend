const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
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
		role: {
			type: String,
			enum: ["HOST", "COHOST", "PARTICIPANT"],
			default: "PARTICIPANT",
		},
		joinedAt: {
			type: Date,
			default: Date.now,
		},
		leftAt: {
			type: Date,
			default: null,
		},
		isMuted: { type: Boolean, default: false },
		isCameraOff: { type: Boolean, default: false },
		isScreenSharing: { type: Boolean, default: false },
	},
	{ timestamps: true }
);

// A user can only have ONE active participant record per meeting
participantSchema.index({ meeting: 1, user: 1 }, { unique: true });

const participantModel = mongoose.model("participant", participantSchema);

module.exports = participantModel;