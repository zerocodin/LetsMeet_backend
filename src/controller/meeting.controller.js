const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const meetingModel = require("../model/meeting.model");
const participantModel = require("../model/participant.model");

/**
 * @desc    Create a new meeting
 * Body: { title, description?, scheduledAt, duration?, isPrivate?, maxParticipants? }
 */
const createMeeting = async (req, res) => {
	try {
		const {
			title,
			description = "",
			scheduledAt,
			duration = 60,
			isPrivate = false,
			maxParticipants = 100,
			invitedUsers = [],
			password: rawPassword,
			allowEarlyJoin = true,
			waitingRoomEnabled = false,
		} = req.body;

		// Validation
		if (!title || !scheduledAt) {
			return res.status(400).json({
				success: false,
				message: "Title and scheduledAt are required",
			});
		}

		const scheduledDate = new Date(scheduledAt);
		if (isNaN(scheduledDate.getTime())) {
			return res.status(400).json({
				success: false,
				message: "Invalid scheduledAt date format",
			});
		}

		// Meeting can't be scheduled in the past (allow small clock skew of 60s)
		if (scheduledDate.getTime() < Date.now() - 60_000) {
			return res.status(400).json({
				success: false,
				message: "Meeting time must be in the future",
			});
		}

		// Generate meeting code + link
		// Format: abc-defg-hij (Zoom-style)
		const meetingCode = generateUniqueMeetingCode();
		const clientUrl = process.env.FRONTEND_URI || "http://localhost:3000";
		const meetingLink = `${clientUrl}/meeting/${meetingCode}`;

		// Auto generate password
		// const rawPassword = generatePassword();

		// Hash password if provided
		let hashedPassword = null;
		if (rawPassword && rawPassword.trim().length > 0) {
			const salt = await bcrypt.genSalt(10);
			hashedPassword = await bcrypt.hash(rawPassword, salt);
		}

		// Save meeting with host = current user
		const meeting = await meetingModel.create({
			title: title.trim(),
			description: description.trim(),
			meetingCode,
			meetingLink,
			password: hashedPassword,
			host: req.user._id,
			invitedUsers,
			scheduledAt: scheduledDate,
			duration,
			isPrivate,
			allowEarlyJoin,
			waitingRoomEnabled,
			maxParticipants,
			status: "SCHEDULED",
		});

		// Response: return credentials to copy/share
		return res.status(201).json({
			success: true,
			message: "Meeting created successfully",
			data: {
				meetingCode: meeting.meetingCode, // copy to share
				meetingLink: meeting.meetingLink, // copy to share
				password: rawPassword || null,
			},
		});
	} catch (err) {
		console.error("createMeeting error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to create meeting",
			error: err.message,
		});
	}
};

/**
 * Generate a Zoom-style meeting code with collision retry
 * Format: xxx-xxxx-xxx
 */
function generateUniqueMeetingCode() {
	const part = (len) =>
		crypto
			.randomBytes(Math.ceil(len / 2))
			.toString("hex")
			.slice(0, len);

	return `${part(3)}-${part(4)}-${part(3)}`;
}

/**
 * @desc    Get all meetings created by the logged-in user
 *
 * Query: ?status=SCHEDULED|ONGOING|COMPLETED|CANCELLED (optional)
 *        ?page=1&limit=10 (optional pagination)
 */
const getMyMeetings = async (req, res) => {
	try {
		const userId = req.user._id;
		const { status, page = 1, limit = 10 } = req.query;

		const filter = { host: userId };
		if (status) filter.status = status;

		const skip = (Number(page) - 1) * Number(limit);

		// Fetch meetings 
		const [meetings, total] = await Promise.all([
			meetingModel
				.find(filter)
				.sort({ scheduledAt: -1 })
				.skip(skip)
				.limit(Number(limit))
				.lean(),
			meetingModel.countDocuments(filter),
		]);

		// Attach participant counts for each meeting
		const meetingIds = meetings.map((m) => m._id);

		const participantCounts = await participantModel.aggregate([
			{
				$match: {
					meeting: { $in: meetingIds },
					leftAt: null, // active participants only
				},
			},
			{
				$group: {
					_id: "$meeting",
					activeCount: { $sum: 1 },
				},
			},
		]);

		// Total participants ever (including those who left)
		const totalParticipantCounts = await participantModel.aggregate([
			{ $match: { meeting: { $in: meetingIds } } },
			{ $group: { _id: "$meeting", totalCount: { $sum: 1 } } },
		]);

		// Build lookup maps
		const activeMap = Object.fromEntries(
			participantCounts.map((p) => [p._id.toString(), p.activeCount]),
		);
		const totalMap = Object.fromEntries(
			totalParticipantCounts.map((p) => [p._id.toString(), p.totalCount]),
		);

		const enriched = meetings.map((m) => ({
			...m,
			activeParticipants: activeMap[m._id.toString()] || 0,
			totalParticipants: totalMap[m._id.toString()] || 0,
		}));

		return res.status(200).json({
			success: true,
			count: enriched.length,
			total,
			page: Number(page),
			totalPages: Math.ceil(total / Number(limit)),
			data: enriched,
		});
	} catch (err) {
		console.error("getMyMeetings error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch meetings",
			error: err.message,
		});
	}
};

