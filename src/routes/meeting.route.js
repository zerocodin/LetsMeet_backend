const express = require("express");

const { protect } = require("../middleware/auth.middleware");
const meeting = require("../controller/meeting.controller");
const joinMeeting = require('../controller/participant.controller')
const host = require('../controller/host.controller')

const router = express.Router();

// static routes
router.post("/", protect, meeting.createMeeting);
router.post("/join", protect, joinMeeting.joinMeeting);
router.get("/my-meetings", protect, meeting.getMyMeetings);

// meeting specific routes
router.get("/:meetingCode/status", protect, joinMeeting.getMeetingStatus);
router.patch("/:meetingId/me/state", protect, joinMeeting.updateMyState);
router.post("/:meetingId/leave", protect, joinMeeting.leaveMeeting);
router.get("/:meetingId/participants", protect, joinMeeting.getParticipants);

// host controls
router.patch("/:meetingId/participants/:participantId/mute", protect, host.muteParticipant);
router.patch("/:meetingId/participants/:participantId/unmute", protect, host.unmuteParticipant);
router.patch("/:meetingId/participants/:participantId/promote", protect, host.promoteToCohost);
router.patch("/:meetingId/participants/:participantId/demote", protect, host.demoteFromCohost);
router.delete("/:meetingId/participants/:participantId", protect, host.removeParticipant);

// meeting generic routes
router.get("/:meetingId", protect, meeting.getMeetingById);
router.patch("/:meetingId", protect, meeting.updateMeeting);
router.delete("/:meetingId", protect, meeting.cancelMeeting);

module.exports = router;