const express = require("express");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();
const cors = require("cors");
require("dotenv").config();
const PORT = process.env.PORT || 4000;
const app = express();

// ✅ CORS middleware – অবশ্যই express.json() এর আগে রাখো
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://authenticationproject-750f2.web.app",
      "https://authenticationproject-750f2.firebaseapp.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ✅ এরপর JSON parser
app.use(express.json());

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};
//localhost:5000 and localhost:5173 are treated as same site.  so sameSite value must be strict in development server.  in production sameSite will be none
// in development server secure will false .  in production secure will be true
// MongoDB singleton connection for Vercel
let client;
let clientPromise;

const getClient = async () => {
  if (!clientPromise) {
    const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.6zoig.mongodb.net/?retryWrites=true&w=majority`;
    client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  await clientPromise;
  return client;
};

// Middleware: verify JWT
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res
      .status(401)
      .json({ message: "Unauthorized - No token provided" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.secret_key, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid token" });

    if (!decoded || !decoded.email) {
      return res.status(401).json({ message: "Invalid token data" });
    }
    req.user = decoded;
    next();
  });
};

// Middleware: verify Admin
const verifyAdmin = async (req, res, next) => {
  if (!req.user || !req.user.email) {
    return res.status(401).json({ message: "Unauthorized - No user info" });
  }
  try {
    const client = await getClient();
    const usersCollection = client.db("TvCollection").collection("users");

    const user = await usersCollection.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "admin")
      return res.status(403).json({ message: "Forbidden - Admins only" });

    next();
  } catch (err) {
    console.error("verifyAdmin error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Routes
app.post("/jwt", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email required" });
  const token = jwt.sign({ email }, process.env.secret_key, {
    expiresIn: "7d",
  });
  res.json({ token });
});

app.get("/", async (req, res) => {
  try {
    const client = await getClient();
    const ipTvCollection = client.db("TvCollection").collection("ipTvs");
    const result = await ipTvCollection.find().toArray();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/", async (req, res) => {
  console.log("hi");
  res.send("Server is running...");
});

app.post("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const client = await getClient();
    const ipTvCollection = client.db("TvCollection").collection("ipTvs");
    const result = await ipTvCollection.insertOne(req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.delete("/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const client = await getClient();
    const ipTvCollection = client.db("TvCollection").collection("ipTvs");
    const { id } = req.params;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const result = await ipTvCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true, deleteCount: result.deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.put("/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const client = await getClient();
    const ipTvCollection = client.db("TvCollection").collection("ipTvs");
    const { id } = req.params;
    const { name, group, logo, url } = req.body;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const result = await ipTvCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { name, group, logo, url } }
    );

    if (result.matchedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Channel not found" });

    res.json({ success: true, message: "Channel updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// WatchTime routes
app.post("/watch", async (req, res) => {
  try {
    const client = await getClient();
    const watchTimeCollection = client
      .db("TvCollection")
      .collection("watchTime");
    const { channelUrl, channelName, seconds } = req.body;

    const filter = { channelUrl };
    const update = {
      $inc: { totalSeconds: seconds },
      $set: { channelName, updatedAt: new Date() },
    };
    const options = { upsert: true };

    const result = await watchTimeCollection.updateOne(filter, update, options);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/dashboard/watchTime", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const client = await getClient();
    const watchTimeCollection = client
      .db("TvCollection")
      .collection("watchTime");
    const result = await watchTimeCollection.find().toArray();
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Users routes
app.post("/users", async (req, res) => {
  try {
    const client = await getClient();
    const usersCollection = client.db("TvCollection").collection("users");
    const { name, email, role } = req.body;

    if (!name || !email)
      return res.status(400).json({ message: "Name & Email required" });

    const exist = await usersCollection.findOne({ email });
    if (exist) return res.json({ message: "User already exists", user: exist });

    const result = await usersCollection.insertOne({
      name,
      email,
      role: role || "user",
    });
    res.json({ message: "User saved", user: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const client = await getClient();
    const usersCollection = client.db("TvCollection").collection("users");
    const result = await usersCollection.find().toArray();
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.delete("/dashBoard/allUsers/:id", verifyToken, async (req, res) => {
  try {
    const client = await getClient();
    const usersCollection = client.db("TvCollection").collection("users");
    const { id } = req.params;

    const userToDelete = await usersCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!userToDelete)
      return res.status(404).json({ message: "User not found" });
    if (req.user.email === userToDelete.email)
      return res
        .status(403)
        .json({ message: "You can't delete your own account" });

    await usersCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.patch(
  "/dashBoard/allUsers/:email",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const client = await getClient();
      const usersCollection = client.db("TvCollection").collection("users");
      const email = req.params.email;
      const { role } = req.body;

      if (req.user.email === email)
        return res
          .status(403)
          .json({ success: false, message: "You cannot change your own role" });
      if (!["admin", "user"].includes(role))
        return res.status(400).json({ message: "Invalid role type" });

      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );
      if (result.modifiedCount > 0)
        res.json({ success: true, message: `User role updated to ${role}` });
      else
        res.json({
          success: false,
          message: "No user found or already same role",
        });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);

module.exports = app;
// ✅ লোকাল টেস্টিংয়ের জন্য লিসেন ব্লক (ঐচ্ছিক, Vercel-এ এটি ব্যবহৃত হয় না)
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
