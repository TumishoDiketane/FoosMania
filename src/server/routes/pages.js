import express from "express";

const router = express.Router();

router.use('/', (req, res, next) => {
    res.render = (file_name) => {
        res.sendFile(`${file_name}.html`, { root: 'src/client/views' });
    };

    next();
});

router.get('/', (req, res) => {
    res.render('login')
});

router.get('/views/:view', (req, res) => {
    res.render(`partials/${req.params.view}`);
});

router.get('*', (req, res) => {
    res.render('index');
});

export default router;