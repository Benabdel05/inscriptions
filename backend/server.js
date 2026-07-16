// backend/server.js

const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ========================================
// ROUTES PUBLIQUES (Sans authentification)
// ========================================
const publicRoutes = require('./routes/public');
app.use('/api/public', publicRoutes);

// ========================================
// ROUTES ADMIN (Avec authentification)
// ========================================
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');

app.use('/api/auth', authRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// Middleware d'authentification
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Accès non autorisé' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide' });
        }
        req.user = user;
        next();
    });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Serveur démarré sur le port ${PORT}`);
});
