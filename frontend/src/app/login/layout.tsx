import React from "react";
import { InsyderTile } from "@/components/common/InsyderLogo";

/**
 * SignalRadarDiagram: Connected 3-node intelligence graph matching user's reference mockup:
 * - Center: Concentric soft-pink glow rings with glowing 3D-styled orb, crimson growth bars and upward trend arrow
 * - Orbiting cards: Top (Team / Users), Left (Company / Building), Right (Verified / Checkmark)
 * - Connectors: Delicate light-pink dotted lines suspended with clean air gaps (never touching the nodes or rings)
 */
function SignalRadarDiagram() {
  return (
    <svg
      className="auth-diagram"
      viewBox="0 0 440 250"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        {/* Soft card shadow */}
        <filter id="nodeCardShadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#0E6B67" floodOpacity="0.04" />
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000000" floodOpacity="0.03" />
        </filter>

        {/* Center soft luminous rosy radial gradient */}
        <radialGradient id="centerPinkGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#D5ECE7" />
          <stop offset="65%" stopColor="#BFDDD7" />
          <stop offset="100%" stopColor="#7FD3CB" />
        </radialGradient>
      </defs>

      {/* Outer Faint Pulse Ring (3rd circle) */}
      <circle cx="220" cy="132" r="95" fill="#EEF7F5" opacity="0.6" />

      {/* Middle Translucent Pink Ring */}
      <circle cx="220" cy="132" r="66" fill="#EEF7F5" stroke="#A9DCD5" strokeWidth="1.2" opacity="0.75" />

      {/* Inner Soft Rosy Circle */}
      <circle cx="220" cy="132" r="42" fill="url(#centerPinkGrad)" stroke="#5FBFB5" strokeWidth="1.2" />

      {/* Connectors (Dashed Lines + Directional Arrowheads) */}
      {/* Left Connector: Company -> Center */}
      <polygon points="80,129 86,132 80,135" fill="#8FA2B5" />
      <line x1="86" y1="132" x2="154" y2="132" stroke="#8FA2B5" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />

      {/* Top Connector: Team -> Center */}
      <polygon points="217,60 220,66 223,60" fill="#8FA2B5" />
      <line x1="220" y1="66" x2="220" y2="94" stroke="#8FA2B5" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />

      {/* Right Connector: Center -> Verified Pipeline */}
      <line x1="286" y1="132" x2="354" y2="132" stroke="#8FA2B5" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />
      <polygon points="354,129 360,132 354,135" fill="#8FA2B5" />

      {/* Center Chart: 3 Grounded Bars + Ascending Trend Line with Solid Arrowhead */}
      <rect x="207.5" y="137" width="5.5" height="12" rx="1.8" fill="#0E6B67" />
      <rect x="217.5" y="130" width="5.5" height="19" rx="1.8" fill="#0E6B67" />
      <rect x="227.5" y="122" width="5.5" height="27" rx="1.8" fill="#0E6B67" />

      {/* Trend Line */}
      <path
        d="M202 136 L213 122 L219.5 127 L232 115"
        fill="none"
        stroke="#0E6B67"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Solid 45-degree Arrowhead */}
      <polygon points="238,109 230,111 232,115 236,117" fill="#0E6B67" />

      {/* Left Node: Company / Office Building */}
      <rect x="28" y="106" width="52" height="52" rx="16" fill="#ffffff" stroke="#DCEDEA" strokeWidth="1.2" filter="url(#nodeCardShadow)" />
      <g transform="translate(42, 120)" stroke="#111827" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 22h20" />
        <path d="M4 22V9a1 1 0 0 1 1-1h2" />
        <path d="M17 8h2a1 1 0 0 1 1 1v13" />
        <path d="M7 22V4a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 17 4v18" />
        <path d="M10 22v-3.5a2 2 0 0 1 4 0V22" />
        <circle cx="10" cy="6.5" r="0.8" fill="#111827" />
        <circle cx="14" cy="6.5" r="0.8" fill="#111827" />
        <circle cx="10" cy="10" r="0.8" fill="#111827" />
        <circle cx="14" cy="10" r="0.8" fill="#111827" />
        <circle cx="10" cy="13.5" r="0.8" fill="#111827" />
        <circle cx="14" cy="13.5" r="0.8" fill="#111827" />
      </g>

      {/* Top Node: Team / Users */}
      <rect x="194" y="8" width="52" height="52" rx="16" fill="#ffffff" stroke="#DCEDEA" strokeWidth="1.2" filter="url(#nodeCardShadow)" />
      <g transform="translate(208, 22)" stroke="#111827" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </g>

      {/* Right Node: Verified / Checkmark */}
      <rect x="360" y="106" width="52" height="52" rx="16" fill="#ffffff" stroke="#DCEDEA" strokeWidth="1.2" filter="url(#nodeCardShadow)" />
      <g transform="translate(374, 120)" stroke="#111827" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9.5" />
        <path d="m8 12 2.8 2.8 5.2-5.6" />
      </g>
    </svg>
  );
}

/**
 * Sign-in shell:
 * - Left side: Logo centered above the white card, soft decorative corner auras (top-left & bottom-left)
 * - Right side: Value proposition showcase featuring signal radar diagram & soft blush corner background
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-stage">
        {/* Left column / Form section */}
        <section className="auth-shell__form">
          <span className="auth-corner-blob auth-corner-blob--tl" aria-hidden />
          <span className="auth-corner-blob auth-corner-blob--bl" aria-hidden />
          <div className="auth-panel-wrapper">
            <div className="auth-shell__brand">
              <InsyderTile size={36} radius={10} />
              <span className="auth-shell__name">insyder</span>
            </div>
            <div className="auth-panel">
              {children}
            </div>
            <p className="auth-shell__legal">© {new Date().getFullYear()} Insyder</p>
          </div>
        </section>

        {/* Right column / Value proposition showcase */}
        <aside className="auth-visual" aria-hidden>
          <span className="auth-visual__corner-blob" aria-hidden />
          <div className="auth-visual__showcase">
            <h2 className="auth-visual__hero-title">
              Turn live buying signals<br />
              into <span className="auth-visual__hero-highlight">closed pipeline</span>
            </h2>
            <p className="auth-visual__hero-desc">
              Spot high-intent companies with verified web evidence and connect them straight to your sales team.
            </p>
            <div className="auth-visual__diagram">
              <SignalRadarDiagram />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
