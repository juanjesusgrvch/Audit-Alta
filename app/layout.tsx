import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AuthProvider } from "@/app/components/auth-provider";
import { ThemeProvider } from "@/app/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audit Alta",
  description:
    "Consola de descargas, cargas y gestion de envases para planta industrial."
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var key="audit-alta-theme";var theme=localStorage.getItem(key);if(theme!=="light"&&theme!=="dark"){theme="dark";}document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}catch(error){document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark";}})();`
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
