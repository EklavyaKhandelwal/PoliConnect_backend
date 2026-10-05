import "dotenv/config";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { createInterface } from "node:readline/promises";
import { UserModel } from "../models/user.model";

const ask = async (question: string): Promise<string> => {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
};

const askSecret = (question: string): Promise<string> => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    reject(new Error("Run this command in an interactive terminal to enter the password securely."));
    return;
  }

  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  const onData = (chunk: Buffer) => {
    for (const character of chunk.toString("utf8")) {
      if (character === "\u0003") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        reject(new Error("Admin setup was cancelled."));
        return;
      }
      if (character === "\r" || character === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
      } else if (character >= " ") {
        value += character;
      }
    }
  };
  process.stdin.on("data", onData);
});

const run = async (): Promise<void> => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI must be configured.");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("Configure a JWT_SECRET of at least 32 characters before bootstrapping the owner.");
  }

  await mongoose.connect(process.env.MONGO_URI);
  if (await UserModel.exists({ role: "owner" })) {
    throw new Error("An admin owner already exists. Use the protected owner API to create more admins.");
  }

  const email = (await ask("Owner email: ")).toLowerCase();
  const name = await ask("Owner name: ");
  const password = await askSecret("Owner password (12+ characters, max 72 UTF-8 bytes): ");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address.");
  }
  if (name.length > 100) throw new Error("Name cannot exceed 100 characters.");
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password must be at least 12 characters and no more than 72 UTF-8 bytes.");
  }
  if (await UserModel.exists({ email })) {
    throw new Error("An account with this email already exists; the existing account was not changed.");
  }

  const owner = await UserModel.create({
    email,
    name,
    password: await bcrypt.hash(password, 12),
    role: "owner",
  });
  console.log(`Admin owner created for ${owner.email}. Start the admin site and sign in.`);
};

run()
  .catch((error: unknown) => {
    console.error("Could not bootstrap the admin owner:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
