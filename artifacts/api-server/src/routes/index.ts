import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import clientsRouter from "./clients.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);

export default router;
