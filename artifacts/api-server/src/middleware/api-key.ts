import type { Request, Response, NextFunction } from "express";

export function requireLocalApiKey(req: Request, res: Response, next: NextFunction) {
  const expectedApiKey = process.env.LOCAL_API_KEY;

  if (!expectedApiKey) {
    res.status(500).json({
      error: "LOCAL_API_KEY is not configured on the server.",
    });
    return;
  }

  const receivedApiKey = req.header("x-api-key");
  if (receivedApiKey !== expectedApiKey) {
    res.status(401).json({ error: "Invalid API key." });
    return;
  }

  next();
}
