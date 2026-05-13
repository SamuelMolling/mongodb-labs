import "./globals.css";
import { NavBar } from "../components/NavBar";

export const metadata = {
  title: "Knowledge Base · MongoDB AI Search",
  description:
    "Full-stack knowledge management with MongoDB Atlas Search and Vector Search",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
