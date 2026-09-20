const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const meetingModel = require("../model/meeting.model");
const participantModel = require("../model/participant.model");
const friendRequestModel = require("../model/friend.model");
const userModel = require("../model/user.model");
const { createNotification } = require("../utils/notification");

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
			allowEarlyJoin = false,
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

		if (invitedUsers.length > 0) {
			const invitedUserDocs = await userModel
				.find({ _id: { $in: invitedUsers } })
				.select("name username profileImage")
				.lean();

			await Promise.all(
				invitedUserDocs.map((u) =>
					createNotification({
						userId: u._id,
						type: "MEETING_INVITE",
						title: `You're invited to "${meeting.title}"`,
						body: `${req.user.name} invited you to a meeting on ${new Date(
							meeting.scheduledAt,
						).toLocaleString(undefined, {
							dateStyle: "medium",
							timeStyle: "short",
						})}`,
						from: req.user._id,
						link: `/meeting/${meeting.meetingCode}`,
						meta: {
							meetingId: meeting._id.toString(),
							meetingCode: meeting.meetingCode,
						},
					}),
				),
			);
		}

		// Response: return credentials to copy/share
		return res.status(201).json({
			success: true,
			message: "Meeting created successfully",
			data: {
				_id: meeting._id,
				title: meeting.title,
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
		const { status, role = "host", page = 1, limit = 10 } = req.query;

		let filter = {};
		if (role === "host") {
			filter.host = userId;
		} else if (role === "participant") {
			// Find meetings where I have a participant record but I'm not the host
			const myParticipantRecords = await participantModel
				.find({ user: userId })
				.distinct("meeting");

			filter = { _id: { $in: myParticipantRecords }, host: { $ne: userId } };
		} else {
			// "all" — either host or participant
			const myParticipantRecords = await participantModel
				.find({ user: userId })
				.distinct("meeting");

			filter = {
				$or: [{ host: userId }, { _id: { $in: myParticipantRecords } }],
			};
		}

		if (status) filter.status = status;

		const skip = (Number(page) - 1) * Number(limit);

		// Fetch meetings
		const [meetings, total] = await Promise.all([
			meetingModel
				.find(filter)
				.populate("host", "name username profileImage")
				.populate("invitedUsers", "name username profileImage")
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

/**
 * @desc    Update meeting recording state (host only)
 * @route   PATCH /api/meetings/:meetingId/recording
 * @access  Private (host only)
 *
 * Body: { isRecording: boolean }
 *   - Recording file is stored on the recorder's LOCAL disk.
 *     We only track the boolean flag so all participants see the REC indicator.
 */
const setRecording = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const { isRecording } = req.body;
		const userId = req.user._id;

		if (typeof isRecording !== "boolean") {
			return res.status(400).json({
				success: false,
				message: "isRecording must be a boolean",
			});
		}

		const meeting = await meetingModel.findById(meetingId);
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== userId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can control recording",
			});
		}

		if (meeting.status !== "ONGOING") {
			return res.status(400).json({
				success: false,
				message: "Meeting is not ongoing",
			});
		}

		meeting.isRecording = isRecording;
		await meeting.save();

		return res.status(200).json({
			success: true,
			message: isRecording ? "Recording started" : "Recording stopped",
			data: { isRecording: meeting.isRecording },
		});
	} catch (err) {
		console.error("setRecording error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to update recording state",
			error: err.message,
		});
	}
};

/**
 * @desc    Invite users (friends) to a meeting
 * @route   POST /api/meetings/:meetingId/invite
 * @access  Private (host only)
 *
 * Body: { userIds: [ObjectId, ...] }
 */
const inviteUsers = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const { userIds = [] } = req.body;
		const hostId = req.user._id;

		if (!Array.isArray(userIds) || userIds.length === 0) {
			return res.status(400).json({
				success: false,
				message: "userIds must be a non-empty array",
			});
		}

		const meeting = await meetingModel.findById(meetingId);
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== hostId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can invite users",
			});
		}

		if (meeting.status === "CANCELLED" || meeting.status === "COMPLETED") {
			return res.status(400).json({
				success: false,
				message: `Cannot invite to a ${meeting.status} meeting`,
			});
		}

		//  Verify all userIds are valid friends of the host
		const friendships = await friendRequestModel
			.find({
				status: "ACCEPTED",
				$or: [{ from: hostId }, { to: hostId }],
			})
			.lean();

		const friendIds = new Set(
			friendships.map((f) =>
				f.from.toString() === hostId.toString()
					? f.to.toString()
					: f.from.toString(),
			),
		);

		// Filter out users who aren't friends and the host themselves
		const validIds = userIds
			.map((id) => id.toString())
			.filter((id) => friendIds.has(id) && id !== hostId.toString());

		if (validIds.length === 0) {
			return res.status(400).json({
				success: false,
				message: "None of the given users are your friends",
			});
		}

		//  Find already-invited (avoid duplicate notifications)
		const existingInvited = new Set(
			meeting.invitedUsers.map((u) => u.toString()),
		);

		const newInviteIds = validIds.filter((id) => !existingInvited.has(id));

		if (newInviteIds.length === 0) {
			return res.status(200).json({
				success: true,
				message: "All selected users were already invited",
				invitedCount: 0,
			});
		}

		//  Update meeting
		meeting.invitedUsers.push(...newInviteIds.map((id) => id));

		await meeting.save();

		//  Notify each newly invited user
		const invitedUsers = await userModel
			.find({ _id: { $in: newInviteIds } })
			.select("name username profileImage")
			.lean();

		await Promise.all(
			invitedUsers.map((u) =>
				createNotification({
					userId: u._id,
					type: "MEETING_INVITE",
					title: `You're invited to "${meeting.title}"`,
					body: `${req.user.name} invited you to a meeting on ${new Date(
						meeting.scheduledAt,
					).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					})}`,
					from: hostId,
					link: `/meeting/${meeting.meetingCode}`,
					meta: {
						meetingId: meeting._id.toString(),
						meetingCode: meeting.meetingCode,
					},
				}),
			),
		);

		return res.status(200).json({
			success: true,
			message: `Invited ${newInviteIds.length} user(s)`,
			invitedCount: newInviteIds.length,
			data: {
				invitedUsers: invitedUsers,
				totalInvited: meeting.invitedUsers.length,
			},
		});
	} catch (err) {
		console.error("inviteUsers error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to invite users",
			error: err.message,
		});
	}
};

