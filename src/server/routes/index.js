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