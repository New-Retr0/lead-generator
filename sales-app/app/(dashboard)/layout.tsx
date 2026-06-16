import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-x-clip">
        <SiteHeader />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto w-full max-w-screen-2xl min-w-0">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
