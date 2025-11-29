import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/providers/Providers";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "AcmeUSD Stablecoin Gateway",
  description: "Seamlessly buy and sell AcmeUSD stablecoins on the Tempo network",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}

