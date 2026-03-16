"use client";

import Link from "next/link";
import Image from "next/image";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useScroll } from "@/hooks/use-scroll";
import { useCurrentTheme } from "@/hooks/use-current-theme";
import { Button } from "@/components/ui/button";
import { UserControl } from "@/components/user-control";
import { useTRPC } from "@/trpc/client";

const LOGO_DARK = "/Albert%20-%20Text%20Logo%20-%20Dark%20Mode.png";

export const Navbar = () => {
  const isScrolled = useScroll();
  const currentTheme = useCurrentTheme();
  const trpc = useTRPC();
  const adminStatus = useQuery(trpc.admin.amIAdmin.queryOptions());
  const logoSrc = currentTheme === "dark" ? LOGO_DARK : "/albert-logo.png";

  return (
    <nav
      className={cn(
        "p-4 bg-transparent fixed top-0 left-0 right-0 z-50 transition-all duration-200 border-b border-transparent md:hidden",
        isScrolled && "bg-background border-border"
      )}
    >
      <div className="max-w-5xl mx-auto w-full flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2">
          <Image src={logoSrc} alt="Albert" width={24} height={24} />
          <span className="font-semibold text-lg">Albert</span>
        </Link>
        <SignedOut>
          <div className="flex gap-2">
            <SignUpButton>
              <Button variant="outline" size="sm">
                Sign up
              </Button>
            </SignUpButton>
            <SignInButton>
              <Button size="sm">
                Sign in
              </Button>
            </SignInButton>
          </div>
        </SignedOut>
        <SignedIn>
          <div className="flex items-center gap-2">
            {adminStatus.data?.isAdmin ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin">Admin</Link>
              </Button>
            ) : null}
            <UserControl showName />
          </div>
        </SignedIn>
      </div>
    </nav>
  );
};
