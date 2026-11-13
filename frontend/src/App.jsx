import React from 'react';

export function App() {
  return (
    <main className="workspace">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="ISM Hackathon home">
          <span className="wordmark-icon" aria-hidden="true">I</span>
          <span>ISM <span className="wordmark-light">HACKATHON</span></span>
        </a>
        <span className="status"><span className="status-dot" />Workspace ready</span>
      </header>

      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">2026 · BUILD SOMETHING THAT MATTERS</p>
        <h1 id="welcome-title">Your next idea<br />starts <span>here.</span></h1>
        <p className="intro">The workspace is ready. Bring your team, find a problem worth solving, and make a dent in the world.</p>
        <a className="start-link" href="mailto:team@ismhackathon.org">
          Get your team together <span aria-hidden="true">↗</span>
        </a>
      </section>

      <footer className="footer">
        <span>ISM HACKATHON 2026</span>
        <span>IDEAS INTO IMPACT</span>
      </footer>
    </main>
  );
}