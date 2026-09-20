const express = require("express");
const router = express.Router();
const friend = require("../controller/friend.controller");
const { protect } = require("../middleware/auth.middleware");

router.get("/", protect, friend.getFriends);
router.get("/requests", protect, friend.getRequests);
router.get("/search", protect, friend.searchUsers);
router.post("/request", protect, friend.sendFriendRequest);
router.patch("/request/:requestId", protect, friend.respondToRequest);
router.delete("/:friendId", protect, friend.removeFriend);

module.exports = router;