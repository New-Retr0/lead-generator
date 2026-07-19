import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppSidebar } from "@/components/app-sidebar";
import { ChunkLoadRecovery } from "@/components/chunk-load-recovery";
import { MotionProvider } from "@/components/motion-provider";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { DEV_PORTLESS_HMR_FIX_SCRIPT } from "@/lib/dev-portless-hmr-fix";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PALLARES Leads",
    template: "%s · PALLARES Leads",
  },
  description: "Single-pass commercial property lead generation for PALLARES exterior cleaning",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {process.env.NODE_ENV === "development" ? (
          <script
            id="dev-portless-hmr-fix"
            dangerouslySetInnerHTML={{ __html: DEV_PORTLESS_HMR_FIX_SCRIPT }}
          />
        ) : null}
      </head>
      <body className="min-h-full" suppressHydrationWarning>
        <ThemeProvider>
          <MotionProvider>
            <ChunkLoadRecovery />
            <div className="dot-grid pointer-events-none fixed inset-0 -z-10" aria-hidden />
            <div className="noise-overlay pointer-events-none fixed inset-0 -z-10" aria-hidden />
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset className="min-w-0 overflow-x-clip">
                <SiteHeader />
                <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
                  <div className="mx-auto w-full max-w-6xl min-w-0">{children}</div>
                </main>
              </SidebarInset>
            </SidebarProvider>
            <Toaster position="top-right" richColors />
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
