const jwt = require("jsonwebtoken");
const userModel = require("../model/user.model");

const protect = async (req, res, next) => {
	try {
		const token = req.cookies?.token;

		if (!token) {
			return res.status(401).json({
				message: "No token provided",
				success: false,
			});
		}

		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		const user = await userModel.findById(decoded.userId);

		if (!user) {
			return res.status(401).json({
				message: "User not found",
				success: false,
			});
		}

		req.user = user;

		next();
	} catch (err) {
		return res.status(401).json({
			message: "Invalid or expired token",
			success: false,
		});
	}
};

module.exports = { protect };
