// routes/likes.js
const express = require("express");
const router = express.Router();
const { likeOrDislikeDriver, getDriverLikes } = require("../controllers/likeController");

router.post("/", likeOrDislikeDriver);
router.get("/driver/:driverId", getDriverLikes);

module.exports = router;
