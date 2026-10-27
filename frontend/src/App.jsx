import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import Login from './components/Login';
import Register from './components/Register';
import PrivateRoute from './components/PrivateRoute';
import { SECTION_KEYS } from './utils/purchaseSections';
import VersionWatcher from './components/VersionWatcher';
import EcranIndisponible from './components/EcranIndisponible';
import { page } from './utils/lazyPage';
import { TableauInboxProvider } from './context/TableauInboxContext';

// Un fichier par écran, chargé à la demande et rangé dans son bloc (= premier
// segment de l'adresse). Voir utils/lazyPage.js : le bloc décide qui est prévenu
// d'une nouvelle version.
const Home = page('home', () => import('./pages/Home'));
const ReviewsApp = page('reviews', () => import('./pages/ReviewsApp'));
const RewardsApp = page('rewards', () => import('./pages/RewardsApp'));
const EmailApp = page('emails', () => import('./pages/EmailApp'));
const SettingsApp = page('settings', () => import('./pages/SettingsApp'));
const StatsApp = page('stats', () => import('./pages/StatsApp'));
const PurchasesApp = page('purchases', () => import('./pages/PurchasesApp'));
const PurchasesAppV2 = page('purchases-v2', () => import('./pages/PurchasesAppV2'));
const CreateOrderPage = page('purchases', () => import('./pages/CreateOrderPage'));
const ImportPdfPage = page('purchases', () => import('./pages/ImportPdfPage'));
const CustomersApp = page('customers', () => import('./pages/CustomersApp'));
const CustomerDetail = page('customers', () => import('./pages/CustomerDetail'));
const ProductsApp = page('products', () => import('./pages/ProductsApp'));
const ProductDetail = page('products', () => import('./pages/ProductDetail'));
const OrdersApp = page('orders', () => import('./pages/OrdersApp'));
const OrderDetail = page('orders', () => import('./pages/OrderDetail'));
const BrandDetail = page('brands', () => import('./pages/BrandDetail'));
const SubBrandDetail = page('sub-brands', () => import('./pages/SubBrandDetail'));
const CategoryDetail = page('categories', () => import('./pages/CategoryDetail'));
const SubCategoryDetail = page('sub-categories', () => import('./pages/SubCategoryDetail'));
const ShippingSettings = page('stats', () => import('./pages/ShippingSettings'));
const ReportsSettingsApp = page('financier', () => import('./pages/ReportsSettingsApp'));
const CatalogApp = page('catalog', () => import('./pages/CatalogApp'));
const PackingApp = page('packing', () => import('./pages/PackingApp'));
const PackingSettings = page('packing', () => import('./pages/PackingSettings'));
const BordereauApp = page('bordereau', () => import('./pages/BordereauApp'));
const ShipmentHistoryApp = page('expeditions', () => import('./pages/ShipmentHistoryApp'));
const ShipmentStatsApp = page('stats-expedition', () => import('./pages/ShipmentStatsApp'));
const PickingApp = page('picking', () => import('./pages/PickingApp'));
const PickingSettings = page('picking', () => import('./pages/PickingSettings'));
const PickingReglages = page('picking', () => import('./pages/PickingReglages'));
const PdaHome = page('pda', () => import('./pages/PdaHome'));
const PdaPicking = page('pda', () => import('./pages/PdaPicking'));
const PdaProduit = page('pda', () => import('./pages/PdaProduit'));
const PdaInventaire = page('pda', () => import('./pages/PdaInventaire'));
const PdaDebug = page('pda', () => import('./pages/PdaDebug'));
const InventoryApp = page('inventaire', () => import('./pages/InventoryApp'));
const ReturnsApp = page('retours', () => import('./pages/ReturnsApp'));
const ReceptionApp = page('reception', () => import('./pages/ReceptionApp'));
const FinancierApp = page('financier', () => import('./pages/FinancierApp'));
const OrdersSearchApp = page('commandes', () => import('./pages/OrdersSearchApp'));
const TicketsApp = page('tickets', () => import('./pages/TicketsApp'));
const TicketDetailPage = page('tickets', () => import('./pages/TicketDetailPage'));
const TicketsSettingsApp = page('tickets', () => import('./pages/TicketsSettingsApp'));
const ChronopostApp = page('chronopost', () => import('./pages/ChronopostApp'));
const ColissimoApp = page('colissimo', () => import('./pages/ColissimoApp'));
const LettreSuivieApp = page('lettre-suivie', () => import('./pages/LettreSuivieApp'));
const MondialRelayApp = page('mondial-relay', () => import('./pages/MondialRelayApp'));
const TransporteursApp = page('transporteurs', () => import('./pages/TransporteursApp'));
const VeilleApp = page('veille', () => import('./pages/VeilleApp'));
const SeoApp = page('seo', () => import('./pages/SeoApp'));
const InscritsApp = page('inscrits', () => import('./pages/InscritsApp'));
const PromosApp = page('promos', () => import('./pages/PromosApp'));
const SupplierInvoicesApp = page('factures-fournisseurs', () => import('./pages/SupplierInvoicesApp'));
const BoutiqueApp = page('boutique', () => import('./pages/BoutiqueApp'));
const PromoDetail = page('promos', () => import('./pages/PromoDetail'));
const StoriesApp = page('stories', () => import('./pages/StoriesApp'));
const ProcessApp = page('process', () => import('./pages/ProcessApp'));
const ProcessDetail = page('process', () => import('./pages/ProcessDetail'));
const ATBApp = page('atb', () => import('./pages/ATBApp'));
const TableauApp = page('tableau', () => import('./pages/TableauApp'));
const EmployeesApp = page('employes', () => import('./pages/EmployeesApp'));

