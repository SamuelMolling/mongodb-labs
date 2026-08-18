import "./globals.css";

export const metadata = {
  title: "Support Agent · MongoDB",
  description:
    "Context-aware customer support agent on MongoDB Atlas — condensation, tiered memory, two corpora, escalation policy",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
