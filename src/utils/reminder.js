const meetingModel = require("../model/meeting.model");
const participantModel = require("../model/participant.model");
const { createNotification } = require("./notification");

// How far ahead (in minutes) to fire the reminder
const REMINDER_WINDOW_MINUTES = 5;

// Don't send reminders for meetings happening more than this many minutes from now
const MAX_AHEAD_MINUTES = 6;

/**
 * Scan for meetings starting soon and send MEETING_STARTING notifications.
 * Idempotent — uses reminderSentAt to prevent duplicates.
 *
 * @returns {Promise<number>} number of notifications sent
 */
const checkUpcomingMeetings = async () => {
	try {
		const now = new Date();
		const lookAhead = new Date(
			now.getTime() + MAX_AHEAD_MINUTES * 60 * 1000
		);

		// Meetings to consider:
		//   - status SCHEDULED (not started, not cancelled, not completed)
		//   - scheduledAt is between now and lookAhead
		//   - reminder not already sent
		const candidates = await meetingModel
			.find({
				status: "SCHEDULED",
				scheduledAt: { $gte: now, $lte: lookAhead },
				reminderSentAt: null,
			})
			.select("_id title meetingCode scheduledAt host invitedUsers")
			.lean();

		if (candidates.length === 0) return 0;

		let totalSent = 0;

		for (const meeting of candidates) {
			const minutesUntil = Math.round(
				(meeting.scheduledAt.getTime() - now.getTime()) / 60000
			);

			// Only fire if within the reminder window (0..5 min)
			if (minutesUntil < 0 || minutesUntil > REMINDER_WINDOW_MINUTES) {
				continue;
			}

			// Collect recipients: host + invited users + everyone who already joined (past participants)
			const pastParticipantIds = await participantModel
				.find({ meeting: meeting._id })
				.distinct("user");

			const recipientSet = new Set();
			recipientSet.add(meeting.host.toString());
			meeting.invitedUsers?.forEach((id) =>
				recipientSet.add(id.toString())
			);
			pastParticipantIds.forEach((id) =>
				recipientSet.add(id.toString())
			);

			// Don't notify if meeting is full of nobody — no, still notify
			// Don't notify if the host already marked reminderSentAt
			// (already filtered by query)

			const link = `/meeting/${meeting.meetingCode}`;
			const timeLabel = new Date(meeting.scheduledAt).toLocaleTimeString(
				undefined,
				{ hour: "numeric", minute: "2-digit" }
			);

			// Fire notifications in parallel
			await Promise.all(
				Array.from(recipientSet).map((userId) =>
					createNotification({
						userId,
						type: "MEETING_STARTING",
						title: `"${meeting.title}" starts soon`,
						body: ``,
						from: meeting.host,
						link,
						meta: {
							meetingId: meeting._id.toString(),
							meetingCode: meeting.meetingCode,
							meetingStatus: "SCHEDULED",
							minutesUntil,
							scheduledAt: meeting.scheduledAt.toISOString(),
						},
					})
				)
			);

			// Mark as sent — do this AFTER notifications so a crash doesn't skip a meeting
			await meetingModel.updateOne(
				{ _id: meeting._id },
				{ $set: { reminderSentAt: new Date() } }
			);

			totalSent += recipientSet.size;
		}

		return totalSent;
	} catch (err) {
		console.error("checkUpcomingMeetings error:", err);
		return 0;
	}
};

module.exports = { checkUpcomingMeetings, REMINDER_WINDOW_MINUTES };
