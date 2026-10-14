const meetingModel = require("../model/meeting.model");
const participantModel = require("../model/participant.model");
const friendRequestModel = require("../model/friend.model");
const notificationModel = require("../model/notification.model");

/**
 * @desc    Get a unified activity feed for the current user
 * @route   GET /api/activity
 * @access  Private
 * @query   ?limit=20
 *
 * Aggregates events from meetings, participants, friendships, notifications.
 * Sorted newest first, capped to `limit` (default 20, max 50).
 */
const getActivityFeed = async (req, res) => {
	try {
		const userId = req.user._id;
		const limit = Math.min(Number(req.query.limit) || 20, 50);

		// Fetch a bit more from each source, then trim after merging
		const perSourceLimit = limit * 2;

		const [
			myMeetings,
			myParticipations,
			myFriendships,
			myNotifications,
		] = await Promise.all([
			//   Meetings I hosted  
			meetingModel
				.find({ host: userId })
				.select("_id title meetingCode scheduledAt status createdAt")
				.sort({ createdAt: -1 })
				.limit(perSourceLimit)
				.lean(),

			//   Meetings I joined  
			participantModel
				.find({ user: userId })
				.populate({
					path: "meeting",
					select: "_id title meetingCode host scheduledAt status",
					populate: {
						path: "host",
						select: "name username profileImage",
					},
				})
				.sort({ createdAt: -1 })
				.limit(perSourceLimit)
				.lean(),

			//   Friendships I'm part of  
			friendRequestModel
				.find({
					status: "ACCEPTED",
					$or: [{ from: userId }, { to: userId }],
				})
				.populate("from", "name username profileImage")
				.populate("to", "name username profileImage")
				.sort({ respondedAt: -1 })
				.limit(perSourceLimit)
				.lean(),

			//   Recent notifications addressed to me  
			notificationModel
				.find({ user: userId })
				.populate("from", "name username profileImage")
				.sort({ createdAt: -1 })
				.limit(perSourceLimit)
				.lean(),
		]);

		//   Build a unified event list  
		const events = [];

		// Meetings I hosted — "You created X"
		myMeetings.forEach((m) => {
			events.push({
				id: `meeting-created-${m._id}`,
				kind: "MEETING_CREATED",
				icon: "video",
				createdAt: m.createdAt,
				title: `You created "${m.title}"`,
				subtitle: `Code ${m.meetingCode}`,
				link: `/meet`,
				meta: { meetingId: m._id.toString(), status: m.status },
			});
		});

		// Meetings I joined (deduped per meeting)
		const seenMeetIds = new Set();
		myParticipations.forEach((p) => {
			const meeting = p.meeting;
			if (!meeting) return;

			const hostId =
				typeof meeting.host === "object"
					? meeting.host?._id?.toString()
					: meeting.host?.toString();

			// Skip if I'm the host (already covered above)
			if (hostId === userId.toString()) return;

			// Dedupe — one event per meeting even if I joined multiple sessions
			if (seenMeetIds.has(meeting._id.toString())) return;
			seenMeetIds.add(meeting._id.toString());

			const hostName =
				typeof meeting.host === "object"
					? meeting.host?.name
					: "someone";

			events.push({
				id: `meeting-joined-${meeting._id}`,
				kind: "MEETING_JOINED",
				icon: "user-plus",
				createdAt: p.createdAt, // when I first joined
				title: `You joined "${meeting.title}"`,
				subtitle: `Hosted by ${hostName}`,
				link: `/meeting/${meeting.meetingCode}`,
				meta: { meetingId: meeting._id.toString() },
			});
		});

		// Friendships
		myFriendships.forEach((f) => {
			const other =
				f.from._id.toString() === userId.toString() ? f.to : f.from;
			events.push({
				id: `friend-${f._id}`,
				kind: "FRIEND_ADDED",
				icon: "users",
				createdAt: f.respondedAt || f.updatedAt,
				title: `You're now friends with ${other.name}`,
				subtitle: `@${other.username}`,
				link: `/friends`,
				meta: {
					userId: other._id.toString(),
					profileImage: other.profileImage,
				},
			});
		});

		// Notifications (recent ones)
		myNotifications.forEach((n) => {
			// Skip notifications we already surface as events
			if (n.type === "FRIEND_ACCEPTED") {
				// Already shown via friendship event
				return;
			}

			const iconMap = {
				FRIEND_REQUEST: "user-plus",
				FRIEND_REJECTED: "user-x",
				MEETING_INVITE: "mail",
				MEETING_STARTING: "clock",
				MEETING_CANCELLED: "alert",
				MEETING_ENDED: "video",
				SYSTEM: "bell",
			};

			events.push({
				id: `notif-${n._id}`,
				kind: n.type,
				icon: iconMap[n.type] || "bell",
				createdAt: n.createdAt,
				title: n.title,
				subtitle: n.body,
				link: n.link || null,
				meta: {
					...n.meta,
					from: n.from
						? {
								name: n.from.name,
								username: n.from.username,
								profileImage: n.from.profileImage,
							}
						: null,
					isRead: n.isRead,
				},
			});
		});

		//   Sort + trim  
		events.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);

		const trimmed = events.slice(0, limit);

		return res.status(200).json({
			success: true,
			count: trimmed.length,
			data: trimmed,
		});
	} catch (err) {
		console.error("getActivityFeed error:", err);
		return res.status(500).json({
			success: false,
			message: "Failed to fetch activity",
			error: err.message,
		});
	}
};

module.exports = { getActivityFeed };
