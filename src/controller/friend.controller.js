const friendRequestModel = require("../model/friend.model");
const userModel = require("../model/user.model");
const { createNotification } = require("../utils/notification");

/**
 * @desc    Send a friend request by username or email
 * @route   POST /api/friends/request
 * @access  Private
 * Body: { identifier: "username" | "email", message?: string }
 */
const sendFriendRequest = async (req, res) => {
	try {
		const { identifier, message = "" } = req.body;
		const myId = req.user._id;

		if (!identifier) {
			return res
				.status(400)
				.json({ success: false, message: "Username or email required" });
		}

		const query = identifier.includes("@")
			? { email: identifier.toLowerCase().trim() }
			: { username: identifier.toLowerCase().trim() };

		const target = await userModel.findOne(query).select("_id name username");
		if (!target) {
			return res
				.status(404)
				.json({ success: false, message: "User not found" });
		}

		if (target._id.toString() === myId.toString()) {
			return res
				.status(400)
				.json({ success: false, message: "You can't add yourself" });
		}

		// Existing relationship?
		const existing = await friendRequestModel.findOne({
			$or: [
				{ from: myId, to: target._id },
				{ from: target._id, to: myId },
			],
		});

		if (existing) {
			if (existing.status === "ACCEPTED") {
				return res
					.status(400)
					.json({ success: false, message: "You're already friends" });
			}
			if (existing.status === "PENDING") {
				// If THEY already sent me one, auto-accept
				if (existing.to.toString() === myId.toString()) {
					existing.status = "ACCEPTED";
					existing.respondedAt = new Date();
					await existing.save();
					return res
						.status(200)
						.json({ success: true, message: "You are now friends!" });
				}
				return res.status(400).json({
					success: false,
					message: "Request already sent, awaiting response",
				});
			}
			if (existing.status === "REJECTED") {
				// Allow re-sending by resetting
				existing.status = "PENDING";
				existing.from = myId;
				existing.to = target._id;
				existing.message = message;
				existing.respondedAt = null;
				await existing.save();
				return res
					.status(200)
					.json({ success: true, message: "Friend request sent" });
			}
		}

		const request = await friendRequestModel.create({
			from: myId,
			to: target._id,
			message,
		});

		await createNotification({
			userId: target._id,
			type: "FRIEND_REQUEST",
			title: "New friend request",
			body: `${req.user.name} sent you a friend request${
				message ? `: "${message}"` : ""
			}`,
			from: req.user._id,
			link: "/friends",
			meta: { requestId: request._id.toString() },
		});

		// emit socket event to target for notification
		return res.status(201).json({
			success: true,
			message: "Friend request sent",
			data: request,
		});
	} catch (err) {
		console.error("sendFriendRequest error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to send request",
			error: err.message,
		});
	}
};

/**
 * @desc    Accept / reject a friend request
 * @route   PATCH /api/friends/request/:requestId
 * @access  Private (target only)
 */
const respondToRequest = async (req, res) => {
	try {
		const { requestId } = req.params;
		const { action } = req.body; // "accept" | "reject"
		const myId = req.user._id;

		const request = await friendRequestModel.findById(requestId);
		if (!request) {
			return res
				.status(404)
				.json({ success: false, message: "Request not found" });
		}

		if (request.to.toString() !== myId.toString()) {
			return res
				.status(403)
				.json({ success: false, message: "Not your request" });
		}

		if (request.status !== "PENDING") {
			return res
				.status(400)
				.json({ success: false, message: "Already handled" });
		}

		request.status = action === "accept" ? "ACCEPTED" : "REJECTED";
		request.respondedAt = new Date();

		await request.save();

		// Notify the original sender
		if (request.status === "ACCEPTED" || request.status === "REJECTED") {
			await createNotification({
				userId: request.from,
				type:
					request.status === "ACCEPTED" ? "FRIEND_ACCEPTED" : "FRIEND_REJECTED",
				title:
					request.status === "ACCEPTED"
						? "Friend request accepted"
						: "Friend request declined",
				body: `${req.user.name} ${
					request.status === "ACCEPTED" ? "accepted" : "declined"
				} your friend request`,
				from: req.user._id,
				link: "/friends",
				meta: { requestId: request._id.toString() },
			});
		}

		return res.status(200).json({
			success: true,
			message: action === "accept" ? "Friend added" : "Request rejected",
			data: request,
		});
	} catch (err) {
		console.error("respondToRequest error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to respond",
			error: err.message,
		});
	}
};

