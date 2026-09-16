const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userModel = require("../model/user.model");
const getToken = require("../utils/getToken");

const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
	httpOnly: true,
	secure: isProd ? true : false,
	sameSite: isProd ? "none" : "lax",
	maxAge: 7 * 24 * 60 * 60 * 1000,
	...(isProd && { partitioned: true }),
};

const flagCookieOptions = {
	httpOnly: false,
	secure: isProd ? true : false,
	sameSite: isProd ? "none" : "lax",
	maxAge: 7 * 24 * 60 * 60 * 1000,
	...(isProd && { partitioned: true }),
};

const userRegister = async (req, res) => {
	try {
		const { name, email, username, password } = req.body;

		if (!name || !email || !username || !password) {
			return res.status(400).json({
				message: "All fields are required",
			});
		}

		const isEmailExists = await userModel.findOne({ email });

		if (isEmailExists) {
			return res.status(400).json({
				message: "user already exists",
			});
		}

		const isUsernameExists = await userModel.findOne({ username });

		if (isUsernameExists) {
			return res.status(400).json({
				message: "choose a different username",
			});
		}

		if (password.length < 6) {
			return res.status(400).json({
				message: "Password must be at least 6 characters",
			});
		}

		const hashedPassword = await bcrypt.hash(password, 10);

		const user = await userModel.create({
			name,
			username,
			email,
			password: hashedPassword,
		});

		await user.save();

		return res.status(201).json({
			message: "Verify you email address",
			success: true,
		});
	} catch (error) {
		console.error("Registration error:", error);
		return res.status(500).json({
			message: "Internal server error",
			error: process.env.NODE_ENV === "development" ? error.message : undefined,
			success: false,
		});
	}
};

const userLogin = async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) {
			return res.status(400).json({ message: "Email and password required" });
		}

		const user = await userModel.findOne({ email }).select("+password");

		if (!user) {
			return res.status(400).json({ message: "Invalid credentials" });
		}

		if (user.emailStatus === "REJECTED") {
			return res.status(400).json({
				message: "Email has banned.",
				success: false,
			});
		}

		if (!user.isVerified) {
			return res.status(403).json({
				message: "Please verify your email before logging in",
			});
		}

		const isMatch = await bcrypt.compare(password, user.password);
		if (!isMatch) {
			return res.status(400).json({ message: "Invalid credentials" });
		}

		user.OTP = undefined;
		user.OTPexpires = undefined;
		user.emailStatus = "RUNNING";
		user.lastLogin = new Date();
		await user.save({ validateBeforeSave: false });

		const token = getToken.getUserToken(user._id);

		return res
			.status(200)
			.cookie("token", token, cookieOptions)
			.cookie("logged_in", "1", flagCookieOptions)
			.json({
				message: "Logged in successfully",
				success: true,
			});
	} catch (error) {
		console.error("Login error:", error);
		return res.status(500).json({
			message: "Internal server error",
			error: process.env.NODE_ENV === "development" ? error.message : undefined,
			success: false,
		});
	}
};

const userLogout = async (req, res) => {
	try {
		const user = await userModel.findById(req.user._id);
		if (!user) {
			return res.status(404).json({
				message: "Unauthorized access",
				success: false,
			});
		}

		user.emailStatus = "VERIFIED";
		await user.save();

		return res
			.status(200)
			.clearCookie("token", cookieOptions)
			.clearCookie("logged_in", flagCookieOptions)
			.json({ message: "Logged out successfully", success: true });
	} catch (error) {
		console.error("Logout error:", error);
		return res.status(500).json({
			message: "Internal server error",
			error: process.env.NODE_ENV === "development" ? error.message : undefined,
			success: false,
		});
	}
};

const deleteUnverifiedUser = async (req, res) => {
	try {
		const { email } = req.body;
		if (!email) {
			return res.status(400).json({ message: "Email is required" });
		}

		const user = await userModel.findOne({ email });

		if (!user) {
			return res.status(400).json({ message: "Invalid credentials" });
		}

		if (user.emailStatus !== "INREVIEW") {
			return res.status(400).json({
				message: "Only users in INREVIEW status can be deleted",
			});
		}

		await userModel.findByIdAndDelete(user._id);

		return res
			.status(200)
			.clearCookie("token", cookieOptions)
			.json({ message: "User deleted", success: true });
	} catch (error) {
		console.error("Delete error:", error);
		return res.status(500).json({
			message: "Internal server error",
			error: process.env.NODE_ENV === "development" ? error.message : undefined,
			success: false,
		});
	}
};

const deleteVerifiedUser = async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) {
			return res.status(400).json({ message: "Email and password required" });
		}

		const user = await userModel.findOne({ email }).select("+password");

		if (!user) {
			return res.status(400).json({ message: "Invalid credentials" });
		}

		if (user.emailStatus !== "RUNNING") {
			return res.status(400).json({
				message: "Only RUNNING acoount can be deleted",
			});
		}

		const isMatch = await bcrypt.compare(password, user.password);

		if (!isMatch) {
			return res.status(400).json({ message: "Invalid Password or Email" });
		}

		await userModel.findByIdAndDelete(user._id);

		return res
			.status(200)
			.clearCookie("token", cookieOptions)
			.clearCookie("logged_in", flagCookieOptions)
			.json({ message: "User deleted", success: true });
	} catch (error) {
		console.error("Delete error:", error);
		return res.status(500).json({
			message: "Internal server error",
			error: process.env.NODE_ENV === "development" ? error.message : undefined,
			success: false,
		});
	}
};

const resetPassword = async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password)
			return res.status(400).json({ message: "Email and password required" });

		const user = await userModel.findOne({ email });
		if (!user) return res.status(404).json({ message: "User not found" });

		if (password.length < 6)
			return res
				.status(400)
				.json({ message: "Password must be at least 6 characters" });

		const hashed = await bcrypt.hash(password, 10);
		user.password = hashed;

		await user.save({ validateBeforeSave: false });

		return res
			.status(200)
			.json({ message: "Password reset successfully", success: true });
	} catch (error) {
		console.error("resetPassword error:", error);
		return res
			.status(500)
			.json({ message: "Internal server error", success: false });
	}
};

const getMe = async (req, res) => {
	try {
		const user = await userModel.findById(req.user._id);
		if (!user) {
			return res
				.status(401)
				.json({ message: "User not found", success: false });
		}

		user.emailStatus = "RUNNING";
		await user.save({ validateBeforeSave: false });

		return res.status(200).json({
			message: "Logged in successfully",
			success: true,
		});
	} catch (error) {
		console.error("getMe error:", error);
		return res
			.status(500)
			.json({ message: "Internal server error", success: false });
	}
};

module.exports = {
	userRegister,
	userLogin,
	userLogout,
	deleteUnverifiedUser,
	deleteVerifiedUser,
	resetPassword,
	getMe,
};
