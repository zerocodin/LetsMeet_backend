const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const userModel = require("../model/user.model");
const meetingModel = require("../model/meeting.model");
const participantModel = require("../model/participant.model");
const chatMessageModel = require("../model/chatMessage.model");

// In-memory map: meetingId → Set of { userId, socketId }
const rooms = new Map();

let io;
const getIO = () => io;

const initSocket = (httpServer) => {
	io = new Server(httpServer, {
		cors: {
			origin: process.env.FRONTEND_URI || "http://localhost:3000",
			credentials: true,
		},
		pingTimeout: 60000,
	});

	// Auth middleware on handshake
	io.use(async (socket, next) => {
		try {
			const rawCookie = socket.handshake.headers?.cookie;
			let token = null;

			if (rawCookie) {
				const parsed = cookie.parse(rawCookie);
				token = parsed.token;
			}

			// Fallback: allow token via auth header (for React Native etc.)
			if (!token && socket.handshake.auth?.token) {
				token = socket.handshake.auth.token;
			}

			if (!token) {
				return next(new Error("Authentication error: no token"));
			}

			const decoded = jwt.verify(token, process.env.JWT_SECRET);
			const user = await userModel
				.findById(decoded.userId)
				.select("name username email profileImage");

			if (!user) {
				return next(new Error("Authentication error: user not found"));
			}

			socket.user = user; // attach user to socket
			next();
		} catch (err) {
			console.error("Socket auth error:", err.message);
			next(new Error("Authentication error"));
		}
	});

	//  Connection handler
	io.on("connection", (socket) => {
		console.log(
			`Socket connected: ${socket.id} (user: ${socket.user.username})`,
		);

		socket.join(`user:${socket.user._id.toString()}`);

		// JOIN MEETING ROOM
		socket.on("join-meeting", async ({ meetingId }, callback) => {
			try {
				if (!meetingId) {
					return callback?.({ success: false, message: "meetingId required" });
				}

				// Verify user is an active participant in DB
				const participant = await participantModel.findOne({
					meeting: meetingId,
					user: socket.user._id,
					leftAt: null,
				});

				if (!participant) {
					return callback?.({
						success: false,
						message: "You are not an active participant",
					});
				}

				const roomName = `meeting:${meetingId}`;
				socket.join(roomName);
				socket.meetingId = meetingId;
				socket.participantId = participant._id.toString();

				// Track in memory
				if (!rooms.has(meetingId)) rooms.set(meetingId, new Map());
				rooms.get(meetingId).set(socket.user._id.toString(), {
					socketId: socket.id,
					participantId: participant._id.toString(),
					userId: socket.user._id,
					name: socket.user.name,
					username: socket.user.username,
					profileImage: socket.user.profileImage,
					role: participant.role,
					isMuted: participant.isMuted,
					isCameraOff: participant.isCameraOff,
					isScreenSharing: participant.isScreenSharing,
				});

				// Send existing participants list to the new joiner
				const existing = Array.from(rooms.get(meetingId).values())
					.filter((p) => p.socketId !== socket.id)
					.map((p) => ({
						socketId: p.socketId,
						participantId: p.participantId,
						userId: p.userId,
						name: p.name,
						username: p.username,
						profileImage: p.profileImage,
						role: p.role,
						isMuted: p.isMuted,
						isCameraOff: p.isCameraOff,
						isScreenSharing: p.isScreenSharing,
					}));

				callback?.({
					success: true,
					participants: existing,
					self: {
						socketId: socket.id,
						participantId: participant._id,
						role: participant.role,
					},
				});

				// Notify everyone else that a new participant joined
				socket.to(roomName).emit("participant-joined", {
					socketId: socket.id,
					participantId: participant._id,
					userId: socket.user._id,
					name: socket.user.name,
					username: socket.user.username,
					profileImage: socket.user.profileImage,
					role: participant.role,
					isMuted: participant.isMuted,
					isCameraOff: participant.isCameraOff,
					isScreenSharing: participant.isScreenSharing,
				});
			} catch (err) {
				console.error("join-meeting error:", err);
				callback?.({ success: false, message: err.message });
			}
		});

		// WEBRTC SIGNALING — offer / answer / ICE
		socket.on("webrtc-offer", ({ targetSocketId, offer }) => {
			io.to(targetSocketId).emit("webrtc-offer", {
				fromSocketId: socket.id,
				fromUserId: socket.user._id,
				fromName: socket.user.name,
				offer,
			});
		});

		socket.on("webrtc-answer", ({ targetSocketId, answer }) => {
			io.to(targetSocketId).emit("webrtc-answer", {
				fromSocketId: socket.id,
				answer,
			});
		});

		socket.on("webrtc-ice-candidate", ({ targetSocketId, candidate }) => {
			io.to(targetSocketId).emit("webrtc-ice-candidate", {
				fromSocketId: socket.id,
				candidate,
			});
		});

		// MEDIA STATE BROADCASTS (self toggles)
		socket.on("toggle-mute", ({ isMuted }) => {
			const roomName = `meeting:${socket.meetingId}`;
			if (!socket.meetingId) return;

			const room = rooms.get(socket.meetingId);
			const entry = room?.get(socket.user._id.toString());
			if (entry) entry.isMuted = isMuted;

			socket.to(roomName).emit("participant-state-changed", {
				socketId: socket.id,
				userId: socket.user._id,
				isMuted,
			});
		});

		socket.on("toggle-camera", ({ isCameraOff }) => {
			const roomName = `meeting:${socket.meetingId}`;
			if (!socket.meetingId) return;

			const room = rooms.get(socket.meetingId);
			const entry = room?.get(socket.user._id.toString());
			if (entry) entry.isCameraOff = isCameraOff;

			socket.to(roomName).emit("participant-state-changed", {
				socketId: socket.id,
				userId: socket.user._id,
				isCameraOff,
			});
		});

		socket.on("toggle-screen-share", ({ isScreenSharing }) => {
			const roomName = `meeting:${socket.meetingId}`;
			if (!socket.meetingId) return;

			const room = rooms.get(socket.meetingId);
			const entry = room?.get(socket.user._id.toString());
			if (entry) entry.isScreenSharing = isScreenSharing;

			socket.to(roomName).emit("participant-state-changed", {
				socketId: socket.id,
				userId: socket.user._id,
				isScreenSharing,
			});
		});

		// IN-MEETING CHAT
		socket.on("send-chat", async ({ message }, callback) => {
			try {
				if (!socket.meetingId || !message?.trim()) {
					return callback?.({ success: false, message: "Invalid message" });
				}

				const trimmed = message.trim().slice(0, 1000);

				// Persist first
				const saved = await chatMessageModel.create({
					meeting: socket.meetingId,
					user: socket.user._id,
					senderName: socket.user.name,
					senderUsername: socket.user.username,
					senderProfileImage: socket.user.profileImage || "",
					message: trimmed,
					type: "USER",
				});

				// Broadcast the persisted doc
				const payload = {
					_id: saved._id.toString(),
					meeting: socket.meetingId,
					from: {
						userId: socket.user._id,
						name: saved.senderName,
						username: saved.senderUsername,
						profileImage: saved.senderProfileImage,
					},
					message: saved.message,
					sentAt: saved.createdAt.toISOString(),
					type: saved.type,
				};

				const roomName = `meeting:${socket.meetingId}`;
				io.to(roomName).emit("chat-message", payload);

				callback?.({ success: true, data: payload });
			} catch (err) {
				console.error("send-chat error:", err);
				callback?.({ success: false, message: "Failed to send message" });
			}
		});

		socket.on("chat-message-deleted", ({ meetingId, messageId }) => {
			if (!meetingId || !messageId) return;
			if (socket.meetingId !== meetingId) return; // safety: only for your room

			socket
				.to(`meeting:${meetingId}`)
				.emit("chat-message-deleted", { messageId });
		});

		// HOST ACTIONS
		socket.on("host-mute-user", ({ targetSocketId }) => {
			io.to(targetSocketId).emit("force-muted");
		});

		socket.on("host-kick-user", ({ targetSocketId }) => {
			io.to(targetSocketId).emit("kicked");
		});

		socket.on("host-end-meeting", () => {
			if (!socket.meetingId) return;
			io.to(`meeting:${socket.meetingId}`).emit("meeting-ended");
		});

		//  Recording started
		socket.on("recording-started", () => {
			if (!socket.meetingId) return;
			socket.to(`meeting:${socket.meetingId}`).emit("recording-started", {
				byUserId: socket.user._id,
				byName: socket.user.name,
			});
		});

		//  Recording stopped
		socket.on("recording-stopped", () => {
			if (!socket.meetingId) return;
			socket.to(`meeting:${socket.meetingId}`).emit("recording-stopped", {
				byUserId: socket.user._id,
			});
		});

		// forced to stop user host
		socket.on("host-stop-share", ({ targetSocketId }) => {
			io.to(targetSocketId).emit("force-stop-share");
		});

		// LEAVE / DISCONNECT
		socket.on("leave-meeting", () => {
			handleLeave(socket, true);
		});

		socket.on("disconnect", () => {
			console.log(`🔌 Socket disconnected: ${socket.id}`);
			handleLeave(socket, false);
		});
	});

	return io;
};

