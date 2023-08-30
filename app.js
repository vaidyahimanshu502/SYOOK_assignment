const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const crypto = require("crypto");
const MongoClient = require("mongodb").MongoClient;
const ejs = require("ejs");
const path = require("path");
require('dotenv').config()

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT_NUMBER || 8080;
const mongoUrl = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017';
const dbName = "timeSeriesDB";
const encryptionKey = process.env.SECRET_KEY; // Replace with your actual encryption key

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("index");
});

const emitterSocket = io.of("/emitter");

const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const generateRandomMessage = () => {
  const data = require("./data.json");
  const randomNameIndex = getRandomInt(0, data.names.length - 1);
  const randomCityIndex = getRandomInt(0, data.cities.length - 1);
  const message = {
    name: data.names[randomNameIndex],
    origin: data.cities[randomCityIndex],
    destination: data.cities[randomCityIndex],
  };

  const secret_key = crypto
    .createHash("sha256")
    .update(JSON.stringify(message))
    .digest("hex");

  const payload = {
    ...message,
    secret_key,
  };

  const cipher = crypto.createCipher("aes-256-ctr", encryptionKey);
  const encryptedMessage =
    cipher.update(JSON.stringify(payload), "utf8", "hex") + cipher.final("hex");

  return encryptedMessage;
};

emitterSocket.on("connection", (socket) => {
  console.log("Emitter connected to listener");

  setInterval(() => {
    const messagesCount = getRandomInt(49, 499);
    const messages = Array.from(
      { length: messagesCount },
      generateRandomMessage
    );
    const messageStream = messages.join("|");

    emitterSocket.emit("messageStream", messageStream); // Use emitterSocket to emit the event
  }, 10000); // Send message stream every 10 seconds
});

// io.on('connection', (socket) => {
//   console.log('Listener connected:', socket.id);

//   socket.on('messageStream', (messageStream) => {
//     const encryptedMessages = messageStream.split('|');
//     encryptedMessages.forEach((encryptedMessage) => {
//       validateAndSave(encryptedMessage);
//     });
//   });
// });
io.on("connection", (socket) => {
  console.log("Listener connected:", socket.id);

  socket.on("messageStream", async (messageStream) => {
    const encryptedMessages = messageStream.split("|");

    for (const encryptedMessage of encryptedMessages) {
      const decryptedPayload = decryptMessage(encryptedMessage);

      if (decryptedPayload) {
        const isValid = await validateAndSave(decryptedPayload);

        if (isValid) {
          emitterSocket.emit("message", decryptedPayload); // Emit valid data to frontend
        }
      }
    }
  });
});

function decryptMessage(encryptedMessage) {
  try {
    const decipher = crypto.createDecipher("aes-256-ctr", encryptionKey);
    const decryptedMessage =
      decipher.update(encryptedMessage, "hex", "utf8") + decipher.final("utf8");
    const payload = JSON.parse(decryptedMessage);
    return payload;
  } catch (error) {
    console.error("Error decrypting message:", error);
    return null;
  }
}

async function validateAndSave(data) {
  const decipher = crypto.createDecipher("aes-256-ctr", encryptionKey);
  const decryptedMessage =
    decipher.update(data, "hex", "utf8") + decipher.final("utf8");

  try {
    const payload = JSON.parse(decryptedMessage);
    const { name, origin, destination, secret_key } = payload;

    const calculatedSecretKey = crypto
      .createHash("sha256")
      .update(JSON.stringify({ name, origin, destination }))
      .digest("hex");
    if (calculatedSecretKey !== secret_key) {
      console.log("Invalid secret key. Discarding operation.");
      return false; // Validation failed
    }

    const client = new MongoClient(mongoUrl, { useUnifiedTopology: true });

    await client.connect();
    const db = client.db(dbName);

    const currentTime = new Date();
    const minuteStart = new Date(
      currentTime.getFullYear(),
      currentTime.getMonth(),
      currentTime.getDate(),
      currentTime.getHours(),
      currentTime.getMinutes()
    );

    await db
      .collection("timeSeriesData")
      .updateOne(
        { _id: minuteStart },
        { $push: { data: { timestamp: new Date(), ...payload } } },
        { upsert: true }
      );
    console.log("Data saved to MongoDB:", payload);

    client.close();
    return true;
  } catch (error) {
    console.error("Error processing data:", error);
  }
}

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
