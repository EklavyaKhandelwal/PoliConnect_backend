import express from "express";
import cors from "cors";
import router from "./routes";
import { connectDB } from "./config/db";
import { errorMiddleware } from "./middleware/error.middleware";


const app = express();

const configuredOrigins = [
  process.env.FRONTEND_URL || "http://localhost:5173",
  process.env.ADMIN_FRONTEND_URL || "http://127.0.0.1:5181",
]
  .join(",")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (requestOrigin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (
      !requestOrigin ||
      process.env.NODE_ENV !== "production" ||
      configuredOrigins.includes(requestOrigin) ||
      requestOrigin === "capacitor://localhost" ||
      requestOrigin === "http://localhost" ||
      requestOrigin === "https://localhost"
    ) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-guest-id",
    "ngrok-skip-browser-warning",
  ],
  exposedHeaders: ["x-guest-id"],
  credentials: true,
};

app.use(cors(corsOptions));

app.options(/.*/, cors(corsOptions));

app.use(express.json());
app.use("/uploads", express.static(process.env.FILE_STORAGE_DIR || "storage"));
app.use('/api/v1',router);

connectDB()


app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is running",
  });
});

app.use(errorMiddleware);

export default app;