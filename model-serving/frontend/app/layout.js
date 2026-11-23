import "./globals.css";
import Link from "next/link";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata = {
  title: "Model serving on MongoDB",
  description:
    "Deploy, version and serve ML models on MongoDB Atlas: transactional promotion, change-stream propagation, time series evidence, drift checks",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <svg className="mark" viewBox="0 0 20 20" aria-hidden>
              <rect x="0" y="2" width="20" height="4" rx="2" />
              <rect x="0" y="8" width="13" height="4" rx="2" />
              <rect x="15" y="8" width="5" height="4" rx="2" className="mark-canary" />
              <rect x="0" y="14" width="20" height="4" rx="2" />
            </svg>
            Model serving
          </Link>
          <span className="topbar-note">One cluster: registry, rollout, propagation and evidence</span>
        </header>
        {children}
      </body>
    </html>
  );
}
