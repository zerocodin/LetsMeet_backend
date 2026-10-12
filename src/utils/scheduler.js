const { checkUpcomingMeetings } = require("./reminder");

const SCAN_INTERVAL_MS = 60_000; // every 60 seconds

let timer = null;

/**
 * Start the background scheduler.
 * Safe to call multiple times — only one interval runs.
 */
const startScheduler = () => {
	if (timer) {
		console.log("⏰ Scheduler already running");
		return;
	}

	// Run once immediately on boot (catches meetings already in window)
	checkUpcomingMeetings().catch((err) =>
		console.error("Initial reminder scan failed:", err)
	);

	// Then run every minute
	timer = setInterval(() => {
		checkUpcomingMeetings().catch((err) =>
			console.error("Scheduled reminder scan failed:", err)
		);
	}, SCAN_INTERVAL_MS);

	console.log("⏰ Reminder scheduler started (every 60s)");
};

/**
 * Stop the scheduler (for graceful shutdown / tests).
 */
const stopScheduler = () => {
	if (timer) {
		clearInterval(timer);
		timer = null;
		console.log("⏰ Reminder scheduler stopped");
	}
};

module.exports = { startScheduler, stopScheduler };