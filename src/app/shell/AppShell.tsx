import { NavLink, Outlet } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../infrastructure/database/db';

const navItems = [
  ['/', '总览', '⌂'],
  ['/transactions', '流水', '↕'],
  ['/review', '待确认', '✓'],
  ['/analytics', '统计', '◔'],
  ['/rules', '规则', '⌘'],
  ['/settings', '设置', '⚙'],
];

export function AppShell() {
  const pendingCount = useLiveQuery(() => db.ledgerEntries.where('status').equals('needs-review').count(), [], 0);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">¥</span><span>Free Billing</span></div>
        <p className="brand-caption">你的本地账本</p>
        <nav className="nav-list">
          {navItems.map(([to, label, icon]) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">{icon}</span><span>{label}</span>
              {to === '/review' && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="privacy-card"><span className="privacy-dot" />数据仅保存在当前设备</div>
      </aside>
      <main className="main-content"><Outlet /></main>
      <nav className="mobile-nav">
        {navItems.slice(0, 5).map(([to, label, icon]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}><span>{icon}</span><small>{label}</small></NavLink>)}
      </nav>
    </div>
  );
}
