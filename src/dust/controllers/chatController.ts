import type { Request, Response } from "express";
import { generateResponse } from "../services/llmService";

export const chat = async (req: Request, res: Response) => {
  try {
    const { message, language, history } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const response = await generateResponse(
      message,
      language,
      history
    );

    return res.json({
      success: true,
      data: {
        response,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};