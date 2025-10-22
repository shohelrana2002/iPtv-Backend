const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
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
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    await client.connect();
    const ipTvCollection = client.db("TvCollection").collection("ipTvs");
    const usersCollection = client.db("TvCollection").collection("users");

    // GET all channels
    app.get("/", async (req, res) => {
      const result = await ipTvCollection.find().toArray();
      res.json(result);
    });

    // POST a new channel
    app.post("/", async (req, res) => {
      const data = req.body;
      const result = await ipTvCollection.insertOne(data);
      res.json(result);
    });

    // DELETE a channel (protected)
    app.delete("/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: "Invalid ID" });

      const result = await ipTvCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ success: true, deleteCount: result.deletedCount });
    });

    // UPDATE a channel
    app.put("/:id", verifyToken, async (req, res) => {
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

    // Generate JWT token
    app.post("/jwt", async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });

      const token = jwt.sign({ email }, process.env.secret_key, {
        expiresIn: "7d",
      });
      res.json({ token });
    });

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
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    // Ping MongoDB to verify connection
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
