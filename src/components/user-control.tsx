"use client";

import { dark } from "@clerk/themes";
import { UserButton } from "@clerk/nextjs";
import { CloudUpload } from "lucide-react";

import { useCurrentTheme } from "@/hooks/use-current-theme";
import { UserMetrics } from "@/components/user-metrics";
import { Button } from "@/components/ui/button";

interface Props {
  showName?: boolean;
};

export const UserControl = ({ showName }: Props) => {
  const currentTheme = useCurrentTheme();

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm">
          Share
        </Button>
        <Button size="sm">
          <CloudUpload />
          Publish
        </Button>
      </div>
      <UserMetrics />
      <div className="ml-auto">
        <UserButton
          showName={showName}
          appearance={{
            elements: {
              userButtonBox: "rounded-md!",
              userButtonAvatarBox: "rounded-md! size-8!",
              userButtonTrigger: "rounded-md!",
            },
            baseTheme: currentTheme === "dark" ? dark : undefined,
          }}
        />
      </div>
    </div>
  );
};
