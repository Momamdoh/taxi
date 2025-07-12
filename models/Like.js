// models/Like.js
const mongoose = require("mongoose");

const LikeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
    },
    status: {
      type: String,
      enum: ["like", "dislike"],
      required: true,
    }
  },
  { timestamps: true }
);

LikeSchema.index({ user: 1, driver: 1 }, { unique: true }); // عشان المستخدم يعمل like مرة واحدة فقط لكل سواق

const Like = mongoose.model("Like", LikeSchema);
module.exports = Like;
