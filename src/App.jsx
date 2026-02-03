import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import InventoryPage from './pages/InventoryPage';
import PosPage from './pages/PosPage';
import TransactionHistoryPage from './pages/TransactionHistoryPage';
import LoginPage from './pages/LoginPage';
import logo from './assets/Warehouse 375 Logo (2).png';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

function NavLink({ to, children }) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link to={to} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isActive ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>{children}</Link>
  );
}

function Layout() {
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error("Failed to log out", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-3">
                <img src={logo} alt="Warehouse 375 Logo" className="h-10 w-auto" />
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">Warehouse 375</h1>
              </div>
              <nav className="hidden md:flex gap-2">
                <NavLink to="/inventory">Inventory</NavLink>
                <NavLink to="/pos">Point of Sale</NavLink>
                <NavLink to="/transactions">Transactions</NavLink>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-xs text-gray-500 font-medium hidden sm:block">
                {currentUser?.email}
              </div>
              <button
                onClick={handleLogout}
                className="text-gray-500 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
                title="Sign Out"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/inventory" replace />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/transactions" element={<TransactionHistoryPage />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
