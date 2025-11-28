// index.js
// Simple YouTube OAuth + command bot for Render
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import bodyParser from "body-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SESSION_SECRET = "change_this",
  PORT = 3000,
  APP_URL // e.g. https://your-app.onrender.com
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !APP_URL) {
  console.error("Missing required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${APP_URL}/oauth2callback`
);

// request scopes for basic YouTube read & manage if needed
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  // add scopes you need, e.g. "https://www.googleapis.com/auth/youtube.force-ssl" to manage
];

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // secure:true requires HTTPS (Render does HTTPS)
}));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// home page
app.get("/", (req, res) => {
  res.render("index", { user: req.session.user || null });
});

// start OAuth flow
app.get("/auth", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
  });
  res.redirect(authUrl);
});

// OAuth callback
app.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("No code in query");

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Save tokens in session (for demo). For production store securely (DB/Secret).
    req.session.tokens = tokens;

    // get own channel info
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const me = await youtube.channels.list({
      part: "id,snippet,statistics",
      mine: true
    });

    req.session.user = me.data.items && me.data.items[0] ? {
      id: me.data.items[0].id,
      title: me.data.items[0].snippet.title,
      subs: me.data.items[0].statistics.subscriberCount || 0
    } : null;

    // After login, redirect to a friendly Render page (home) which shows you're logged in
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth exchange failed: " + err.message);
  }
});

// Example: fetch info for @VortexWizrd channel (search by forUsername or by search)
app.get("/channel/vortex", async (req, res) => {
  try {
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    // use the search endpoint to find the channel by name
    const search = await youtube.search.list({
      part: "snippet",
      q: "VortexWizrd",
      type: "channel",
      maxResults: 1
    });
    if (!search.data.items || search.data.items.length === 0) {
      return res.json({ found: false });
    }
    const channelId = search.data.items[0].snippet.channelId;
    const channel = await youtube.channels.list({
      part: "snippet,statistics",
      id: channelId
    });
    res.json(channel.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
  Command endpoint:
  POST /api/command
  body: { user: "username", message: "@someone !hello" }
  Returns: { reply: "..." }
*/
app.post("/api/command", (req, res) => {
  const { user, message } = req.body;
  if (!message) return res.status(400).json({ error: "message required"});

  const trimmed = message.trim();
  // find mention
  const mentionMatch = trimmed.match(/@([A-Za-z0-9_]+)/);
  const mention = mentionMatch ? mentionMatch[1] : null;

  // command prefix '!'
  const cmdMatch = trimmed.match(/!(\w+)/);
  const cmd = cmdMatch ? cmdMatch[1].toLowerCase() : null;

  const commands = {
    hello: () => `@${user} Hey there! 👋`,
    joke: () => {
      const jokes = [
        "Why did the developer go broke? Because he used up all his cache.",
        "Why do programmers prefer dark mode? Because light attracts bugs."
      ];
      return jokes[Math.floor(Math.random()*jokes.length)];
    },
    commands: () => `@${user} Available: !hello, !joke, !commands, !info`,
    info: () => {
      const info = req.session && req.session.user ? `Bot logged in as ${req.session.user.title} (subs: ${req.session.user.subs})` : "Bot not authenticated.";
      return `@${user} ${info}`;
    }
  };

  // Mention response example
  if (mention) {
    // friendly mention reply
    return res.json({ reply: `@${mention} ${user} says hi!` });
  }

  if (cmd && commands[cmd]) {
    return res.json({ reply: commands[cmd]() });
  }

  // default response
  res.json({ reply: `@${user} I didn't get that. Type !commands to see what I can do.` });
});

// static assets (if you want)
app.use("/static", express.static(path.join(__dirname, "static")));

app.listen(process.env.PORT || PORT, () => {
  console.log("Server started on port", process.env.PORT || PORT);
});
