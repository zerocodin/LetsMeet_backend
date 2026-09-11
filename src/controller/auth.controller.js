const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userModel = require("../model/user.model");
const getToken = require("../utils/getToken");

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

module.exports = {
	userRegister,
};
