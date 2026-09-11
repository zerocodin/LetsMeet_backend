const mongoose = require("mongoose");

const dataSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
		},

		emailStatus: {
			type: String,
			enum: ["REJECTED", "RUNNING", "INREVIEW", "VERIFIED"],
			default: "INREVIEW",
		},

		OTP: {
			type: Number,
			select: false,
		},

		OTPexprires: {
			type: Date,
			select: false,
		},

		isVerified: {
			type: Boolean,
			default: false,
		},

		profileImage: {
			type: String,
		},

		bio: {
			type: String,
			mixlength: [200, "Bio can't exceed 200 characters"],
		},

		lastLogin: {
			type: Date,
		},
	},
	{ timestamps: true },
);

const userDataModel = mongoose.model("userData", dataSchema);

module.exports = userDataModel;
