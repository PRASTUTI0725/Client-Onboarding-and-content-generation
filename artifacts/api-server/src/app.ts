import express, { type Express } from "express";
import cors from "cors";
import multer from "multer";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireLocalApiKey } from "./middleware/api-key.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-api-key",
      "x-ai-provider",
      "x-use-real-ai",
      "x-ai-api-key",
      "x-ai-model",
      "Accept",
    ],
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", requireLocalApiKey, router);

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    logger.warn(
      {
        err,
        code: err.code,
        field: err.field ?? null,
        route: req.originalUrl ?? req.url ?? null,
        failureStage: "upload_multipart",
      },
      "Multipart upload failed",
    );
    res.status(status).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "Uploaded PDF is too large. Maximum size is 8 MB."
          : "Invalid multipart upload. Please reattach the PDF and try again.",
      code: err.code,
      field: err.field ?? null,
    });
    return;
  }

  if (err?.type === "entity.too.large") {
    logger.warn({ err }, "Request body too large");
    res.status(413).json({ error: "Request payload is too large." });
    return;
  }

  logger.error(
    {
      err,
      db: {
        sqlState: err?.code ?? err?.cause?.code ?? null,
        detail: err?.detail ?? err?.cause?.detail ?? null,
        constraint: err?.constraint ?? err?.cause?.constraint ?? null,
        query: err?.query ?? err?.cause?.query ?? null,
        table: err?.table ?? err?.cause?.table ?? null,
      },
    },
    "Unhandled API error",
  );

  const pgDetail = err?.detail ?? err?.cause?.detail ?? null;
  res.status(500).json({
    error: "Internal server error",
    message: typeof err?.message === "string" ? err.message : String(err ?? ""),
    sqlState: err?.code ?? err?.cause?.code ?? null,
    detail: pgDetail,
    constraint: err?.constraint ?? err?.cause?.constraint ?? null,
  });
});

export default app;
