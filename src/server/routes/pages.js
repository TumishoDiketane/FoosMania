/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Serve the SPA shell for page paths and HTML partials for view loads.
 */
import express from "express";

const router = express.Router();

// Add a helper for serving files from the views folder.
router.use('/', (req, res, next) => {
    res.render = (file_name) => {
        res.sendFile(`${file_name}.html`, { root: 'src/client/views' });
    };

    next();
});

router.get('/', (req, res) => {
    res.render('index')
});

// SPA navigation requests individual partials through this endpoint.
router.get('/views/:view', (req, res) => {
    res.render(`partials/${req.params.view}`);
});

// Send unknown browser paths to the SPA shell.
router.get('*', (req, res) => {
    res.render('index');
});

export default router;