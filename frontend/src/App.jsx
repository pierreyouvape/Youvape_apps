import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import Login from './components/Login';
import Register from './components/Register';
import Home from './pages/Home';
import ReviewsApp from './pages/ReviewsApp';
import RewardsApp from './pages/RewardsApp';
import EmailApp from './pages/EmailApp';
import SettingsApp from './pages/SettingsApp';
import StatsApp from './pages/StatsApp';
import PurchasesApp from './pages/PurchasesApp';
import PurchasesAppV2 from './pages/PurchasesAppV2';
import CreateOrderPage from './pages/CreateOrderPage';
import ImportPdfPage from './pages/ImportPdfPage';
import CustomersApp from './pages/CustomersApp';
import CustomerDetail from './pages/CustomerDetail';
import ProductsApp from './pages/ProductsApp';
import ProductDetail from './pages/ProductDetail';
import OrdersApp from './pages/OrdersApp';
import OrderDetail from './pages/OrderDetail';
import BrandDetail from './pages/BrandDetail';
import SubBrandDetail from './pages/SubBrandDetail';
import CategoryDetail from './pages/CategoryDetail';
import SubCategoryDetail from './pages/SubCategoryDetail';
import ShippingSettings from './pages/ShippingSettings';
import ReportsSettingsApp from './pages/ReportsSettingsApp';
import CatalogApp from './pages/CatalogApp';
import PackingApp from './pages/PackingApp';
import FinancierApp from './pages/FinancierApp';
import OrdersSearchApp from './pages/OrdersSearchApp';
import TicketsApp from './pages/TicketsApp';
import TicketDetailPage from './pages/TicketDetailPage';
import TicketsSettingsApp from './pages/TicketsSettingsApp';
import ChronopostApp from './pages/ChronopostApp';
import ColissimoApp from './pages/ColissimoApp';
import LettreSuivieApp from './pages/LettreSuivieApp';
import MondialRelayApp from './pages/MondialRelayApp';
import TransporteursApp from './pages/TransporteursApp';
import PrivateRoute from './components/PrivateRoute';

const PAGE_TITLES = {
  '/home': 'Accueil',
  '/reviews': 'Avis',
  '/rewards': 'Rewards',
  '/emails': 'Emails',
  '/settings': 'Parametres',
  '/stats': 'Statistiques',
  '/purchases': 'Achats',
  '/purchases-v2': 'Achats V2',
  '/catalog': 'Catalogue',
  '/customers': 'Clients',
  '/products': 'Produits',
  '/orders': 'Commandes',
  '/packing': 'Packing',
  '/financier': 'Financier',
  '/commandes': 'Commandes',
  '/tickets': 'SAV',
  '/chronopost': 'Chronopost',
  '/colissimo':  'Colissimo',
  '/lettre-suivie': 'Lettre Suivie',
  '/mondial-relay': 'Mondial Relay',
  '/transporteurs': 'Transporteurs',
  '/brands': 'Marque',
  '/sub-brands': 'Sous-marque',
  '/categories': 'Categorie',
  '/sub-categories': 'Sous-categorie',
  '/login': 'Connexion',
  '/register': 'Inscription',
};

function PageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const base = '/' + pathname.split('/')[1];
    const suffix = PAGE_TITLES[base] || '';
    document.title = suffix ? `YouVape Apps - ${suffix}` : 'YouVape Apps';
  }, [pathname]);
  return null;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PageTitle />
        <Routes>
          <Route path="/" element={<Navigate to="/home" />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/home"
            element={
              <PrivateRoute>
                <Home />
              </PrivateRoute>
            }
          />
          <Route
            path="/reviews"
            element={
              <PrivateRoute>
                <ReviewsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/rewards"
            element={
              <PrivateRoute>
                <RewardsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/emails"
            element={
              <PrivateRoute>
                <EmailApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <PrivateRoute>
                <SettingsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/stats"
            element={
              <PrivateRoute>
                <StatsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/stats/:tab"
            element={
              <PrivateRoute>
                <StatsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/financier/report-settings"
            element={
              <PrivateRoute>
                <ReportsSettingsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/stats/shipping-settings"
            element={
              <PrivateRoute>
                <ShippingSettings />
              </PrivateRoute>
            }
          />
          <Route
            path="/purchases"
            element={
              <PrivateRoute>
                <PurchasesApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/purchases-v2"
            element={
              <PrivateRoute>
                <PurchasesAppV2 />
              </PrivateRoute>
            }
          />
          <Route
            path="/purchases/create-order"
            element={
              <PrivateRoute>
                <CreateOrderPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/purchases/import-pdf"
            element={
              <PrivateRoute>
                <ImportPdfPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/catalog"
            element={
              <PrivateRoute>
                <CatalogApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <PrivateRoute>
                <CustomersApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/customers/:id"
            element={
              <PrivateRoute>
                <CustomerDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/products"
            element={
              <PrivateRoute>
                <ProductsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/products/:id"
            element={
              <PrivateRoute>
                <ProductDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <PrivateRoute>
                <OrdersApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <PrivateRoute>
                <OrderDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/brands/:brandName"
            element={
              <PrivateRoute>
                <BrandDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/sub-brands/:subBrandName"
            element={
              <PrivateRoute>
                <SubBrandDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/categories/:categoryName"
            element={
              <PrivateRoute>
                <CategoryDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/packing"
            element={
              <PrivateRoute>
                <PackingApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/sub-categories/:subCategoryName"
            element={
              <PrivateRoute>
                <SubCategoryDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/financier"
            element={
              <PrivateRoute>
                <FinancierApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/commandes"
            element={
              <PrivateRoute>
                <OrdersSearchApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/tickets"
            element={
              <PrivateRoute>
                <TicketsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/tickets/settings"
            element={
              <PrivateRoute>
                <TicketsSettingsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/tickets/:id"
            element={
              <PrivateRoute>
                <TicketDetailPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/chronopost"
            element={
              <PrivateRoute>
                <ChronopostApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/colissimo"
            element={
              <PrivateRoute>
                <ColissimoApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/lettre-suivie"
            element={
              <PrivateRoute>
                <LettreSuivieApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/mondial-relay"
            element={
              <PrivateRoute>
                <MondialRelayApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/transporteurs"
            element={
              <PrivateRoute>
                <TransporteursApp />
              </PrivateRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;