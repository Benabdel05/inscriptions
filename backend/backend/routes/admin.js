// backend/routes/admin.js

const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Toutes ces routes nécessitent l'authentification

/**
 * GET /api/admin/dashboard/:formationId
 * Dashboard admin détaillé
 */
router.get('/dashboard/:formationId', async (req, res) => {
    try {
        const { formationId } = req.params;
        
        // Stats principales
        const mainStats = await db.query(`
            SELECT 
                f.nom as formation_nom,
                f.capacite_accueil as effectif_prevu,
                
                -- Candidatures
                COUNT(c.id) FILTER (WHERE c.statut_inscription = 'brouillon') as brouillons,
                COUNT(c.id) FILTER (WHERE c.statut_inscription = 'en_ligne') as en_ligne,
                COUNT(c.id) FILTER (WHERE c.statut_inscription = 'soumis') as soumis,
                
                -- Paiements
                COUNT(c.id) FILTER (WHERE c.frais_payes = TRUE) as frais_payes_count,
                COUNT(c.id) FILTER (WHERE c.frais_payes = FALSE AND c.statut_inscription = 'soumis') as frais_non_payes,
                SUM(CASE WHEN c.frais_payes = TRUE THEN c.montant_frais ELSE 0 END) as frais_payes_montant,
                
                -- Dossiers
                COUNT(c.id) FILTER (WHERE c.statut_dossier = 'incomplet') as dossiers_incomplets,
                COUNT(c.id) FILTER (WHERE c.statut_dossier = 'complet') as dossiers_complets,
                COUNT(c.id) FILTER (WHERE c.statut_dossier = 'en_cours_verification') as dossiers_en_verification,
                COUNT(c.id) FILTER (WHERE c.statut_dossier = 'accepte') as dossiers_acceptes,
                COUNT(c.id) FILTER (WHERE c.statut_dossier = 'refuse') as dossiers_refuses,
                
                -- Admissions
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'admis') as admis,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'liste_attente') as liste_attente,
                COUNT(c.id) FILTER (WHERE c.statut_admission = 'refuse') as refuses_admission,
                
                -- Confirmations
                COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE) as inscriptions_confirmees,
                
                -- Places
                f.capacite_accueil - COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE) as places_restantes,
                
                -- Taux
                ROUND((COUNT(c.id) FILTER (WHERE c.inscription_confirmee = TRUE)::DECIMAL / NULLIF(f.capacite_accueil, 0) * 100), 2) as taux_remplissage,
                ROUND((COUNT(c.id) FILTER (WHERE c.frais_payes = TRUE)::DECIMAL / NULLIF(COUNT(c.id), 0) * 100), 2) as taux_paiement
                
            FROM formations f
            LEFT JOIN candidats c ON c.formation_id = f.id
            WHERE f.id = $1
            GROUP BY f.id, f.nom, f.capacite_accueil
        `, [formationId]);
        
        // Liste d'attente
        const listeAttente = await db.query(`
            SELECT 
                numero_dossier,
                nom,
                prenom,
                email,
                telephone,
                rang_liste_attente,
                date_decision
            FROM candidats
            WHERE formation_id = $1 
            AND statut_admission = 'liste_attente'
            ORDER BY rang_liste_attente ASC
        `, [formationId]);
        
        // Documents manquants
        const documentsManquants = await db.query(`
            SELECT 
                c.numero_dossier,
                c.nom,
                c.prenom,
                c.email,
                dr.nom_document,
                dr.obligatoire
            FROM candidats c
            CROSS JOIN documents_requis dr
            LEFT JOIN documents_candidats dc ON dc.candidat_id = c.id AND dc.document_requis_id = dr.id
            WHERE c.formation_id = $1
            AND dr.formation_id = $1
            AND dc.id IS NULL
            AND dr.obligatoire = TRUE
            AND c.statut_dossier = 'incomplet'
            ORDER BY c.nom, c.prenom
        `, [formationId]);
        
        // Évolution
        const evolution = await db.query(`
            SELECT 
                date_collecte,
                candidats_en_ligne,
                frais_payes_count,
                dossiers_acceptes,
                candidats_admis,
                places_restantes,
                taux_remplissage
            FROM statistiques_quotidiennes
            WHERE formation_id = $1
            AND date_collecte >= CURRENT_DATE - INTERVAL '14 days'
            ORDER BY date_collecte ASC
        `, [formationId]);
        
        // Alertes
        const alertes = await db.query(`
            SELECT 
                id,
                type,
                priorite,
                message,
                created_at
            FROM alertes
            WHERE formation_id = $1
            AND resolu = FALSE
            ORDER BY 
                CASE priorite 
                    WHEN 'haute' THEN 1
                    WHEN 'moyenne' THEN 2
                    WHEN 'basse' THEN 3
                END,
                created_at DESC
        `, [formationId]);
        
        // Log de l'activité
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['view_dashboard', req.user.id, `Consultation dashboard formation ${formationId}`]
        );
        
        res.json({
            success: true,
            data: {
                statistiques: mainStats.rows[0],
                liste_attente: listeAttente.rows,
                documents_manquants: documentsManquants.rows,
                evolution: evolution.rows,
                alertes: alertes.rows
            }
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/admin/candidats/:formationId
 * Liste complète des candidats avec filtres
 */
router.get('/candidats/:formationId', async (req, res) => {
    try {
        const { formationId } = req.params;
        const { statut_inscription, statut_dossier, statut_admission, search } = req.query;
        
        let query = `
            SELECT 
                c.id,
                c.numero_dossier,
                c.nom,
                c.prenom,
                c.email,
                c.telephone,
                c.statut_inscription,
                c.date_inscription,
                c.frais_payes,
                c.date_paiement,
                c.statut_dossier,
                c.statut_admission,
                c.rang_liste_attente,
                c.inscription_confirmee,
                c.created_at
            FROM candidats c
            WHERE c.formation_id = $1
        `;
        
        const params = [formationId];
        let paramIndex = 2;
        
        if (statut_inscription) {
            query += ` AND c.statut_inscription = $${paramIndex}`;
            params.push(statut_inscription);
            paramIndex++;
        }
        
        if (statut_dossier) {
            query += ` AND c.statut_dossier = $${paramIndex}`;
            params.push(statut_dossier);
            paramIndex++;
        }
        
        if (statut_admission) {
            query += ` AND c.statut_admission = $${paramIndex}`;
            params.push(statut_admission);
            paramIndex++;
        }
        
        if (search) {
            query += ` AND (c.nom ILIKE $${paramIndex} OR c.prenom ILIKE $${paramIndex} OR c.numero_dossier ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        query += ` ORDER BY c.created_at DESC`;
        
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
 * PUT /api/admin/candidat/:id/statut
 * Mise à jour du statut d'un candidat
 */
router.put('/candidat/:id/statut', async (req, res) => {
    try {
        const { id } = req.params;
        const { type_statut, nouveau_statut, commentaire } = req.body;
        
        // Récupérer l'ancien statut
        const oldData = await db.query(
            `SELECT statut_inscription, statut_dossier, statut_admission 
             FROM candidats WHERE id = $1`,
            [id]
        );
        
        if (oldData.rows.length === 0) {
            return res.status(404).json({ error: 'Candidat non trouvé' });
        }
        
        const ancien_statut = oldData.rows[0][type_statut];
        
        // Mise à jour selon le type
        let updateQuery;
        if (type_statut === 'statut_inscription') {
            updateQuery = 'UPDATE candidats SET statut_inscription = $1, updated_at = NOW() WHERE id = $2';
        } else if (type_statut === 'statut_dossier') {
            updateQuery = 'UPDATE candidats SET statut_dossier = $1, date_verification_dossier = NOW(), updated_at = NOW() WHERE id = $2';
        } else if (type_statut === 'statut_admission') {
            updateQuery = 'UPDATE candidats SET statut_admission = $1, date_decision = NOW(), updated_at = NOW() WHERE id = $2';
        }
        
        await db.query(updateQuery, [nouveau_statut, id]);
        
        // Historique
        await db.query(
            `INSERT INTO historique_statuts 
             (candidat_id, ancien_statut, nouveau_statut, type_statut, commentaire, modifie_par) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, ancien_statut, nouveau_statut, type_statut, commentaire, req.user.id]
        );
        
        // Log
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['update_candidat_statut', req.user.id, `Candidat ${id}: ${type_statut} => ${nouveau_statut}`]
        );
        
        res.json({
            success: true,
            message: 'Statut mis à jour avec succès'
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * POST /api/admin/formation
 * Création d'une nouvelle formation
 */
router.post('/formation', async (req, res) => {
    try {
        const {
            etablissement_id,
            nom,
            code,
            type_diplome,
            capacite_accueil,
            description
        } = req.body;
        
        const result = await db.query(
            `INSERT INTO formations 
             (etablissement_id, nom, code, type_diplome, capacite_accueil, description) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING *`,
            [etablissement_id, nom, code, type_diplome, capacite_accueil, description]
        );
        
        // Log
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['create_formation', req.user.id, `Formation créée: ${nom}`]
        );
        
        res.json({
            success: true,
            data: result.rows[0],
            message: 'Formation créée avec succès'
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * PUT /api/admin/formation/:id
 * Mise à jour d'une formation
 */
router.put('/formation/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nom,
            code,
            type_diplome,
            capacite_accueil,
            description
        } = req.body;
        
        const result = await db.query(
            `UPDATE formations 
             SET nom = $1, code = $2, type_diplome = $3, 
                 capacite_accueil = $4, description = $5, updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [nom, code, type_diplome, capacite_accueil, description, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Formation non trouvée' });
        }
        
        // Log
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['update_formation', req.user.id, `Formation ${id} mise à jour`]
        );
        
        res.json({
            success: true,
            data: result.rows[0],
            message: 'Formation mise à jour avec succès'
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * POST /api/admin/import-candidats
 * Import en masse de candidats (CSV/Excel)
 */
router.post('/import-candidats', async (req, res) => {
    try {
        const { formation_id, candidats } = req.body;
        
        let imported = 0;
        let errors = [];
        
        for (const candidat of candidats) {
            try {
                await db.query(
                    `INSERT INTO candidats 
                     (formation_id, numero_dossier, nom, prenom, email, telephone, 
                      statut_inscription, frais_payes, montant_frais, statut_dossier, statut_admission)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        formation_id,
                        candidat.numero_dossier,
                        candidat.nom,
                        candidat.prenom,
                        candidat.email,
                        candidat.telephone,
                        candidat.statut_inscription || 'en_ligne',
                        candidat.frais_payes || false,
                        candidat.montant_frais || 0,
                        candidat.statut_dossier || 'incomplet',
                        candidat.statut_admission || 'en_attente'
                    ]
                );
                imported++;
            } catch (err) {
                errors.push({
                    candidat: candidat.numero_dossier,
                    error: err.message
                });
            }
        }
        
        // Log
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['import_candidats', req.user.id, `${imported} candidats importés pour formation ${formation_id}`]
        );
        
        res.json({
            success: true,
            imported,
            errors,
            message: `${imported} candidat(s) importé(s) avec succès`
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/admin/export/candidats/:formationId
 * Export des candidats en CSV
 */
router.get('/export/candidats/:formationId', async (req, res) => {
    try {
        const { formationId } = req.params;
        
        const result = await db.query(`
            SELECT 
                numero_dossier,
                nom,
                prenom,
                email,
                telephone,
                statut_inscription,
                date_inscription,
                frais_payes,
                date_paiement,
                statut_dossier,
                statut_admission,
                rang_liste_attente,
                inscription_confirmee
            FROM candidats
            WHERE formation_id = $1
            ORDER BY nom, prenom
        `, [formationId]);
        
        // Convertir en CSV
        const csv = convertToCSV(result.rows);
        
        // Log
        await db.query(
            `INSERT INTO activity_logs (action, user_id, details) 
             VALUES ($1, $2, $3)`,
            ['export_candidats', req.user.id, `Export candidats formation ${formationId}`]
        );
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=candidats_formation_${formationId}.csv`);
        res.send(csv);
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * POST /api/admin/alerte/:id/resoudre
 * Marquer une alerte comme résolue
 */
router.post('/alerte/:id/resoudre', async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.query(
            'UPDATE alertes SET resolu = TRUE WHERE id = $1',
            [id]
        );
        
        res.json({
            success: true,
            message: 'Alerte résolue'
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/admin/logs
 * Consulter les logs d'activité
 */
router.get('/logs', async (req, res) => {
    try {
        const { limit = 100, user_id, action } = req.query;
        
        let query = `
            SELECT 
                l.*,
                a.username
            FROM activity_logs l
            LEFT JOIN admins a ON a.id = l.user_id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (user_id) {
            query += ` AND l.user_id = $${paramIndex}`;
            params.push(user_id);
            paramIndex++;
        }
        
        if (action) {
            query += ` AND l.action = $${paramIndex}`;
            params.push(action);
            paramIndex++;
        }
        
        query += ` ORDER BY l.created_at DESC LIMIT $${paramIndex}`;
        params.push(limit);
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            data: result.rows
        });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Fonction utilitaire pour convertir en CSV
function convertToCSV(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => 
        Object.values(row).map(val => 
            typeof val === 'string' ? `"${val}"` : val
        ).join(',')
    );
    
    return [headers, ...rows].join('\n');
}

module.exports = router;
