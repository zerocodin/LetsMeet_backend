const mongoose = require("mongoose");
const crypto = require("crypto");

const meetingSchema = new mongoose.Schema(
	{
		// Identity
		title: {
			type: String,
			required: [true, "Meeting title is required"],
			trim: true,
			maxlength: [100, "Title can't exceed 100 characters"],
		},

		description: {
			type: String,
			trim: true,
			maxlength: [500, "Description can't exceed 500 characters"],
			default: "",
		},

		meetingCode: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},

		meetingLink: {
			type: String,
			required: true,
		},

		password: {
			type: String,
			select: false,
			default: null,
		},

		// Ownership
		host: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
			required: true,
			index: true,
		},

		invitedUsers: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "user",
			},
		],

		// Timing
		scheduledAt: {
			type: Date,
			required: true,
			index: true,
		},

		duration: {
			type: Number,
			default: 60,
			min: [1, "Duration must be at least 1 minute"],
		},

		startedAt: {
			type: Date,
			default: null,
		},

		endedAt: {
			type: Date,
			default: null,
		},

		// Status
		status: {
			type: String,
			enum: ["SCHEDULED", "ONGOING", "COMPLETED", "CANCELLED"],
			default: "SCHEDULED",
			index: true,
		},

		// Access Control
		allowEarlyJoin: { type: Boolean, default: true },
		isPrivate: { type: Boolean, default: false },
		waitingRoomEnabled: { type: Boolean, default: false },

		maxParticipants: {
			type: Number,
			default: 100,
		},

		// Extra Features
		isRecording: {
			type: Boolean,
			default: false,
		},

		recordingUrl: {
			type: String,
			default: "",
			select: false,
		},

		isRecurring: {
			type: Boolean,
			default: false,
		},

		recurrenceRule: {
			type: String,
			default: null,
		},
	},
	{ timestamps: true },
);

// Indexes
meetingSchema.index({ host: 1, scheduledAt: -1 });

// Auto-generate meetingCode + meetingLink
meetingSchema.pre("validate", function (next) {
	if (!this.meetingCode) {
		this.meetingCode = generateMeetingCode();
	}
	if (!this.meetingLink && this.meetingCode) {
	
		const baseUrl = process.env.FRONTEND_URI || "http://localhost:3000";
		this.meetingLink = `${baseUrl}/meeting/${this.meetingCode}`;
	}
});

function generateMeetingCode() {
	const part = () => crypto.randomBytes(3).toString("hex").slice(0, 3);
	return `${part()}-${part()}-${part()}`;
}

const meetingModel = mongoose.model("meeting", meetingSchema);

module.exports = meetingModel;