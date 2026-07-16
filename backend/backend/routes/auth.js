// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

/**
 * POST /api/auth/login
 * Connexion administrateur
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Validation
        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Nom d\'utilisateur et mot de passe requis' 
            });
        }
        
        // Recherche de l'admin
        const result = await db.query(
            'SELECT * FROM admins WHERE username = $1',
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ 
                error: 'Identifiants incorrects' 
            });
        }
        
        const admin = result.rows[0];
        
        // Vérification du mot de passe
        const validPassword = await bcrypt.compare(password, admin.password_hash);
        
        if (!validPassword) {
            // Log de tentative échouée
            await db.query(
                `INSERT INTO activity_logs (action, user_id, details) 
                 VALUES ($1, $2, $3)`,
                ['login_failed', admin.id, `Tentative échouée pour ${username}`]
            );
            
            return res.status(401).json({ 
                error: 'Identifiants incorrects' 
            });
        }
        
        // Génération du token JWT
        const token = jwt.sign(
            { 
                id: admin.id, 
                username: admin.username,
                role: admin.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );
        
        // Mise à jour de la dernière connexion
        await db.query(
            'UPDATE admins SET last_login = NOW() WHERE id = $1',
            [admin.id]
        );
        
        // Log de connexion réussie
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['login_success', admin.id, `Connexion réussie pour ${username}`]
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: admin.id,
                username: admin.username,
                email: admin.email,
                role: admin.role
            }
        });
        
    } catch (error) {
        console.error('Erreur login:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * POST /api/auth/logout
 * Déconnexion (côté client, suppression du token)
 */
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        // Log de déconnexion
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['logout', req.user.id, `Déconnexion de ${req.user.username}`]
        );
        
        res.json({
            success: true,
            message: 'Déconnexion réussie'
        });
        
    } catch (error) {
        console.error('Erreur logout:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/auth/verify
 * Vérification du token
 */
router.get('/verify', authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        }
    });
});

/**
 * POST /api/auth/change-password
 * Changement de mot de passe
 */
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                error: 'Mots de passe requis' 
            });
        }
        
        if (newPassword.length < 8) {
            return res.status(400).json({ 
                error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' 
            });
        }
        
        // Vérifier l'ancien mot de passe
        const result = await db.query(
            'SELECT password_hash FROM admins WHERE id = $1',
            [req.user.id]
        );
        
        const validPassword = await bcrypt.compare(
            currentPassword, 
            result.rows[0].password_hash
        );
        
        if (!validPassword) {
            return res.status(401).json({ 
                error: 'Mot de passe actuel incorrect' 
            });
        }
        
        // Hasher le nouveau mot de passe
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        
        // Mettre à jour
        await db.query(
            'UPDATE admins SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [newPasswordHash, req.user.id]
        );
        
        // Log
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['password_changed', req.user.id, 'Mot de passe modifié']
        );
        
        res.json({
            success: true,
            message: 'Mot de passe modifié avec succès'
        });
        
    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Middleware d'authentification
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Accès non autorisé' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide ou expiré' });
        }
        req.user = user;
        next();
    });
}

module.exports = router;
