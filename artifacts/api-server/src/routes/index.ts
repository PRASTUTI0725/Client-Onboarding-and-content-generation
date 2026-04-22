import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import clientsRouter from "./clients.js";
import calendarRouter from "./calendar.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(calendarRouter);

export default router;
