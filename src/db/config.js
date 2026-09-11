const mongoose = require("mongoose");

const connectDB = async () => {
	mongoose
		.connect(process.env.MONGO_URI)
		.then((conn) => {
			console.log("mongoDB connected successfully");
		})
		.catch((err) => {
			console.error("Database connection error : ", err.messsage);
			process.exit(1);
		});
};

module.exports = connectDB;
