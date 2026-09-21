const chatMessageModel = require("../model/chatMessage.model");
const meetingModel = require("../model/meeting.model");
const participantModel = require("../model/participant.model");

/**
 * @desc    Get chat history for a meeting (paginated)
 * @route   GET /api/meetings/:meetingId/chat
 * @access  Private — must be host or participant
 *
 * Query: ?before=<ISO date>&limit=50
 *   before → load messages older than this timestamp (cursor pagination)
 */
const getChatHistory = async (req, res) => {
	try {
		const { meetingId } = req.params;
		const userId = req.user._id;
		const { before, limit = 50 } = req.query;

		//  Verify access 
		const meeting = await meetingModel
			.findById(meetingId)
			.select("host participants");
		if (!meeting) {
			return res
				.status(404)
				.json({ success: false, message: "Meeting not found" });
		}

		const isHost = meeting.host.toString() === userId.toString();

		// Allow access if host OR user was ever a participant
		let allowed = isHost;
		if (!allowed) {
			const isParticipant = await participantModel.exists({
				meeting: meetingId,
				user: userId,
			});
			allowed = !!isParticipant;
		}

		if (!allowed) {
			return res.status(403).json({
				success: false,
				message: "You don't have access to this meeting's chat",
			});
		}

		//  Build query 
		const query = { meeting: meetingId, isDeleted: { $ne: true } };
		if (before) {
			const beforeDate = new Date(before);
			if (!isNaN(beforeDate.getTime())) {
				query.createdAt = { $lt: beforeDate };
			}
		}

		const cap = Math.min(Number(limit) || 50, 100); // hard cap 100

		// Newest-first fetch, then reverse for chronological display
		const messages = await chatMessageModel
			.find(query)
			.sort({ createdAt: -1 })
			.limit(cap + 1) // +1 to know if more exist
			.lean();

		const hasMore = messages.length > cap;
		if (hasMore) messages.pop(); // remove the extra probe

		const chronological = messages.reverse();

		return res.status(200).json({
			success: true,
			data: chronological,
			hasMore,
			// Cursor for next page = oldest message's createdAt
			nextCursor: hasMore ? chronological[0]?.createdAt : null,
		});
	} catch (err) {
		console.error("getChatHistory error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to load chat history",
			error: err.message,
		});
	}
};

/**
 * @desc    Delete a chat message (soft delete)
 * @route   DELETE /api/meetings/:meetingId/chat/:messageId
 * @access  Private — message owner OR meeting host
 */
const deleteChatMessage = async (req, res) => {
	try {
		const { meetingId, messageId } = req.params;
		const userId = req.user._id;

		const message = await chatMessageModel.findById(messageId);
		if (!message || message.meeting.toString() !== meetingId) {
			return res
				.status(404)
				.json({ success: false, message: "Message not found" });
		}

		const isOwner = message.user.toString() === userId.toString();

		// Host can delete any message in their meeting
		let isHost = false;
		if (!isOwner) {
			const meeting = await meetingModel
				.findById(meetingId)
				.select("host");
			isHost = meeting?.host?.toString() === userId.toString();
		}

		if (!isOwner && !isHost) {
			return res.status(403).json({
				success: false,
				message: "You can only delete your own messages",
			});
		}

		message.isDeleted = true;
		await message.save();

		return res.status(200).json({ success: true, messageId });
	} catch (err) {
		console.error("deleteChatMessage error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to delete message",
			error: err.message,
		});
	}
};

module.exports = { getChatHistory, deleteChatMessage };