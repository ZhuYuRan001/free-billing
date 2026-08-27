import { createBrowserRouter } from 'react-router';
import { AppShell } from './shell/AppShell';
import { Dashboard } from '../routes/dashboard/Dashboard';
import { ImportPage } from '../routes/import/ImportPage';
import { ReviewPage } from '../routes/review/ReviewPage';
import { TransactionsPage } from '../routes/transactions/TransactionsPage';
import { AnalyticsPage } from '../routes/analytics/AnalyticsPage';
import { RulesPage } from '../routes/rules/RulesPage';
import { SettingsPage } from '../routes/settings/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'rules', element: <RulesPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
