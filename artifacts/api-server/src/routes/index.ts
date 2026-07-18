import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import companiesRouter from "./companies";
import buildingsRouter from "./buildings";
import unitsRouter from "./units";
import invitationsRouter from "./invitations";
import meRouter from "./me";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(companiesRouter);
router.use(buildingsRouter);
router.use(unitsRouter);
router.use(invitationsRouter);
router.use(meRouter);

export default router;
