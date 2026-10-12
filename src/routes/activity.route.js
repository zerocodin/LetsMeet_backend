const express = require("express");
const router = express.Router();
const { getActivityFeed } = require("../controller/activity.controller");
const { protect } = require("../middleware/auth.middleware");

router.get("/", protect, getActivityFeed);

module.exports = router;