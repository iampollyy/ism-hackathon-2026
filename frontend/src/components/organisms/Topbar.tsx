import { Bell, ChevronDown, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '../atoms/Avatar';

export function Topbar() {
  return (
    <header className="topbar surface-card">
      <div className="search-box">
        <Search size={16} />
        <input placeholder="Search family plans, calls, or tactics" aria-label="Search" />
      </div>

      <div className="topbar-actions">
        <button className="icon-btn" aria-label="Notifications">
          <Bell size={16} />
        </button>
        <Link to="/settings" className="profile-pill" aria-label="Open personal settings">
          <Avatar initials="DP" color="#352A7C" size="sm" />
          <span>Daniel Parker</span>
          <ChevronDown size={14} />
        </Link>
      </div>
    </header>
  );
}