/**
 * @desc    Get detailed info about a single meeting (host or participant)
 */
const getMeetingById = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const userId = req.user._id;

		const meeting = await meetingModel
			.findById(meetingId)
			.populate("host", "name username email profileImage")
			.populate("invitedUsers", "name username email profileImage")
			.lean();

		if (!meeting) {
			return res.status(404).json({
				success: false,
				message: "Meeting not found",
			});
		}

		// Auth check: host OR invited OR ever-participated
		const isHost = meeting.host._id.toString() === userId.toString();
		const isInvited = meeting.invitedUsers.some(
			(u) => u._id.toString() === userId.toString(),
		);

		const isParticipant = await participantModel.exists({
			meeting: meetingId,
			user: userId,
		});

		if (!isHost && !isInvited && !isParticipant) {
			return res.status(403).json({
				success: false,
				message: "You don't have access to this meeting",
			});
		}

		// Active participants list
		const activeParticipants = await participantModel
			.find({ meeting: meetingId, leftAt: null })
			.populate("user", "name username email profileImage profession")
			.sort({ joinedAt: 1 })
			.lean();

		return res.status(200).json({
			success: true,
			data: {
				meeting: {
					...meeting,
					password: undefined, // never leak
				},
				activeParticipants,
				activeCount: activeParticipants.length,
			},
		});
	} catch (err) {
		console.error("getMeetingById error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch meeting",
			error: err.message,
		});
	}
};

/**
 * @desc    Update meeting details (host only)
 *
 * Body: { title?, description?, scheduledAt?, duration?, waitingRoomEnabled? }
 */
const updateMeeting = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const userId = req.user._id;

		const meeting = await meetingModel.findById(meetingId);
		if (!meeting) {
			return res.status(404).json({
				success: false,
				message: "Meeting not found",
			});
		}

		if (meeting.host.toString() !== userId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can update this meeting",
			});
		}

		if (meeting.status === "COMPLETED" || meeting.status === "CANCELLED") {
			return res.status(400).json({
				success: false,
				message: `Cannot update a ${meeting.status} meeting`,
			});
		}

		const allowed = [
			"title",
			"description",
			"scheduledAt",
			"duration",
			"waitingRoomEnabled",
			"allowEarlyJoin",
			"maxParticipants",
		];

		allowed.forEach((key) => {
			if (req.body[key] !== undefined) meeting[key] = req.body[key];
		});

		await meeting.save();

		return res.status(200).json({
			success: true,
			message: "Meeting updated",
			data: meeting,
		});
	} catch (err) {
		console.error("updateMeeting error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to update meeting",
			error: err.message,
		});
	}
};

/**
 * @desc    Cancel a meeting (host only)
 */
const cancelMeeting = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const userId = req.user._id;

		const meeting = await meetingModel.findById(meetingId);
		if (!meeting) {
			return res.status(404).json({
				success: false,
				message: "Meeting not found",
			});
		}

		if (meeting.host.toString() !== userId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can cancel this meeting",
			});
		}

		if (meeting.status === "COMPLETED") {
			return res.status(400).json({
				success: false,
				message: "Meeting already completed",
			});
		}

		meeting.status = "CANCELLED";
		meeting.endedAt = new Date();
		await meeting.save();

		// Mark all participants as left
		await participantModel.updateMany(
			{ meeting: meetingId, leftAt: null },
			{ $set: { leftAt: new Date(), isScreenSharing: false } },
		);

		return res.status(200).json({
			success: true,
			message: "Meeting cancelled",
			data: { _id: meeting._id, status: meeting.status },
		});
	} catch (err) {
		console.error("cancelMeeting error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to cancel meeting",
			error: err.message,
		});
	}
};

// generate random password
/*
function generatePassword() {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=";

	return Array.from(
		{ length: 16 },
		() => chars[Math.floor(Math.random() * chars.length)],
	).join("");
}
*/
module.exports = {
	createMeeting,
	getMyMeetings,
	getMeetingById,
	updateMeeting,
	cancelMeeting,
};
