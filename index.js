// index.js – YouTube Bot with Comment Replies
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SESSION_SECRET = "strongsecret",
  APP_URL,
  PORT = 3000
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !APP_URL) {
  console.error("Missing env vars.");
  process.exit(1);
}

// OAuth client
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${APP_URL}/oauth2callback`
);

// Scope REQUIRED for comment posting
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl"
];

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

// ================== LOGIN PAGE ==================
app.get("/", (req, res) => {
  res.send(`
    <h1>YouTube Bot</h1>
    ${req.session.user ? `
      <p>Logged in as <b>${req.session.user.title}</b></p>
      <a href="/test">Test Command</a>
    ` : `
      <a href="/auth">Login with Google</a>
    `}
  `);
});

// ================== AUTH ==================
app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
  });
  res.redirect(url);
});

// ================== OAUTH CALLBACK ==================
app.get("/oauth2callback", async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    req.session.tokens = tokens;

    const yt = google.youtube({ version: "v3", auth: oauth2Client });
    const me = await yt.channels.list({
      part: "snippet,statistics",
      mine: true
    });

    const channel = me.data.items[0];
    req.session.user = {
      id: channel.id,
      title: channel.snippet.title
    };

    res.redirect("/");
  } catch (e) {
    console.error(e);
    res.send("OAuth failure.");
  }
});

// ================== BOT COMMAND LIST ==================
const commandList = [
  "!hello – friendly greeting",
  "!hi – same as hello",
  "!ping – bot replies pong",
  "!joke – random joke",
  "!fact – random fact",
  "!rate – rates user 1-10",
  "!8ball – magic 8-ball",
  "!vibe – vibe score",
  "!latest – fetch latest video",
  "!subs – subscriber count",
  "!cmdslist – show list of commands (this)"
].slice(0, 60); // ensure max 60 lines

// ================== WRITE COMMENT ON YOUTUBE ==================
async function postComment(videoId, message) {
  const yt = google.youtube({ version: "v3", auth: oauth2Client });

  const resp = await yt.commentThreads.insert({
    part: "snippet",
    requestBody: {
      snippet: {
        videoId,
        topLevelComment: {
          snippet: {
            textOriginal: message
          }
        }
      }
    }
  });

  return resp.data;
}

// ================== TEST PAGE ==================
app.get("/test", (req, res) => {
  res.send(`
    <h3>Test a Command (does not post to YouTube yet)</h3>
    <form action="/api/command" method="POST">
      <input name="user" placeholder="username" />
      <input name="message" placeholder="!hello or @someone" />
      <button>Send</button>
    </form>
  `);
});

// ================== COMMAND API ==================
app.post("/api/command", async (req, res) => {
  const user = req.body.user || "user";
  const msg = (req.body.message || "").trim();

  const mention = msg.startsWith("@") ? msg.split(" ")[0].substring(1) : null;
  const cmd = msg.startsWith("!") ? msg.substring(1).toLowerCase() : null;

  const responses = {
    hello: () => `@${user} Hello! 👋`,
    hi: () => `@${user} Hi there!`,
    ping: () => `@${user} pong!`,
    joke: () => `@${user} Why do programmers prefer dark mode? Because light attracts bugs.`,
    fact: () => `@${user} Fun fact: Honey never spoils.`,
    rate: () => `@${user} I rate you ${Math.floor(Math.random()*10)+1}/10`,
    "8ball": () => `@${user} ${["Yes!", "No!", "Maybe...", "Ask again."][Math.floor(Math.random()*4)]}`,
    vibe: () => `@${user} Your vibe is ${Math.floor(Math.random()*101)}% today.`,
    cmdslist: () => commandList.join("\n")
  };

  // ================== MENTION ONLY ==================
  if (mention && !cmd) {
    return res.json({ reply: `@${mention} (${user} says hi!)` });
  }

  // ================== COMMAND ==================
  if (cmd && responses[cmd]) {
    return res.json({ reply: responses[cmd]() });
  }

  res.json({ reply: `@${user} Unknown command. Try !cmdslist` });
});

// ================== START ==================
app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
