const mongoose = require("mongoose");

/**
 * A single contiguous period a user was in the meeting.
 * Each join creates a new session. Rejoining after leaving = new session.
 */
const sessionSchema = new mongoose.Schema(
	{
		joinedAt: {
			type: Date,
			required: true,
			default: Date.now,
		},
		leftAt: {
			type: Date,
			default: null,
		},
	},
	{ _id: false }
);

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

		// joinedAt = current session &  leftAt = null if active, else when left
		// When a user rejoins, these are updated to the new session.

		joinedAt: {
			type: Date,
			default: Date.now,
		},
		leftAt: {
			type: Date,
			default: null,
		},

		// Full history of sessions  
		sessions: {
			type: [sessionSchema],
			default: [],
		},

		isMuted: { type: Boolean, default: true },
		isCameraOff: { type: Boolean, default: true },
		isScreenSharing: { type: Boolean, default: false },
	},
	{ timestamps: true }
);

// A user can only have ONE participant record per meeting
participantSchema.index({ meeting: 1, user: 1 }, { unique: true });

const participantModel = mongoose.model("participant", participantSchema);

module.exports = participantModel;