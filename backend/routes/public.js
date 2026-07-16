// backend/routes/public.js

const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * GET /api/public/formations
 * Liste toutes les formations avec stats basiques
 */
router.get('/formations', async (req, res) => {
    try {
        const { ville, type, search } = req.query;
        
        let query = `
            SELECT 
                f.id,
                f.nom,
                f.code,
                f.type_diplome,
                e.nom as etablissement,
                e.ville,
                e.type as type_etablissement,
                f.capacite_accueil as effectif_prevu,
                
                -- Stats publiques uniquement
                COUNT(c.id) FILTER (WHERE c.statut_inscription IN ('en_ligne', 'soumis')) as candidats_en_ligne,
                COUNT(c.id) FILTER (WHERE c.frais_payes = TRUE) as frais_payes,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'admis') as admis,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'liste_attente') as liste_attente,
                
                f.capacite_accueil - COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE) as places_restantes,
                
                ROUND((COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE)::DECIMAL / NULLIF(f.capacite_accueil, 0) * 100), 2) as taux_remplissage,
                
                -- Statut de la formation
                CASE 
                    WHEN f.capacite_accueil <= COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE) THEN 'Complet'
                    WHEN f.capacite_accueil - COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE) <= 10 THEN 'Presque Complet'
                    ELSE 'Ouvert'
                END as statut
                
            FROM formations f
            JOIN etablissements e ON e.id = f.etablissement_id
            LEFT JOIN candidats c ON c.formation_id = f.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (ville) {
            query += ` AND e.ville = $${paramIndex}`;
            params.push(ville);
            paramIndex++;
        }
        
        if (type) {
            query += ` AND f.type_diplome = $${paramIndex}`;
            params.push(type);
            paramIndex++;
        }
        
        if (search) {
            query += ` AND (f.nom ILIKE $${paramIndex} OR e.nom ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        query += `
            GROUP BY f.id, f.nom, f.code, f.type_diplome, e.nom, e.ville, e.type, f.capacite_accueil
            ORDER BY f.nom
        `;
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/public/formation/:id
 * Détails d'une formation spécifique
 */
router.get('/formation/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const formation = await db.query(`
            SELECT 
                f.*,
                e.nom as etablissement_nom,
                e.ville,
                e.type as type_etablissement,
                e.adresse,
                e.telephone,
                e.email,
                e.site_web,
                
                COUNT(c.id) FILTER (WHERE c.statut_inscription IN ('en_ligne', 'soumis')) as candidats_en_ligne,
                COUNT(c.id) FILTER (WHERE c.frais_payes = TRUE) as frais_payes,
                COUNT(c.id) FILTER (WHERE c.statut_dossier = 'accepte') as dossiers_acceptes,
                COUNT(c.id) FILTER (WHERE c.statut_dossier = 'incomplet') as dossiers_incomplets,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'admis') as admis,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'liste_attente') as liste_attente,
                
                f.capacite_accueil - COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE) as places_restantes,
                
                ROUND((COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE)::DECIMAL / NULLIF(f.capacite_accueil, 0) * 100), 2) as taux_remplissage
                
            FROM formations f
            JOIN etablissements e ON e.id = f.etablissement_id
            LEFT JOIN candidats c ON c.formation_id = f.id
            WHERE f.id = $1
            GROUP BY f.id, e.nom, e.ville, e.type, e.adresse, e.telephone, e.email, e.site_web
        `, [id]);
        
        if (formation.rows.length === 0) {
            return res.status(404).json({ error: 'Formation non trouvée' });
        }
        
        // Évolution sur les 30 derniers jours
        const evolution = await db.query(`
            SELECT 
                date_collecte,
                candidats_en_ligne,
                frais_payes_count,
                candidats_admis,
                places_restantes,
                taux_remplissage
            FROM statistiques_quotidiennes
            WHERE formation_id = $1
            AND date_collecte >= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY date_collecte ASC
        `, [id]);
        
        res.json({
            success: true,
            data: {
                formation: formation.rows[0],
                evolution: evolution.rows
            }
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/public/stats/global
 * Statistiques globales publiques
 */
router.get('/stats/global', async (req, res) => {
    try {
        const stats = await db.query(`
            SELECT 
                COUNT(DISTINCT f.id) as total_formations,
                COUNT(DISTINCT e.id) as total_etablissements,
                SUM(f.capacite_accueil) as effectif_total_prevu,
                
                COUNT(c.id) FILTER (WHERE c.statut_inscription IN ('en_ligne', 'soumis')) as total_candidatures,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'admis') as total_admis,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'liste_attente') as total_liste_attente,
                
                SUM(f.capacite_accueil) - COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE) as total_places_restantes,
                
                ROUND((COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE)::DECIMAL / NULLIF(SUM(f.capacite_accueil), 0) * 100), 2) as taux_remplissage_global
                
            FROM formations f
            JOIN etablissements e ON e.id = f.etablissement_id
            LEFT JOIN candidats c ON c.formation_id = f.id
        `);
        
        // Top 10 formations les plus demandées
        const topFormations = await db.query(`
            SELECT 
                f.nom,
                e.nom as etablissement,
                f.capacite_accueil,
                COUNT(c.id) as nombre_candidatures,
                ROUND((COUNT(c.id)::DECIMAL / NULLIF(f.capacite_accueil, 0)), 2) as ratio_demande
            FROM formations f
            JOIN etablissements e ON e.id = f.etablissement_id
            LEFT JOIN candidats c ON c.formation_id = f.id
            GROUP BY f.id, f.nom, e.nom, f.capacite_accueil
            ORDER BY nombre_candidatures DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            data: {
                statistiques: stats.rows[0],
                top_formations: topFormations.rows
            }
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/public/villes
 * Liste des villes disponibles (pour filtres)
 */
router.get('/villes', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT DISTINCT ville 
            FROM etablissements 
            ORDER BY ville
        `);
        
        res.json({
            success: true,
            data: result.rows.map(r => r.ville)
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/public/types-diplomes
 * Types de diplômes disponibles (pour filtres)
 */
router.get('/types-diplomes', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT DISTINCT type_diplome 
            FROM formations 
            WHERE type_diplome IS NOT NULL
            ORDER BY type_diplome
        `);
        
        res.json({
            success: true,
            data: result.rows.map(r => r.type_diplome)
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
