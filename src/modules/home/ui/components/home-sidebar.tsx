"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useAuth,
  useOrganizationList,
  useUser,
} from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import {
  HomeIcon,
  LayoutGridIcon,
  LayersIcon,
  GraduationCapIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCurrentTheme } from "@/hooks/use-current-theme";
import { useTRPC } from "@/trpc/client";

const primaryNav = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "App Library", href: "/library", icon: LayoutGridIcon },
  { label: "Templates", href: "/templates", icon: LayersIcon },
  { label: "Learn", href: "/learn", icon: GraduationCapIcon },
];

const footerNav = [
  { label: "Admin Portal", href: "/admin", icon: ShieldCheckIcon },
];

export const HomeSidebar = () => {
  const pathname = usePathname();
  const trpc = useTRPC();
  const { user } = useUser();
  const { orgId, isSignedIn, isLoaded: isAuthLoaded } = useAuth();
  const { isLoaded: isOrgsLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: {
      pageSize: 10,
    },
  });
  const didAutoSetOrg = useRef(false);
  const currentTheme = useCurrentTheme();
  const memberships = userMemberships?.data ?? [];
  const singleMembershipOrgId =
    memberships.length === 1 ? memberships[0]?.organization?.id ?? null : null;
  const { data: sidebarProjects } = useQuery(
    trpc.projects.getSidebarList.queryOptions(),
  );
  const sidebarTitle = useMemo(() => {
    if (user?.firstName) {
      return `${user.firstName}'s Projects`;
    }
    return "Your Projects";
  }, [user?.firstName]);

  useEffect(() => {
    if (didAutoSetOrg.current) return;
    if (!isAuthLoaded || !isOrgsLoaded) return;
    if (!isSignedIn || orgId) return;
    if (!singleMembershipOrgId) return;

    didAutoSetOrg.current = true;
    void setActive({ organization: singleMembershipOrgId });
  }, [
    isAuthLoaded,
    isOrgsLoaded,
    isSignedIn,
    orgId,
    singleMembershipOrgId,
    setActive,
  ]);

  return (
    <aside className="hidden md:flex w-72 h-screen fixed left-0 top-0 flex-col border-r bg-background/95 overflow-hidden">
      <div className="px-6 pt-6 pb-4">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/albert-logo-full.png"
            alt="Albert"
            width={220}
            height={56}
            className="h-14 w-auto"
            priority
          />
        </Link>
      </div>
      <nav className="px-4 py-2 space-y-1">
        {primaryNav.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-base font-medium transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <Icon className="size-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-4 pt-4 pb-2">
        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {sidebarTitle}
        </p>
        <div className="mt-2 space-y-1">
          {sidebarProjects && sidebarProjects.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">
              No projects yet
            </p>
          )}
          {sidebarProjects?.slice(0, 8).map((project) => {
            const isActive = pathname.startsWith(`/projects/${project.id}`);
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className={cn(
                  "flex items-center rounded-xl px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="truncate">{project.title}</span>
              </Link>
            );
          })}
          {(sidebarProjects?.length ?? 0) > 8 && (
            <Link
              href="/"
              className="flex items-center px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              View all projects
            </Link>
          )}
        </div>
      </div>
      <div className="mt-auto border-t">
        <div className="px-4 py-4">
          {footerNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 rounded-2xl px-4 py-3 text-base font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              >
                <Icon className="size-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="px-6 pb-6">
          <SignedIn>
            <div className="flex items-center gap-3">
              <UserButton
                appearance={{
                  baseTheme: currentTheme === "dark" ? dark : undefined,
                  elements: {
                    userButtonTrigger: "rounded-full!",
                    userButtonAvatarBox: "rounded-full! size-10!",
                  },
                }}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user?.fullName ?? "Account"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.primaryEmailAddress?.emailAddress ?? ""}
                </p>
              </div>
            </div>
          </SignedIn>
          <SignedOut>
            <SignInButton>
              <Button variant="outline" size="sm" className="w-full">
                Sign in
              </Button>
            </SignInButton>
          </SignedOut>
        </div>
      </div>
    </aside>
  );
};
