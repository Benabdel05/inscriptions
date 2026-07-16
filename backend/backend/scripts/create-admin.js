// backend/scripts/create-admin.js

const bcrypt = require('bcrypt');
const readline = require('readline');
const db = require('../config/database');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function createAdmin() {
    console.log('=== Création d\'un administrateur ===\n');

    const username = await question('Nom d\'utilisateur: ');
    const email = await question('Email: ');
    const password = await question('Mot de passe (min 8 caractères): ');
    const role = await question('Rôle (admin/super_admin): ') || 'admin';

    if (password.length < 8) {
        console.error('❌ Le mot de passe doit contenir au moins 8 caractères');
        rl.close();
        return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    try {
        const result = await db.query(
            `INSERT INTO admins (username, password_hash, email, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id, username, email, role`,
            [username, passwordHash, email, role]
        );

        console.log('\n✅ Administrateur créé avec succès:');
        console.log(result.rows[0]);
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    } finally {
        rl.close();
        process.exit();
    }
}

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

createAdmin();
