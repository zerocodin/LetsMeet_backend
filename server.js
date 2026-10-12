const dotenv = require("dotenv");
const express = require("express");

dotenv.config();

const app = require("./src/app");
const connectDB = require("./src/db/config");
const { startScheduler, stopScheduler } = require("./src/utils/scheduler");

connectDB();

startScheduler();

process.on("SIGINT", () => {
	console.log("\n🛑 Shutting down...");
	stopScheduler();
	process.exit(0);
});

process.on("SIGTERM", () => {
	stopScheduler();
	process.exit(0);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log("Server is running");
});
