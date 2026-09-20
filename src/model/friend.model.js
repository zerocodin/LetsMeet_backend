const mongoose = require("mongoose");

const friendRequestSchema = new mongoose.Schema(
	{
		from: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
			required: true,
			index: true,
		},
		to: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
			required: true,
			index: true,
		},
		status: {
			type: String,
			enum: ["PENDING", "ACCEPTED", "REJECTED", "BLOCKED"],
			default: "PENDING",
			index: true,
		},
		message: {
			type: String,
			maxlength: 200,
			default: "",
		},
		respondedAt: {
			type: Date,
			default: null,
		},
	},
	{ timestamps: true }
);

// One request per pair (from → to). Reverse direction is a separate doc.
friendRequestSchema.index({ from: 1, to: 1 }, { unique: true });
// Fast lookups of "my pending incoming"
friendRequestSchema.index({ to: 1, status: 1, createdAt: -1 });

const friendRequestModel = mongoose.model("friendRequest", friendRequestSchema);

module.exports = friendRequestModel;