/**
 * @desc    Get my friends list
 * @route   GET /api/friends
 */
const getFriends = async (req, res) => {
	try {
		const myId = req.user._id;

		const friendships = await friendRequestModel
			.find({
				status: "ACCEPTED",
				$or: [{ from: myId }, { to: myId }],
			})
			.populate("from", "name username email profileImage profession")
			.populate("to", "name username email profileImage profession")
			.lean();

		// Extract the "other" user from each pair
		const friends = friendships.map((f) => {
			const other = f.from._id.toString() === myId.toString() ? f.to : f.from;
			return {
				friendshipId: f._id,
				friendsSince: f.respondedAt || f.updatedAt,
				...other,
			};
		});

		return res
			.status(200)
			.json({ success: true, count: friends.length, data: friends });
	} catch (err) {
		console.error("getFriends error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch friends",
			error: err.message,
		});
	}
};

/**
 * @desc    Get pending incoming + outgoing requests
 * @route   GET /api/friends/requests
 */
const getRequests = async (req, res) => {
	try {
		const myId = req.user._id;

		const [incoming, outgoing] = await Promise.all([
			friendRequestModel
				.find({ to: myId, status: "PENDING" })
				.populate("from", "name username email profileImage profession")
				.sort({ createdAt: -1 })
				.lean(),
			friendRequestModel
				.find({ from: myId, status: "PENDING" })
				.populate("to", "name username email profileImage profession")
				.sort({ createdAt: -1 })
				.lean(),
		]);

		return res.status(200).json({
			success: true,
			incoming,
			outgoing,
		});
	} catch (err) {
		console.error("getRequests error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch requests",
			error: err.message,
		});
	}
};

/**
 * @desc    Remove a friend
 * @route   DELETE /api/friends/:friendId
 */
const removeFriend = async (req, res) => {
	try {
		const { friendId } = req.params;
		const myId = req.user._id;

		const deleted = await friendRequestModel.findOneAndDelete({
			status: "ACCEPTED",
			$or: [
				{ from: myId, to: friendId },
				{ from: friendId, to: myId },
			],
		});

		if (!deleted) {
			return res
				.status(404)
				.json({ success: false, message: "Friendship not found" });
		}

		return res.status(200).json({ success: true, message: "Friend removed" });
	} catch (err) {
		console.error("removeFriend error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to remove friend",
			error: err.message,
		});
	}
};

/**
 * @desc    Search users to add (excludes existing friends/self)
 * @route   GET /api/friends/search?q=...
 */
const searchUsers = async (req, res) => {
	try {
		const { q = "" } = req.query;
		const myId = req.user._id;

		if (!q.trim()) {
			return res.status(200).json({ success: true, data: [] });
		}

		const regex = new RegExp(q.trim(), "i");

		const users = await userModel
			.find({
				_id: { $ne: myId },
				$or: [{ username: regex }, { email: regex }, { name: regex }],
			})
			.select("name username email profileImage profession")
			.limit(20)
			.lean();

		return res.status(200).json({ success: true, data: users });
	} catch (err) {
		console.error("searchUsers error:", err);
		return res.status(500).json({
			success: false,
			message: "Search failed",
			error: err.message,
		});
	}
};

module.exports = {
	sendFriendRequest,
	respondToRequest,
	getFriends,
	getRequests,
	removeFriend,
	searchUsers,
};
