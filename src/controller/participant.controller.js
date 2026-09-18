const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const meetingModel = require("../model/meeting.model");
const participantModel = require("../model/participant.model");

/**
 * @desc    Join a meeting (by link → meetingCode, or by _id)

 * Body: { meetingCode? , meetingId? , password? }
 *   - meetingCode: from link  /meeting/abc-defg-hij
 *   - meetingId:   ObjectId of meeting
 *   - password:    optional, required if meeting has one
 */
const joinMeeting = async (req, res) => {
	try {
		const { meetingCode, meetingId, password } = req.body;

		const userId = req.user._id;

		// Find the meeting
		if (!meetingCode && !meetingId) {
			return res.status(400).json({
				success: false,
				message: "Provide meetingCode or meetingLink",
			});
		}

		const query = meetingCode ? { meetingCode } : { _id: meetingId };

		const meeting = await meetingModel
			.findOne(query)
			.select("+password"); // password is select:false by default

		if (!meeting) {
			return res.status(404).json({
				success: false,
				message: "Meeting not found",
			});
		}

		// Basic status checks
		if (meeting.status === "CANCELLED") {
			return res.status(400).json({
				success: false,
				message: "This meeting has been cancelled",
			});
		}

		if (meeting.status === "COMPLETED") {
			return res.status(400).json({
				success: false,
				message: "This meeting has ended",
			});
		}

		//  Identify user's relationship to meeting
		const isHost = meeting.host.toString() === userId.toString();

		const isInvited = meeting.invitedUsers.some(
			(id) => id.toString() === userId.toString()
		);

		// Private meeting gate 
		if (meeting.isPrivate && !isHost && !isInvited) {
			return res.status(403).json({
				success: false,
				message: "This is a private meeting. You are not invited.",
			});
		}

		// Password check 
		// Host never needs the password.
		if (meeting.password && !isHost) {
			if (!password || password.trim().length === 0) {
				return res.status(401).json({
					success: false,
					message: "Password required",
					requiresPassword: true,
				});
			}

			const isMatch = await bcrypt.compare(password, meeting.password);
			if (!isMatch) {
				return res.status(401).json({
					success: false,
					message: "Incorrect password",
					requiresPassword: true,
				});
			}
		}

		// Capacity check 
		// Count only ACTIVE participants (haven't left)
		const activeCount = await participantModel.countDocuments({
			meeting: meeting._id,
			leftAt: null,
		});

		if (activeCount >= meeting.maxParticipants && !isHost) {
			return res.status(403).json({
				success: false,
				message: "Meeting is full",
			});
		}

		// Waiting room / early join timer 
		const now = new Date();
		const startsInMs = meeting.scheduledAt.getTime() - now.getTime();
		const startsInSeconds = Math.max(0, Math.floor(startsInMs / 1000));

		// Host bypasses waiting room entirely.
		const mustWait =
			!isHost &&
			!meeting.allowEarlyJoin &&
			now < meeting.scheduledAt;

		if (mustWait) {
			return res.status(200).json({
				success: true,
				status: "WAITING",
				message: "Meeting hasn't started yet. Please wait.",
				data: {
					meeting: {
						_id: meeting._id,
						title: meeting.title,
						meetingCode: meeting.meetingCode,
						scheduledAt: meeting.scheduledAt,
						duration: meeting.duration,
						host: meeting.host,
					},
					startsIn: startsInSeconds, // frontend counts down from this
				},
			});
		}

		// Mark meeting as ONGOING if it's time 
		// First joiner (host typically) flips the status.
		if (meeting.status === "SCHEDULED") {
			meeting.status = "ONGOING";
			if (!meeting.startedAt) meeting.startedAt = now;
			await meeting.save();
		}

		// Create or re-activate participant record 
		let participant = await participantModel.findOne({
			meeting: meeting._id,
			user: userId,
		});

		if (participant) {
			// Already joined before → rejoin (reset leftAt)
			if (participant.leftAt) {
				participant.leftAt = null;
				participant.joinedAt = now;
				await participant.save();
			}
			// If already active, just return existing record (idempotent)
		} else {
			participant = await participantModel.create({
				meeting: meeting._id,
				user: userId,
				role: isHost ? "HOST" : "PARTICIPANT",
				joinedAt: now,
			});
		}

		// Success response 
		return res.status(200).json({
			success: true,
			status: "JOINED",
			message: "Joined meeting successfully",
			data: {
				meeting: {
					_id: meeting._id,
					title: meeting.title,
					description: meeting.description,
					meetingCode: meeting.meetingCode,
					meetingLink: meeting.meetingLink,
					host: meeting.host,
					scheduledAt: meeting.scheduledAt,
					duration: meeting.duration,
					status: meeting.status,
					startedAt: meeting.startedAt,
					maxParticipants: meeting.maxParticipants,
					isRecording: meeting.isRecording,
				},
				participant: {
					_id: participant._id,
					role: participant.role,
					joinedAt: participant.joinedAt,
					isMuted: participant.isMuted,
					isCameraOff: participant.isCameraOff,
					isScreenSharing: participant.isScreenSharing,
				},
			},
		});
	} catch (err) {
		console.error("joinMeeting error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to join meeting",
			error: err.message,
		});
	}
};

