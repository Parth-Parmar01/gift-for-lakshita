import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { MongoClient } from "mongodb";

const app = express();
const port = Number(process.env.PORT || 3001);
const sitePassword = process.env.SITE_PASSWORD;
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || "birthday_surprises";
const accessCookieName = "birthday_access";
const accessCookieLifetime = 12 * 60 * 60 * 1000;
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = fs.existsSync(path.join(projectRoot, "dist"))
  ? path.join(projectRoot, "dist")
  : projectRoot;

if (!mongoUri) {
  throw new Error("MONGODB_URI is required. Add it to a .env file before starting the API.");
}

const client = new MongoClient(mongoUri);
app.set("trust proxy", 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fieldSize: 2 * 1024 * 1024, files: 10, fileSize: 10 * 1024 * 1024 },
});

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function safeReturnPath(value) {
  try {
    const target = new URL(String(value || "/"), "http://localhost");
    if (target.origin !== "http://localhost" || target.pathname === "/access") return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

function readCookie(req, name) {
  const cookie = String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) return "";
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return "";
  }
}

function hasValidAccessCookie(req) {
  if (!sitePassword) return false;
  const [expiresAt, providedSignature, extra] = readCookie(req, accessCookieName).split(".");
  const expiration = Number(expiresAt);
  if (extra || !Number.isFinite(expiration) || expiration <= Date.now()) return false;
  if (expiration > Date.now() + accessCookieLifetime + 60_000) return false;

  const expectedSignature = crypto
    .createHmac("sha256", sitePassword)
    .update(expiresAt)
    .digest("base64url");
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature || "");
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function renderAccessPage(res, { next = "/", error = "", status = 200 } = {}) {
  const nextPath = safeReturnPath(next);
  const configurationError = !sitePassword
    ? "Site access is not configured. Please contact the site owner."
    : "";
  const message = configurationError || error;
  res.status(configurationError ? 503 : status);
  res.set("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#2e1330"><title>Private surprise</title>
<style>
*{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:20px;place-items:center;background:radial-gradient(125% 95% at 50% 82%,#4a1e2e 0,#2e1330 46%,#170a18 100%);color:#fbefe0;font:16px/1.5 "Segoe UI",sans-serif}.gate{width:min(100%,420px);padding:32px 24px;border:1px solid rgba(255,231,203,.24);border-radius:10px;background:rgba(20,8,18,.55);box-shadow:0 20px 60px rgba(0,0,0,.28)}h1{margin:0 0 8px;color:#fff2e1;font:500 32px Georgia,serif;text-align:center}p{margin:0 0 24px;color:#d8c2b2;text-align:center}label{display:block;margin-bottom:8px;color:#f7e8d8}input{width:100%;min-height:48px;padding:0 12px;border:1px solid rgba(255,231,203,.34);border-radius:6px;background:rgba(20,8,18,.7);color:#fff4e6;font:inherit}button{width:100%;min-height:48px;margin-top:14px;border:1px solid rgba(255,231,203,.5);border-radius:6px;background:rgba(255,239,220,.16);color:#fff4e6;font:700 16px inherit;cursor:pointer}button:hover{background:rgba(255,239,220,.25)}.error{min-height:24px;margin:12px 0 0;color:#ffd1c9;font-size:14px;text-align:left}
</style></head><body><main class="gate"><h1>A private surprise</h1><p>Enter the password to continue.</p><form method="post" action="/access"><input type="hidden" name="next" value="${escapeHtml(nextPath)}"><label for="site-password">Password</label><input id="site-password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Continue</button><p class="error" role="alert">${escapeHtml(message)}</p></form></main></body></html>`);
}

const loginAttempts = new Map();
const loginAttemptWindow = 15 * 60 * 1000;
const maximumLoginAttempts = 8;

app.get("/access", (req, res) => {
  if (hasValidAccessCookie(req)) return res.redirect(303, safeReturnPath(req.query.next));
  renderAccessPage(res, { next: req.query.next });
});

app.post("/access", (req, res) => {
  const next = safeReturnPath(req.body.next);
  if (!sitePassword) return renderAccessPage(res, { next });

  const now = Date.now();
  const attemptKey = req.ip || req.socket.remoteAddress || "unknown";
  let attempts = loginAttempts.get(attemptKey);
  if (!attempts || attempts.resetAt <= now) {
    attempts = { count: 0, resetAt: now + loginAttemptWindow };
    loginAttempts.set(attemptKey, attempts);
  }
  if (attempts.count >= maximumLoginAttempts) {
    return renderAccessPage(res, { next, error: "Too many attempts. Please try again in 15 minutes.", status: 429 });
  }
  attempts.count += 1;

  const submittedHash = crypto.createHash("sha256").update(String(req.body.password || "")).digest();
  const expectedHash = crypto.createHash("sha256").update(sitePassword).digest();
  if (!crypto.timingSafeEqual(submittedHash, expectedHash)) {
    return renderAccessPage(res, { next, error: "That password was not correct. Please try again.", status: 401 });
  }

  loginAttempts.delete(attemptKey);
  const expiresAt = String(now + accessCookieLifetime);
  const signature = crypto.createHmac("sha256", sitePassword).update(expiresAt).digest("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${accessCookieName}=${expiresAt}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${accessCookieLifetime / 1000}${secure}`,
  );
  res.set("Cache-Control", "no-store");
  res.redirect(303, next);
});

app.use((req, res, next) => {
  if (hasValidAccessCookie(req)) {
    res.set("Cache-Control", "private, no-store");
    return next();
  }
  res.set("Cache-Control", "no-store");
  res.redirect(303, `/access?next=${encodeURIComponent(req.originalUrl)}`);
});

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildSurpriseData(fields, files) {
  const data = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeValue(value)]),
  );

  if (files.length) {
    data.uploadedPhotos = files.map((file) => ({
      name: file.originalname,
      type: file.mimetype,
      data: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    }));
  }

  return data;
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

async function sendOtpWebhook({ code, link, otp }) {
  const webhook = process.env.WEBHOOK;
  if (!webhook) throw new Error("WEBHOOK is required to deliver the unlock OTP.");

  const webhookUrl = new URL(webhook);
  webhookUrl.searchParams.set("wait", "true");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Birthday Link OTP",
      content: `Your OTP is **${otp}**.\nLink code: ${code}\nLink: ${link}`,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 200);
    throw new Error(`The unlock OTP could not be sent (webhook ${response.status}): ${details}`);
  }

  console.log(`Unlock OTP delivered through webhook for link ${code}.`);
}

