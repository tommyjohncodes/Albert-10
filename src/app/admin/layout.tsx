import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { isAdmin } from "@/lib/admin";
import { Navbar } from "@/modules/home/ui/components/navbar";
import { HomeSidebar } from "@/modules/home/ui/components/home-sidebar";

interface Props {
  children: React.ReactNode;
}

const links = [
  { href: "/admin", label: "General" },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/configuration", label: "Configuration" },
];

export default async function AdminLayout({ children }: Props) {
  const { userId } = await auth();

  if (!isAdmin(userId)) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen">
      <Navbar />
      <HomeSidebar />
      <main className="flex-1 pt-24 px-4 pb-8 md:pl-72">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="rounded-xl border bg-card p-2 flex flex-wrap gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted transition"
              >
                {link.label}
              </Link>
            ))}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
