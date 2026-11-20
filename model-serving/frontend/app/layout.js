import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Model Serving Platform · MongoDB",
  description:
    "Deploy, version and serve ML models on MongoDB Atlas — transactional promotion, change-stream propagation, time series evidence, drift checks",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand" style={{ color: "var(--text)" }}>
            <span className="dot" /> Model Serving Platform
          </Link>
          <span className="muted small">registry · promotion · propagation · observation — on one cluster</span>
        </header>
        {children}
      </body>
    </html>
  );
}