const PAGE_TITLES = {
  '/home': 'Accueil',
  '/reviews': 'Avis',
  '/rewards': 'Rewards',
  '/emails': 'Emails',
  '/settings': 'Parametres',
  '/stats': 'Statistiques',
  '/purchases': 'Achats',
  '/purchases-v2': 'Besoins V2',
  '/catalog': 'Catalogue',
  '/customers': 'Clients',
  '/products': 'Produits',
  '/orders': 'Commandes',
  '/packing': 'Packing',
  '/bordereau': 'Bordereau de dépôt',
  '/expeditions': "Historique d'expédition",
  '/stats-expedition': "Stats d'expédition",
  '/picking': 'Picking',
  '/picking/settings': 'Picking — Règles des vagues',
  '/picking/reglages': 'Picking — Réglages',
  '/pda': 'Youvape PDA',
  '/pda/picking': 'Picking PDA',
  '/pda/produit': 'Produit PDA',
  '/pda/inventaire': 'Inventaire PDA',
  '/pda/debug': 'Diagnostic scan PDA',
  '/inventaire': 'Inventaire',
  '/retours': 'Retours',
  '/reception': 'Réception',
  '/financier': 'Financier',
  '/commandes': 'Commandes clients',
  '/tickets': 'SAV',
  '/chronopost': 'Chronopost',
  '/colissimo':  'Colissimo',
  '/lettre-suivie': 'Lettre Suivie',
  '/mondial-relay': 'Mondial Relay',
  '/transporteurs': 'Transporteurs',
  '/veille': 'Veille concurrentielle',
  '/seo': 'Suivi SEO',
  '/inscrits': 'Inscrits sans commande',
  '/promos': 'Actions Promos',
  '/stories': 'Stories & Vidéos',
  '/factures-fournisseurs': 'Factures Fournisseurs',
  '/process': 'Process',
  '/boutique': 'Boutique',
  '/atb': 'ATB',
  '/tableau': 'Tableau',
  '/employes': 'Gestion employé',
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
        {/* Prévient qu'un déploiement a eu lieu : un onglet ouvert exécute son
            code de départ tant qu'on ne le recharge pas, et passer d'un écran à
            l'autre ne recharge rien dans une SPA. */}
        <VersionWatcher />
        {/* Post-its reçus et rappels de l'app Tableau : pastilles + toasts dans toutes les apps */}
        <TableauInboxProvider>
        {/* Écrans chargés à la demande : un écran qui ne vient pas (réseau,
            fichier disparu après un déploiement) affiche un message et un bouton
            Recharger au lieu d'une page blanche. */}
        <EcranIndisponible>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Chargement…</div>}>
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
          {/* Les quatre sections de Gestion d'achat sont des apps de la pile
              Achats : chacune a son adresse, donc son favori et son lien.
              `/purchases` reste servie et renvoie sur Besoins — c'est l'adresse
              qui traîne dans les favoris et dans les liens déjà échangés. */}
          <Route path="/purchases" element={<Navigate to="/purchases/besoins" replace />} />
          {SECTION_KEYS.map(k => (
            <Route
              key={k}
              path={`/purchases/${k}`}
              element={
                <PrivateRoute>
                  <PurchasesApp section={k} />
                </PrivateRoute>
              }
            />
          ))}
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
            path="/packing/settings"
            element={
              <PrivateRoute>
                <PackingSettings />
              </PrivateRoute>
            }
          />
          {/* Contrôle des factures fournisseur. S'ouvre avec le droit `purchases`
              (AppIcons : permissionKey) ; le routeur backend exige le même. */}
          <Route
            path="/factures-fournisseurs"
            element={
              <PrivateRoute>
                <SupplierInvoicesApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/picking"
            element={
              <PrivateRoute>
                <PickingApp />
              </PrivateRoute>
            }
          />
          {/* PDA : accueil plein écran, installable (pda-manifest.json), et ses apps. */}
          <Route
            path="/pda"
            element={
              <PrivateRoute>
                <PdaHome />
              </PrivateRoute>
            }
          />
          <Route
            path="/pda/picking"
            element={
              <PrivateRoute>
                <PdaPicking />
              </PrivateRoute>
            }
          />
          <Route
            path="/pda/produit"
            element={
              <PrivateRoute>
                <PdaProduit />
              </PrivateRoute>
            }
          />
          <Route
            path="/pda/inventaire"
            element={
              <PrivateRoute>
                <PdaInventaire />
              </PrivateRoute>
            }
          />
          <Route
            path="/pda/debug"
            element={
              <PrivateRoute>
                <PdaDebug />
              </PrivateRoute>
            }
          />
          <Route
            path="/inventaire"
            element={
              <PrivateRoute>
                <InventoryApp />
              </PrivateRoute>
            }
          />
          {/* Retours client : droit tickets (AppIcons : permissionKey). Une seule
              page, qui lit l'adresse : liste, fiche, SAV fournisseurs. */}
          {['/retours', '/retours/fournisseurs', '/retours/fournisseurs/:supplierId', '/retours/:id'].map(path => (
            <Route
              key={path}
              path={path}
              element={
                <PrivateRoute>
                  <ReturnsApp />
                </PrivateRoute>
              }
            />
          ))}
          <Route
            path="/picking/settings"
            element={
              <PrivateRoute>
                <PickingSettings />
              </PrivateRoute>
            }
          />
          {/* Réglages de l'expédition (plugin youvape-logistique). Lecture : droit
              picking ; enregistrement : admins (le backend l'exige). */}
          <Route
            path="/picking/reglages"
            element={
              <PrivateRoute>
                <PickingReglages />
              </PrivateRoute>
            }
          />
          {/* Groupe « Prépa de commande ». L'app s'ouvre avec le droit packing
              (AppIcons : permissionKey) ; le backend exige la même clé. */}
          <Route
            path="/bordereau"
            element={
              <PrivateRoute>
                <BordereauApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/expeditions"
            element={
              <PrivateRoute>
                <ShipmentHistoryApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/stats-expedition"
            element={
              <PrivateRoute>
                <ShipmentStatsApp />
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
          <Route
            path="/reception"
            element={
              <PrivateRoute>
                <ReceptionApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/veille"
            element={
              <PrivateRoute>
                <VeilleApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/seo"
            element={
              <PrivateRoute>
                <SeoApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/inscrits"
            element={
              <PrivateRoute>
                <InscritsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/promos"
            element={
              <PrivateRoute>
                <PromosApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/promos/:id"
            element={
              <PrivateRoute>
                <PromoDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/stories"
            element={
              <PrivateRoute>
                <StoriesApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/boutique/:shop"
            element={
              <PrivateRoute>
                <BoutiqueApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/boutique/:shop/:section"
            element={
              <PrivateRoute>
                <BoutiqueApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/atb"
            element={
              <PrivateRoute>
                <ATBApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/atb/:section"
            element={
              <PrivateRoute>
                <ATBApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/employes"
            element={
              <PrivateRoute>
                <EmployeesApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/employes/:section"
            element={
              <PrivateRoute>
                <EmployeesApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/process"
            element={
              <PrivateRoute>
                <ProcessApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/process/:id"
            element={
              <PrivateRoute>
                <ProcessDetail />
              </PrivateRoute>
            }
          />
          <Route
            path="/tableau"
            element={
              <PrivateRoute>
                <TableauApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/tableau/:tab"
            element={
              <PrivateRoute>
                <TableauApp />
              </PrivateRoute>
            }
          />
        </Routes>
        </Suspense>
        </EcranIndisponible>
        </TableauInboxProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;