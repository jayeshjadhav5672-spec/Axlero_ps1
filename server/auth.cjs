const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("./models/User.cjs");
const { connectDb } = require("./db.cjs");

const JWT_EXPIRES_IN = "7d";
const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Dev-only fallback so `npm run dev:server` works with no env file.
// Production MUST set JWT_SECRET — see .env.example. Never commit a
// real secret; never send this value to the frontend.
const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me";
let warnedAboutDevSecret = false;

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!warnedAboutDevSecret) {
    warnedAboutDevSecret = true;
    console.warn(
      "[auth] JWT_SECRET is not set — using an insecure dev fallback. Set JWT_SECRET in production."
    );
  }
  return DEV_JWT_SECRET;
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    role: user.role ?? null,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      name: user.name,
      username: user.username ?? null,
      role: user.role ?? null,
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function readBearerToken(request) {
  const header = request.headers?.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

async function requireUser(request, response, next) {
  try {
    await connectDb();
  } catch {
    return response.status(503).json({ error: "Auth service unavailable (no database configured)" });
  }
  const token = readBearerToken(request);
  if (!token) return response.status(401).json({ error: "Missing auth token" });
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return response.status(401).json({ error: "Invalid or expired token" });
  }
  try {
    const user = await User.findById(decoded.sub);
    if (!user) return response.status(401).json({ error: "Invalid or expired token" });
    request.user = user;
    return next();
  } catch {
    return response.status(503).json({ error: "Auth service unavailable" });
  }
}

function validateEmail(email) {
  return typeof email === "string" && EMAIL_PATTERN.test(email.trim()) && email.trim().length <= 256;
}

function createAuthRouter() {
  const router = express.Router();

  async function ensureDb(response) {
    try {
      await connectDb();
      return true;
    } catch {
      response.status(503).json({ error: "Auth service unavailable (no database configured)" });
      return false;
    }
  }

  // POST /api/auth/signup — { name, email, password } only. No username.
  router.post("/signup", async (request, response) => {
    if (!(await ensureDb(response))) return;
    const { name, email, password } = request.body ?? {};
    if (typeof name !== "string" || !name.trim() || name.trim().length > 128) {
      return response.status(400).json({ error: "Name is required" });
    }
    if (!validateEmail(email)) {
      return response.status(400).json({ error: "A valid email is required" });
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return response
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        return response.status(409).json({ error: "An account with this email already exists" });
      }
      // Only the hash is stored — raw passwords are never persisted or logged.
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      });
      return response.status(201).json({ token: signToken(user), user: publicUser(user) });
    } catch {
      return response.status(500).json({ error: "Could not create account" });
    }
  });

  // POST /api/auth/login — { email, password } → same JWT shape as signup.
  router.post("/login", async (request, response) => {
    if (!(await ensureDb(response))) return;
    const { email, password } = request.body ?? {};
    if (!validateEmail(email) || typeof password !== "string" || !password) {
      return response.status(400).json({ error: "Email and password are required" });
    }
    try {
      const user = await User.findOne({ email: email.trim().toLowerCase() });
      // Generic message either way — never reveal which field was wrong.
      if (!user || !user.passwordHash) {
        return response.status(401).json({ error: "Invalid email or password" });
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return response.status(401).json({ error: "Invalid email or password" });
      }
      return response.json({ token: signToken(user), user: publicUser(user) });
    } catch {
      return response.status(500).json({ error: "Could not log in" });
    }
  });

  // POST /api/auth/google — { idToken } verified server-side, then the
  // same User model + JWT as login/signup (one identity system, not two).
  router.post("/google", async (request, response) => {
    if (!(await ensureDb(response))) return;
    const { idToken } = request.body ?? {};
    if (typeof idToken !== "string" || !idToken) {
      return response.status(400).json({ error: "Google ID token is required" });
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return response.status(503).json({ error: "Google sign-in is not configured" });
    }
    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        return response.status(401).json({ error: "Could not verify Google sign-in" });
      }
      const normalizedEmail = String(payload.email).toLowerCase();
      let user = await User.findOne({ googleId: payload.sub });
      if (!user) {
        user = await User.findOne({ email: normalizedEmail });
        if (user) {
          user.googleId = payload.sub;
          await user.save();
        } else {
          user = await User.create({
            name: payload.name || normalizedEmail.split("@")[0],
            email: normalizedEmail,
            googleId: payload.sub,
          });
        }
      }
      return response.json({ token: signToken(user), user: publicUser(user) });
    } catch {
      return response.status(401).json({ error: "Could not verify Google sign-in" });
    }
  });

  router.get("/me", requireUser, (request, response) => {
    return response.json({ user: publicUser(request.user) });
  });

  // PATCH /api/auth/username — the ONLY place a username is set
  // (usernames are created on the Profile page, never at signup).
  router.patch("/username", requireUser, async (request, response) => {
    const { username } = request.body ?? {};
    if (typeof username !== "string" || !username.trim()) {
      return response.status(400).json({ error: "Username is required" });
    }
    const trimmed = username.trim();
    if (!User.USERNAME_PATTERN?.test(trimmed)) {
      // Fall back to the schema rule when the export shape differs.
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(trimmed)) {
        return response.status(400).json({
          error: "Username must be 3–32 characters: letters, numbers, _ . -",
        });
      }
    }
    try {
      const taken = await User.findOne({ username: trimmed, _id: { $ne: request.user._id } });
      if (taken) {
        return response.status(409).json({ error: "That username is already taken" });
      }
      request.user.username = trimmed;
      await request.user.save();
      return response.json({ user: publicUser(request.user) });
    } catch (error) {
      if (error?.code === 11000) {
        return response.status(409).json({ error: "That username is already taken" });
      }
      return response.status(500).json({ error: "Could not save username" });
    }
  });

  return router;
}

module.exports = { createAuthRouter, signToken, verifyToken, publicUser, requireUser };