async function surprisesCollection() {
  if (!client.topology?.isConnected()) await client.connect();
  return client.db(databaseName).collection("surprises");
}

app.post("/api/upload-photo", upload.any(), async (req, res, next) => {
  try {
    const file = req.files && req.files[0];
    if (!file) return res.status(400).json({ error: "No photo provided." });
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    res.json({ status: "success", data: { url: dataUrl, display_url: dataUrl } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/create", upload.any(), async (req, res, next) => {
  try {
    const code = crypto.randomBytes(6).toString("base64url");
    const otp = String(crypto.randomInt(100000, 1000000));
    const data = buildSurpriseData(req.body, req.files || []);
    const link = `${process.env.PUBLIC_URL || "http://localhost:5173"}/s/${code}`;
    const collection = await surprisesCollection();

    await collection.insertOne({
      code,
      data,
      otpHash: hashOtp(otp),
      createdAt: new Date(),
      visits: 0,
    });
    await sendOtpWebhook({ code, link, otp });
    res.status(201).json({ status: "success", code, shortCode: code, link, url: link, data });
  } catch (error) {
    next(error);
  }
});

app.post("/api/unlock", async (req, res, next) => {
  try {
    const code = String(req.body.code || "").trim();
    const otp = String(req.body.otp || "").trim();
    if (!code || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Enter the 6-digit OTP." });

    const collection = await surprisesCollection();
    const surprise = await collection.findOne({ code }, { projection: { _id: 0, otpHash: 1 } });
    if (!surprise || surprise.otpHash !== hashOtp(otp)) {
      return res.status(401).json({ error: "That OTP is not correct. Try again." });
    }

    const link = `${process.env.PUBLIC_URL || "http://localhost:5173"}/s/${code}`;
    res.json({ status: "success", link });
  } catch (error) {
    next(error);
  }
});

app.post("/api/create-order", (_req, res) => {
  res.json({ status: "success", order_id: crypto.randomUUID(), amount: 0, currency: "INR" });
});

app.get("/api/order-status", (_req, res) => {
  res.json({ status: "success", payment_status: "SUCCESS" });
});

async function getSurprise(req, res, next) {
  try {
    const collection = await surprisesCollection();
    const surprise = await collection.findOneAndUpdate(
      { code: req.params.code },
      { $inc: { visits: 1 } },
      { returnDocument: "after", projection: { _id: 0, data: 1, code: 1 } },
    );

    if (!surprise) return res.status(404).json({ error: "Surprise not found" });
    res.json({ status: "success", code: surprise.code, data: surprise.data, surprise: surprise.data });
  } catch (error) {
    next(error);
  }
}

app.get("/api/s/:code", getSurprise);
app.get("/api/view/:code", getSurprise);

app.post("/api/visit", async (req, res, next) => {
  try {
    const collection = await surprisesCollection();
    if (req.body.code) await collection.updateOne({ code: req.body.code }, { $inc: { visits: 1 } });
    res.json({ status: "success" });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(webRoot));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(webRoot, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const isMongoError = error?.name?.startsWith("Mongo") || error?.errorLabelSet;
  res.status(isMongoError ? 503 : 500).json({
    error: isMongoError
      ? "MongoDB is unavailable. Check Atlas Network Access and the MONGODB_URI, then retry."
      : error?.message || "The surprise could not be saved. Check the API and MongoDB configuration.",
  });
});

app.listen(port, () => {
  console.log(`Birthday API listening on http://localhost:${port}`);
});
