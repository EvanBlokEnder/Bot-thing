// index.js
const express = require("express");
const { google } = require("googleapis");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -----------------------
// CONFIG (YOU MUST FILL THIS)
// -----------------------
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; 
// example render redirect: https://yourapp.onrender.com/oauth2callback

let oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

let ACCESS_TOKEN = null;
let REFRESH_TOKEN = null;
let LIVE_CHAT_ID = null;
let CHANNEL_ID = null;

// -----------------------
// LOGIN BUTTON → GOOGLE AUTH URL
// -----------------------
app.get("/login", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.force-ssl"
  ];

  const url = oauth.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent"
  });

  res.redirect(url);
});

// -----------------------
// OAUTH CALLBACK
// -----------------------
app.get("/oauth2callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);

    ACCESS_TOKEN = tokens.access_token;
    REFRESH_TOKEN = tokens.refresh_token;

    console.log("✅ Login success!");
    console.log("Access Token:", ACCESS_TOKEN);

    // Fetch channel
    const yt = google.youtube("v3");
    const me = await yt.channels.list({
      auth: oauth,
      mine: true,
      part: "id,snippet"
    });

    CHANNEL_ID = me.data.items[0].id;
    console.log("Logged into channel:", CHANNEL_ID);

    res.send(`
      <h1>YouTube Bot Connected!</h1>
      <p>Your channel ID: ${CHANNEL_ID}</p>
      <a href="/find-live">Find Live Stream</a><br>
      <a href="/send-test">Send Test Message</a>
    `);
  } catch (err) {
    console.error(err);
    res.send("OAuth Error");
  }
});

// -----------------------
// FIND LATEST LIVE STREAM
// -----------------------
app.get("/find-live", async (req, res) => {
  try {
    const yt = google.youtube("v3");

    const live = await yt.search.list({
      auth: oauth,
      channelId: CHANNEL_ID,
      eventType: "live",
      type: "video",
      part: "id,snippet"
    });

    if (!live.data.items.length) {
      return res.send("❌ No active live stream found!");
    }

    const videoId = live.data.items[0].id.videoId;

    // Get live chat ID
    const video = await yt.videos.list({
      auth: oauth,
      id: videoId,
      part: "liveStreamingDetails"
    });

    LIVE_CHAT_ID = video.data.items[0].liveStreamingDetails.activeLiveChatId;

    console.log("🎥 LIVE CHAT ID:", LIVE_CHAT_ID);

    res.send(`
      <h1>Live Chat Connected!</h1>
      <p>Video ID: ${videoId}</p>
      <p>Live Chat ID: ${LIVE_CHAT_ID}</p>
      <a href="/start-bot">Start Bot</a>
    `);
  } catch (err) {
    console.error(err);
    res.send("Error finding live stream.");
  }
});

// -----------------------
// SEND TEST MESSAGE
// -----------------------
app.get("/send-test", async (req, res) => {
  if (!LIVE_CHAT_ID) return res.send("❌ No live chat detected.");

  await sendMessageToChat("test success");
  res.send("Sent: test success");
});

// -----------------------
// START BOT LOOP
// -----------------------
let botRunning = false;

app.get("/start-bot", async (req, res) => {
  if (botRunning) return res.send("Bot already running.");

  botRunning = true;
  res.send("Bot started!");

  botLoop();
});

// -----------------------
// BOT LOOP
// -----------------------
async function botLoop() {
  while (botRunning) {
    try {
      const messages = await getChatMessages();
      for (const msg of messages) {
        const user = msg.authorDetails.displayName;
        const text = msg.snippet.displayMessage;

        console.log(`${user}: ${text}`);

        await processCommand(user, text);
      }
    } catch (err) {
      console.error("Bot Loop Error:", err);
    }

    await wait(2500);
  }
}

// -----------------------
// COMMAND HANDLER
// -----------------------
async function processCommand(user, text) {
  const nameTag = `@${user}`;

  if (text === "!cmdslist") {
    const cmds = [
      "!hello",
      "!ping",
      "!cmdslist",
      "!random",
      "!info",
      "!vibe",
      "!8ball",
      "!rate",
      "!pick a,b"
    ].join("\n");

    return sendMessageToChat(`${nameTag}\n\n${cmds}`);
  }

  if (text === "!hello") {
    return sendMessageToChat(`${nameTag} Hello! 👋`);
  }

  if (text === "!ping") {
    return sendMessageToChat(`${nameTag} pong!`);
  }

  if (text === "!info") {
    return sendMessageToChat(`${nameTag} I am connected to channel ${CHANNEL_ID}`);
  }

  if (text === "!random") {
    return sendMessageToChat(`${nameTag} Random: ${Math.floor(Math.random() * 99999)}`);
  }

  if (text === "!vibe") {
    const vibes = ["🔥 HYPED", "😎 chill", "💀 tired", "🤖 robotic"];
    const v = vibes[Math.floor(Math.random() * vibes.length)];
    return sendMessageToChat(`${nameTag} Your vibe: ${v}`);
  }

  if (text === "!8ball") {
    const ans = [
      "Yes", "No", "Maybe", "Definitely", "Ask again", "No chance"
    ];
    return sendMessageToChat(`${nameTag} ${ans[Math.floor(Math.random() * ans.length)]}`);
  }

  if (text.startsWith("!pick ")) {
    const parts = text.replace("!pick ", "").split(",");
    if (parts.length === 2) {
      const choice = parts[Math.floor(Math.random() * 2)];
      return sendMessageToChat(`${nameTag} I pick: ${choice.trim()}`);
    }
  }
}

// -----------------------
// FETCH CHAT MESSAGES
// -----------------------
async function getChatMessages() {
  const yt = google.youtube("v3");

  const res = await yt.liveChatMessages.list({
    auth: oauth,
    liveChatId: LIVE_CHAT_ID,
    part: "snippet,authorDetails"
  });

  return res.data.items || [];
}

// -----------------------
// SEND MESSAGE TO CHAT
// -----------------------
async function sendMessageToChat(msg) {
  const yt = google.youtube("v3");

  return yt.liveChatMessages.insert({
    auth: oauth,
    part: "snippet",
    requestBody: {
      snippet: {
        liveChatId: LIVE_CHAT_ID,
        type: "textMessageEvent",
        textMessageDetails: { messageText: msg }
      }
    }
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.get("/", (req, res) => {
  res.send(`<a href="/login">Login with Google</a>`);
});

app.listen(3000, () => console.log("Bot running on port 3000"));