/**
 * Common leave handler
 * @param {*} socket
 * @param {boolean} explicit — true if user clicked "Leave"
 */
async function handleLeave(socket, explicit) {
	try {
		const meetingId = socket.meetingId;
		if (!meetingId) return;

		const roomName = `meeting:${meetingId}`;
		socket.leave(roomName);

		const room = rooms.get(meetingId);
		if (room) {
			room.delete(socket.user._id.toString());
			if (room.size === 0) rooms.delete(meetingId);
		}

		// Notify remaining participants
		socket.to(roomName).emit("participant-left", {
			socketId: socket.id,
			userId: socket.user._id,
			name: socket.user.name,
		});

		// Optionally mark participant left in DB for explicit leave
		// (REST leaveMeeting also does this — idempotent)
		if (explicit) {
			await participantModel.findOneAndUpdate(
				{ meeting: meetingId, user: socket.user._id, leftAt: null },
				{ $set: { leftAt: new Date(), isScreenSharing: false } },
			);
		}

		socket.meetingId = null;
		socket.participantId = null;
	} catch (err) {
		console.error("handleLeave error:", err);
	}
}

/**
 * Utility: get current participants of a room (used by REST controllers if needed)
 */
const getRoomParticipants = (meetingId) => {
	const room = rooms.get(meetingId);
	if (!room) return [];
	return Array.from(room.values());
};

module.exports = { initSocket, getRoomParticipants, getIO };
