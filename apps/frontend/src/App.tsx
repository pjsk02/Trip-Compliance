import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Landing } from './pages/Landing';
import { Home } from './pages/Home';
import { CreateGroup } from './pages/CreateGroup';
import { JoinGroup } from './pages/JoinGroup';
import { Dashboard } from './pages/Dashboard';
import { PreferenceChat } from './pages/PreferenceChat';
import { BudgetNegotiation } from './pages/BudgetNegotiation';
import { ItineraryView } from './pages/ItineraryView';
import { NegotiationView } from './pages/NegotiationView';
import { FinalTripView } from './pages/FinalTripView';
import { EvalDashboard } from './pages/EvalDashboard';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

function RequireUserAuth({ children }: { children: React.ReactNode }) {
  const { userSession } = useAuth();
  return userSession ? <>{children}</> : <Navigate to="/" replace />;
}

function RequireGroupAuth({ children }: { children: React.ReactNode }) {
  const { userSession, session } = useAuth();
  if (!userSession) return <Navigate to="/" replace />;
  if (!session) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { userSession } = useAuth();
  return (
    <Routes>
      <Route
        path="/"
        element={userSession ? <Navigate to="/home" replace /> : <Landing />}
      />
      <Route
        path="/home"
        element={<RequireUserAuth><Home /></RequireUserAuth>}
      />
      <Route
        path="/create"
        element={<RequireUserAuth><CreateGroup /></RequireUserAuth>}
      />
      <Route
        path="/join"
        element={<RequireUserAuth><JoinGroup /></RequireUserAuth>}
      />
      <Route
        path="/group/:code"
        element={<RequireGroupAuth><Dashboard /></RequireGroupAuth>}
      />
      <Route
        path="/group/:code/preferences"
        element={<RequireGroupAuth><PreferenceChat /></RequireGroupAuth>}
      />
      <Route
        path="/group/:code/budget"
        element={<RequireGroupAuth><BudgetNegotiation /></RequireGroupAuth>}
      />
      <Route
        path="/group/:code/negotiate"
        element={<RequireGroupAuth><NegotiationView /></RequireGroupAuth>}
      />
      <Route
        path="/group/:code/itinerary"
        element={<RequireGroupAuth><ItineraryView /></RequireGroupAuth>}
      />
      <Route
        path="/eval"
        element={<RequireUserAuth><EvalDashboard /></RequireUserAuth>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}
