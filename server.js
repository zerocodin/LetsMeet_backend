const dotenv = require("dotenv");
const express = require("express");

dotenv.config();

const app = require("./src/app");
const connectDB = require("./src/db/config");

connectDB();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log("Server is running");
});
