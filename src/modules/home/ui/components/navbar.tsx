"use client";

import Link from "next/link";
import Image from "next/image";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useScroll } from "@/hooks/use-scroll";
import { Button } from "@/components/ui/button";
import { UserControl } from "@/components/user-control";
import { useTRPC } from "@/trpc/client";

export const Navbar = () => {
  const isScrolled = useScroll();
  const trpc = useTRPC();
  const adminStatus = useQuery(trpc.admin.amIAdmin.queryOptions());

  return (
    <nav
      className={cn(
        "p-4 bg-transparent fixed top-0 left-0 right-0 z-50 transition-all duration-200 border-b border-transparent md:hidden",
        isScrolled && "bg-background border-border"
      )}
    >
      <div className="max-w-5xl mx-auto w-full flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/albert-logo.png" alt="Vibe" width={24} height={24} />
          <span className="font-semibold text-lg">Vibe</span>
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
