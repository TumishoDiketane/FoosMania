/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Serve the SPA shell for page paths and HTML partials for view loads.
 */
import express from "express";

const router = express.Router();

router.use('/', (req, res, next) => {
    res.render = (file_name) => {
        res.sendFile(`${file_name}.html`, { root: 'src/client/views' });
    };

    next();
});

router.get('/', (req, res) => {
    res.render('index')
});

router.get('/views/:view', (req, res) => {
    res.render(`partials/${req.params.view}`);
});

router.get('*', (req, res) => {
    res.render('index');
});

export default router;