/**
 * @desc    Remove an invite
 * @route   DELETE /api/meetings/:meetingId/invite/:userId
 * @access  Private (host only)
 */
const removeInvite = async (req, res) => {
	try {
		const { meetingId, userId } = req.params;
		const hostId = req.user._id;

		const meeting = await meetingModel.findById(meetingId);
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== hostId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can remove invites",
			});
		}

		const before = meeting.invitedUsers.length;
		meeting.invitedUsers = meeting.invitedUsers.filter(
			(u) => u.toString() !== userId,
		);

		if (meeting.invitedUsers.length === before) {
			return res.status(404).json({
				success: false,
				message: "User was not invited",
			});
		}

		await meeting.save();

		return res.status(200).json({
			success: true,
			message: "Invite removed",
			data: { removedUserId: userId },
		});
	} catch (err) {
		console.error("removeInvite error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to remove invite",
			error: err.message,
		});
	}
};

/**
 * @desc    Get invite candidates — friends not yet invited to this meeting
 * @route   GET /api/meetings/:meetingId/invite/candidates
 * @access  Private (host only)
 */
const getInviteCandidates = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const hostId = req.user._id;

		const meeting = await meetingModel
			.findById(meetingId)
			.select("host invitedUsers");
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== hostId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can view candidates",
			});
		}

		// Get all friends of the host
		const friendships = await friendRequestModel
			.find({
				status: "ACCEPTED",
				$or: [{ from: hostId }, { to: hostId }],
			})
			.populate("from", "name username email profileImage profession")
			.populate("to", "name username email profileImage profession")
			.lean();

		const friends = friendships.map((f) =>
			f.from._id.toString() === hostId.toString() ? f.to : f.from,
		);

		// Filter out already-invited
		const invitedSet = new Set(meeting.invitedUsers.map((u) => u.toString()));

		const candidates = friends.filter((f) => !invitedSet.has(f._id.toString()));

		return res.status(200).json({
			success: true,
			count: candidates.length,
			data: candidates,
		});
	} catch (err) {
		console.error("getInviteCandidates error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch candidates",
			error: err.message,
		});
	}
};

/**
 * @desc    Force-start a scheduled meeting (host only)
 * @route   POST /api/meetings/:meetingId/start-now
 * @access  Private (host only)
 *
 * Behavior:
 *   - Sets status to ONGOING
 *   - Sets startedAt to now (if not already)
 */
const startMeetingNow = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const userId = req.user._id;

		const meeting = await meetingModel.findById(meetingId);
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== userId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can start this meeting",
			});
		}

		if (meeting.status === "CANCELLED") {
			return res
				.status(400)
				.json({ success: false, message: "Meeting was cancelled" });
		}

		if (meeting.status === "COMPLETED") {
			return res
				.status(400)
				.json({ success: false, message: "Meeting already ended" });
		}

		if (meeting.status === "ONGOING") {
			return res.status(200).json({
				success: true,
				message: "Meeting already ongoing",
				data: { status: meeting.status, startedAt: meeting.startedAt },
			});
		}

		const now = new Date();

		// Flip it to ONGOING
		meeting.status = "ONGOING";
		
		if (!meeting.startedAt) meeting.startedAt = now;

		if (meeting.scheduledAt > now) {
			meeting.scheduledAt = now;
		}

		await meeting.save();

		return res.status(200).json({
			success: true,
			message: "Meeting started",
			data: {
				status: meeting.status,
				startedAt: meeting.startedAt,
			},
		});
	} catch (err) {
		console.error("startMeetingNow error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to start meeting",
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
	setRecording,
	inviteUsers,
	removeInvite,
	getInviteCandidates,
	startMeetingNow,
};
