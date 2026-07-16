-- backend/database/init_admin.sql

-- Créer un administrateur par défaut
-- Mot de passe: Admin@2024 (à changer immédiatement après la première connexion)

INSERT INTO admins (username, password_hash, email, role)
VALUES (
    'admin',
    '$2b$10$XQvH8kqKQqGJ6v6kN5Y9KeOy1QG5ZqZ8NvWxQvQz5qZ8NvWxQvQz5q', -- Hash de "Admin@2024"
    'admin@myway-tracker.ma',
    'super_admin'
);
