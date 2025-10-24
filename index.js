const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
// app.use(cors());
app.use(express.json());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.6zoig.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const ipTvCollection = client.db("TvCollection").collection("ipTvs");
const usersCollection = client.db("TvCollection").collection("users");
const watchTimeCollection = client.db("TvCollection").collection("watchTime");

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

// verify admin
const verifyAdmin = async (req, res, next) => {
  if (!req.user || !req.user.email) {
    return res.status(401).json({ message: "Unauthorized - No user info" });
  }
  try {
    const email = req.user.email;
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "admin")
      return res.status(403).json({ message: "Forbidden - Admins only" });
    next();
  } catch (err) {
    console.error("verifyAdmin error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

async function run() {
  try {
    await client.connect();

    // Generate JWT token
    app.post("/jwt", async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });

      const token = jwt.sign({ email }, process.env.secret_key, {
        expiresIn: "7d",
      });
      res.json({ token });
    });

    // GET all channels
    app.get("/", async (req, res) => {
      const result = await ipTvCollection.find().toArray();
      res.json(result);
    });

    // POST a new channel
    app.post("/", verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await ipTvCollection.insertOne(data);
      res.json(result);
    });

    // DELETE a channel (protected)
    app.delete("/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: "Invalid ID" });

      const result = await ipTvCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ success: true, deleteCount: result.deletedCount });
    });
    //  delete user
    app.delete("/dashBoard/allUsers/:id", verifyToken, async (req, res) => {
      const { id } = req.params;

      const userToDelete = await usersCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!userToDelete)
        return res.status(404).json({ message: "User not found" });

      if (req.user.email === userToDelete.email) {
        return res
          .status(403)
          .json({ message: "You can't delete your own account" });
      }

      const result = await usersCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json({ message: "User deleted successfully" });
    });
    // UPDATE a channel
    app.put("/:id", verifyToken, verifyAdmin, async (req, res) => {
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
    });

    // test start
    app.post("/watch", async (req, res) => {
      const { channelUrl, channelName, seconds } = req.body;
      const filter = { channelUrl };
      const update = {
        $inc: { totalSeconds: seconds },
        $set: { channelName, updatedAt: new Date() },
      };
      const options = { upsert: true };

      try {
        const result = await watchTimeCollection.updateOne(
          filter,
          update,
          options
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: "Something went wrong" });
      }
    });

    app.get(
      "/dashboard/watchTime",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await watchTimeCollection.find().toArray();
        res.send(result);
      }
    );
    // test end

    // Add a user
    app.post("/users", async (req, res) => {
      const { name, email, role } = req.body;
      if (!name || !email)
        return res.status(400).json({ message: "Name & Email required" });

      const exist = await usersCollection.findOne({ email });
      if (exist)
        return res.json({ message: "User already exists", user: exist });

      const result = await usersCollection.insertOne({
        name,
        email,
        role: role || "user",
      });

      res.json({ message: "User saved", user: result });
    });
    // user get
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    // admin set
    app.patch(
      "/dashBoard/allUsers/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { role } = req.body;
        if (req.user.email === email) {
          return res.status(403).json({
            success: false,
            message: "You cannot change your own role",
          });
        }
        if (!["admin", "user"].includes(role)) {
          return res.status(400).json({ message: "Invalid role type" });
        }
        const result = await usersCollection.updateOne(
          { email },
          {
            $set: { role },
          }
        );
        if (result.modifiedCount > 0) {
          res.json({ success: true, message: `User role updated to ${role}` });
        } else {
          res.json({
            success: false,
            message: "No user found or already same role",
          });
        }
      }
    );
    // Ping MongoDB to verify connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Connected to MongoDB successfully!");
    module.exports = app;
  } catch (err) {}
}

run().catch(console.dir);

// app.listen(port, () => {
//   console.log(`✅ Server running on port ${port}`);
// });
