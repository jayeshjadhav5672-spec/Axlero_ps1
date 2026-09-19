const mongoose = require("mongoose");

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 128 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 256,
      index: true,
    },
    passwordHash: { type: String, default: null },
    // Chosen on the Profile page after signup — never at signup.
    username: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
      match: USERNAME_PATTERN,
    },
    // Optional. The two-person lobby rule reads this via the JWT, never
    // from a client-sent field.
    role: {
      type: String,
      default: null,
      enum: { values: ["instructor", "student"], message: "role must be instructor or student" },
    },
    googleId: { type: String, default: null, unique: true, sparse: true, index: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.User || mongoose.model("User", userSchema);
module.exports.USERNAME_PATTERN = USERNAME_PATTERN;
