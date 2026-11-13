import { Link } from "react-router-dom";
import { FamilyOverview } from "../../components/organisms/FamilyOverview";
import { FamilyMembersGrid } from "../../components/organisms/FamilyMembersGrid";
import { ReadinessOverview } from "../../components/organisms/ReadinessOverview";
import { WeeklyActivity } from "../../components/organisms/WeeklyActivity";
import { Topbar } from "../../components/organisms/Topbar";

export function FamilyDashboardPage() {
  return (
    <div className="dashboard-main">
      <Topbar />
      <div className="page-section dashboard-page">
        <section className="hero-summary surface-card">
          <div>
            <span className="eyebrow">The Parker family</span>
            <h1>Protecting each other from AI voice scams</h1>
          </div>
          <div className="hero-actions">
            <Link to="/practice" className="button button-primary">
              Start next practice
            </Link>
            <Link to="/result" className="button button-secondary">
              Share safe word
            </Link>
          </div>
        </section>

        <div className="dashboard-grid">
          <div className="main-column">
            <FamilyOverview />
            <FamilyMembersGrid />
          </div>
          <div className="sidebar-column">
            <ReadinessOverview />
            <WeeklyActivity />
          </div>
        </div>
      </div>
    </div>
  );
}
