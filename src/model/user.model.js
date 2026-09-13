const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			minlength: [3, "user name must be at least 3 characters"],
			trim: true,
		},

		username: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
			minlength: [3, "username must be at least 3 characters"],
		},

		email: {
			type: String,
			required: [true, "Enter a valid email address"],
			unique: true,
			lowercase: true,
			trim: true,
		},

		password: {
			type: String,
			required: true,
			minlength: [6, "Password must be at least 6 characters"],
			select: false,
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

		OTPexpires: {
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
			maxlength: [200, "Bio can't exceed 200 characters"],
		},

		lastLogin: {
			type: Date,
		},
	},
	{ timestamps: true },
);

const userModel = mongoose.model("user", userSchema);

module.exports = userModel;
