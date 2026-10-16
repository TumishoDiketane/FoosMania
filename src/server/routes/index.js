/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Route username availability checks and delegate page requests to
 * the view routes.
 */
import express from 'express';
import { usernameExists } from '../handlers/user-handler.js';

import pagesRoutes from "./pages.js";

const router = express.Router();

router.get('/username-exists', (req, res) => {
    const username = req.query.username;
    res.status(200).json({ exists: usernameExists(username) });
});

router.use("/", pagesRoutes);

export default router;