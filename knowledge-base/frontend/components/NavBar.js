"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Home" },
  { href: "/articles", label: "Articles" },
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask AI" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="brand">
          <span className="dot" />
          <span>Knowledge Base</span>
          <span className="muted small">· MongoDB AI Search</span>
        </Link>
        <nav>
          {ITEMS.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={
                pathname === it.href ||
                (it.href !== "/" && pathname.startsWith(it.href))
                  ? "active"
                  : ""
              }
            >
              {it.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