/**
 * @desc    Check meeting status WITHOUT joining (for the waiting page)
 *
 * Used by the frontend waiting page to poll every few seconds
 * and know when to redirect the user into the meeting.
 */
const getMeetingStatus = async (req, res) => {
	try {
		const { meetingCode } = req.params;

		const meeting = await meetingModel.findOne({ meetingCode });
		if (!meeting) {
			return res.status(404).json({
				success: false,
				message: "Meeting not found",
			});
		}

		const now = new Date();
		const startsIn = Math.max(
			0,
			Math.floor((meeting.scheduledAt.getTime() - now.getTime()) / 1000)
		);

		return res.status(200).json({
			success: true,
			data: {
				status: meeting.status,
				scheduledAt: meeting.scheduledAt,
				startsIn,
				isJoinable:
					meeting.status !== "CANCELLED" &&
					meeting.status !== "COMPLETED" &&
					(meeting.allowEarlyJoin || startsIn === 0),
			},
		});
	} catch (err) {
		console.error("getMeetingStatus error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch meeting status",
			error: err.message,
		});
	}
};


/**
 * @desc    Update media state (mute/unmute, camera on/off, screen-share)
 *
 * Body: { isMuted?, isCameraOff?, isScreenSharing? }
 *   - Only sends the fields to change (partial update)
 */
const updateMyState = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const userId = req.user._id;
		const { isMuted, isCameraOff, isScreenSharing } = req.body;

		// Build partial update — only allow known fields
		const updates = {};
		if (typeof isMuted === "boolean") updates.isMuted = isMuted;
		if (typeof isCameraOff === "boolean") updates.isCameraOff = isCameraOff;
		if (typeof isScreenSharing === "boolean")
			updates.isScreenSharing = isScreenSharing;

		if (Object.keys(updates).length === 0) {
			return res.status(400).json({
				success: false,
				message: "Provide at least one of: isMuted, isCameraOff, isScreenSharing",
			});
		}

		// Only update your OWN active participant record
		const participant = await participantModel.findOneAndUpdate(
			{
				meeting: meetingId,
				user: userId,
				leftAt: null, // must still be in the meeting
			},
			{ $set: updates },
			{ new: true }
		);

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "You are not an active participant in this meeting",
			});
		}

		return res.status(200).json({
			success: true,
			message: "State updated",
			data: {
				isMuted: participant.isMuted,
				isCameraOff: participant.isCameraOff,
				isScreenSharing: participant.isScreenSharing,
			},
		});
	} catch (err) {
		console.error("updateMyState error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to update state",
			error: err.message,
		});
	}
};

/**
 * @desc    Leave a meeting
 *
 * Behavior:
 *   - Marks this user's participant record as leftAt = now
 *   - If HOST leaves, ends the meeting for everyone (COMPLETED)
 *   - If non-host leaves, meeting continues
 */
const leaveMeeting = async (req, res) => {
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

		// Mark participant as left
		const participant = await participantModel.findOneAndUpdate(
			{ meeting: meetingId, user: userId, leftAt: null },
			{ $set: { leftAt: new Date(), isScreenSharing: false } },
			{ new: true }
		);

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "You are not an active participant in this meeting",
			});
		}

		// If the HOST left → end meeting for everyone
		const isHost = meeting.host.toString() === userId.toString();

		if (isHost && meeting.status === "ONGOING") {
			meeting.status = "COMPLETED";
			meeting.endedAt = new Date();

			// Mark all remaining participants as left
			await participantModel.updateMany(
				{ meeting: meetingId, leftAt: null },
				{ $set: { leftAt: new Date(), isScreenSharing: false } }
			);

			await meeting.save();

			return res.status(200).json({
				success: true,
				message: "Host left. Meeting ended for everyone.",
				data: { meetingEnded: true, meetingStatus: meeting.status },
			});
		}

		return res.status(200).json({
			success: true,
			message: "Left meeting successfully",
			data: { meetingEnded: false, meetingStatus: meeting.status },
		});
	} catch (err) {
		console.error("leaveMeeting error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to leave meeting",
			error: err.message,
		});
	}
};

/**
 * @desc    List active participants of a meeting
 */
const getParticipants = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const userId = req.user._id;

		// Verify meeting exists
		const meeting = await meetingModel.findById(meetingId).select("host title");
		if (!meeting) {
			return res.status(404).json({
				success: false,
				message: "Meeting not found",
			});
		}

		// Security: user must be host OR an active participant
		const isHost = meeting.host.toString() === userId.toString();
		const isActiveParticipant = await participantModel.exists({
			meeting: meetingId,
			user: userId,
			leftAt: null,
		});

		if (!isHost && !isActiveParticipant) {
			return res.status(403).json({
				success: false,
				message: "You are not part of this meeting",
			});
		}

		// Active participants only
		const participants = await participantModel
			.find({ meeting: meetingId, leftAt: null })
			.populate("user", "name username email profileImage profession")
			.sort({ joinedAt: 1 })
			.lean();

		return res.status(200).json({
			success: true,
			count: participants.length,
			data: participants,
		});
	} catch (err) {
		console.error("getParticipants error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch participants",
			error: err.message,
		});
	}
};

module.exports = { 
	joinMeeting,
	getMeetingStatus,
	updateMyState,
	leaveMeeting,
	getParticipants,
};