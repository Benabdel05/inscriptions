// frontend/App.jsx

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

// Pages publiques
import HomePublic from './public/pages/Home';
import FormationsPublic from './public/pages/Formations';
import FormationDetailPublic from './public/pages/FormationDetail';
import StatsPublic from './public/pages/Stats';

// Pages admin
import Login from './admin/pages/Login';
import DashboardAdmin from './admin/pages/Dashboard';
import CandidatsAdmin from './admin/pages/Candidats';
import FormationsAdmin from './admin/pages/Formations';
import SettingsAdmin from './admin/pages/Settings';

// Composants
import ProtectedRoute from './admin/components/ProtectedRoute';
import LayoutPublic from './public/components/Layout';
import LayoutAdmin from './admin/components/Layout';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* ========================================
                    ROUTES PUBLIQUES (Sans authentification)
                    ======================================== */}
                <Route path="/" element={<LayoutPublic />}>
                    <Route index element={<HomePublic />} />
                    <Route path="formations" element={<FormationsPublic />} />
                    <Route path="formation/:id" element={<FormationDetailPublic />} />
                    <Route path="statistiques" element={<StatsPublic />} />
                </Route>

                {/* ========================================
                    ROUTES ADMIN (Avec authentification)
                    ======================================== */}
                <Route path="/admin/login" element={<Login />} />
                
                <Route path="/admin" element={
                    <ProtectedRoute>
                        <LayoutAdmin />
                    </ProtectedRoute>
                }>
                    <Route index element={<Navigate to="/admin/dashboard" replace />} />
                    <Route path="dashboard" element={<DashboardAdmin />} />
                    <Route path="candidats/:formationId" element={<CandidatsAdmin />} />
                    <Route path="formations" element={<FormationsAdmin />} />
                    <Route path="settings" element={<SettingsAdmin />} />
                </Route>

                {/* 404 */}
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
