import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";
import Nav from "./components/Nav";
import Footer from "./components/Footer";

const disp = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-disp", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata = {
  title: "Joule · sell your spare seconds",
  description:
    "Turn an idle GPU or CPU into a paid inference node. Stream answers to autonomous agents and earn USDC by the second, settled on Arc.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${disp.variable} ${mono.variable}`}>
      <body>
        <Nav />
        <div className="wrap">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
