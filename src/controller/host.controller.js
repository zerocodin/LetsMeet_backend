const participantModel = require("../model/participant.model");
const meetingModel = require("../model/meeting.model");

/**
 * Helper: check if the requester is host or co-host of this meeting
 */
const checkHostOrCohost = async (meetingId, userId) => {
	const meeting = await meetingModel.findById(meetingId).select("host");
	if (!meeting) return { ok: false, reason: "Meeting not found" };

	const isHost = meeting.host.toString() === userId.toString();
	if (isHost) return { ok: true, meeting, isHost: true };

	const requester = await participantModel.findOne({
		meeting: meetingId,
		user: userId,
		leftAt: null,
	});

	if (requester && requester.role === "COHOST") {
		return { ok: true, meeting, isHost: false };
	}

	return { ok: false, reason: "Only the host or co-host can do this" };
};

/**
 * @desc    Host force-mutes a participant
 * @route   PATCH /api/meetings/:meetingId/participants/:participantId/mute
 */
const muteParticipant = async (req, res) => {
	try {
		const { meetingId, participantId } = req.params;
		const userId = req.user._id;

		const auth = await checkHostOrCohost(meetingId, userId);
		if (!auth.ok) {
			return res.status(403).json({ success: false, message: auth.reason });
		}

		const participant = await participantModel.findOneAndUpdate(
			{ _id: participantId, meeting: meetingId, leftAt: null },
			{ $set: { isMuted: true } },
			{ new: true },
		);

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "Participant not found or already left",
			});
		}

		// 🔌 Socket.io hook (later): io.to(meetingId).emit("force-mute", participantId)

		return res.status(200).json({
			success: true,
			message: "Participant muted",
			data: { participantId, isMuted: true },
		});
	} catch (err) {
		console.error("muteParticipant error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to mute participant",
			error: err.message,
		});
	}
};

/**
 * @desc    Host unmutes a participant
 * @route   PATCH /api/meetings/:meetingId/participants/:participantId/unmute
 */
const unmuteParticipant = async (req, res) => {
	try {
		const { meetingId, participantId } = req.params;
		const userId = req.user._id;

		const auth = await checkHostOrCohost(meetingId, userId);
		if (!auth.ok) {
			return res.status(403).json({ success: false, message: auth.reason });
		}

		const participant = await participantModel.findOneAndUpdate(
			{ _id: participantId, meeting: meetingId, leftAt: null },
			{ $set: { isMuted: false } },
			{ new: true },
		);

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "Participant not found or already left",
			});
		}

		return res.status(200).json({
			success: true,
			message: "Participant unmuted",
			data: { participantId, isMuted: false },
		});
	} catch (err) {
		console.error("unmuteParticipant error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to unmute participant",
			error: err.message,
		});
	}
};

/**
 * @desc    Host removes (kicks) a participant
 * @route   DELETE /api/meetings/:meetingId/participants/:participantId
 */
const removeParticipant = async (req, res) => {
	try {
		const { meetingId, participantId } = req.params;
		const userId = req.user._id;

		const auth = await checkHostOrCohost(meetingId, userId);
		if (!auth.ok) {
			return res.status(403).json({ success: false, message: auth.reason });
		}

		const participant = await participantModel.findOne({
			_id: participantId,
			meeting: meetingId,
			leftAt: null,
		});

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "Participant not found or already left",
			});
		}

		// Prevent host from kicking themselves
		if (participant.user.toString() === auth.meeting.host.toString()) {
			return res.status(400).json({
				success: false,
				message: "Host cannot be removed",
			});
		}

		// Co-host can't kick another co-host
		if (!auth.isHost && participant.role === "COHOST") {
			return res.status(403).json({
				success: false,
				message: "A co-host cannot remove another co-host",
			});
		}

		participant.leftAt = new Date();
		participant.isScreenSharing = false;
		await participant.save();

		// 🔌 Socket.io hook (later): io.to(participantId).emit("kicked")

		return res.status(200).json({
			success: true,
			message: "Participant removed",
			data: { participantId },
		});
	} catch (err) {
		console.error("removeParticipant error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to remove participant",
			error: err.message,
		});
	}
};

/**
 * @desc    Promote a participant to co-host
 * @route   PATCH /api/meetings/:meetingId/participants/:participantId/promote
 */
const promoteToCohost = async (req, res) => {
	try {
		const { meetingId, participantId } = req.params;
		const userId = req.user._id;

		// Only the actual host can promote
		const meeting = await meetingModel.findById(meetingId).select("host");
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== userId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can promote to co-host",
			});
		}

		const participant = await participantModel.findOneAndUpdate(
			{ _id: participantId, meeting: meetingId, leftAt: null },
			{ $set: { role: "COHOST" } },
			{ new: true },
		);

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "Participant not found or already left",
			});
		}

		return res.status(200).json({
			success: true,
			message: "Participant promoted to co-host",
			data: { participantId, role: "COHOST" },
		});
	} catch (err) {
		console.error("promoteToCohost error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to promote participant",
			error: err.message,
		});
	}
};

/**
 * @desc    Demote a co-host back to participant
 * @route   PATCH /api/meetings/:meetingId/participants/:participantId/demote
 */
const demoteFromCohost = async (req, res) => {
	try {
		const { meetingId, participantId } = req.params;
		const userId = req.user._id;

		const meeting = await meetingModel.findById(meetingId).select("host");
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== userId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can demote a co-host",
			});
		}

		const participant = await participantModel.findOneAndUpdate(
			{ _id: participantId, meeting: meetingId, leftAt: null },
			{ $set: { role: "PARTICIPANT" } },
			{ new: true },
		);

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "Participant not found or already left",
			});
		}

		return res.status(200).json({
			success: true,
			message: "Co-host demoted",
			data: { participantId, role: "PARTICIPANT" },
		});
	} catch (err) {
		console.error("demoteFromCohost error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to demote participant",
			error: err.message,
		});
	}
};

/**
 * @desc    Host forces a participant to stop screen sharing
 * @route   POST /api/meetings/:meetingId/participants/:participantId/stop-share
 * @access  Private (host only)
 */
const stopScreenShare = async (req, res) => {
	try {
		const { meetingId, participantId } = req.params;
		const userId = req.user._id;

		const meeting = await meetingModel.findById(meetingId).select("host");
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		if (meeting.host.toString() !== userId.toString()) {
			return res.status(403).json({
				success: false,
				message: "Only the host can stop another user's share",
			});
		}

		const participant = await participantModel.findOneAndUpdate(
			{ _id: participantId, meeting: meetingId, leftAt: null },
			{ $set: { isScreenSharing: false } },
			{ returnDocument: "after" }
		);

		if (!participant) {
			return res.status(404).json({
				success: false,
				message: "Participant not found or already left",
			});
		}

		return res.status(200).json({
			success: true,
			message: "Screen share stopped",
			data: { participantId, isScreenSharing: false },
		});
	} catch (err) {
		console.error("stopScreenShare error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to stop screen share",
			error: err.message,
		});
	}
};

module.exports = {
	muteParticipant,
	unmuteParticipant,
	removeParticipant,
	promoteToCohost,
	demoteFromCohost,
	stopScreenShare,
};
